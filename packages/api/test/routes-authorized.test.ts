import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A route is public only if somebody said so here (CLAUDE.md hard rule 2).
//
// Authorization is opt-in: authorize() is a preHandler, and a route
// registered without one is reachable by anybody who can reach the
// server. A missing preHandler looks exactly like a route nobody thought
// about — there is nothing on the line to notice — so the absence is what
// gets checked. Every route carries authorize()/authorizeAny() or is named
// below with the reason it's open. Ported from the WSL system's guard.
const apiSrc = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const repoRoot = join(apiSrc, "..", "..", "..");

const PUBLIC_BY_DESIGN = new Map<string, string>([
  ["GET /api/health", "Cloud Run health check; there is no session to have"],
  ["GET /api/me", 'answers "is anyone signed in?", with a 401 and nothing else when nobody is'],
  ["GET /auth/google/login", "starts sign-in; there is no session yet"],
  ["GET /auth/google/callback", "Google returns here; the one-use state token in the session is the gate"],
  ["GET /auth/dev-login", "never registered in production; development sign-in by design"],
  ["GET /auth/dev-login/accounts", "never registered in production; lists the invented demo staff"],
  ["POST /auth/logout", "ending a session you may or may not have is harmless"],
  ["PUT /api/local-storage/*", "development-only stand-in for Cloud Storage; the signed URL is the gate"],
  ["GET /api/local-storage/*", "development-only stand-in for Cloud Storage; the signed URL is the gate"],
  ["POST /api/self-serve/:token/unlock", "a participant's own form link; the passcode is the gate, and wrong ones lock it"],
  ["GET /api/self-serve/:token", "a participant's own form link; needs the cookie the passcode earned"],
  ["PATCH /api/self-serve/:token/answers", "a participant's own form link; needs the cookie the passcode earned"],
  ["POST /api/self-serve/:token/submit", "a participant's own form link; needs the cookie the passcode earned"],
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith(".ts") ? [full] : [];
  });
}

const ROUTE_START = /\b(?:fastify|scope|app)\.(get|post|patch|put|delete)\s*(?:<[\s\S]*?>)?\s*\(/g;
const ROUTE_PATH = /^\s*["'`](\/(?:api|auth)\/[^"'`]*|\/api\/?)["'`]/;

// The text of one route call, found by matching its parentheses rather
// than slicing to the next registration — the last route in a file would
// otherwise run to the end of it and could swallow some later helper's
// authorize(), reading as guarded when it isn't. Strings and comments
// are skipped so a bracket inside a message can't throw the count off.
function callText(src: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i]!;
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "/" && src[i + 1] === "/") i = src.indexOf("\n", i);
    else if (c === "/" && src[i + 1] === "*") i = src.indexOf("*/", i) + 1;
    else if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(from, i + 1);
    }
    if (i < 0) break;
  }
  return src.slice(from);
}

type Route = { key: string; guarded: boolean; where: string };

const routes: Route[] = sourceFiles(apiSrc).flatMap((file) => {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(ROUTE_START)].flatMap((m) => {
    const call = callText(src, m.index! + m[0].length - 1);
    const path = ROUTE_PATH.exec(call.slice(1));
    if (!path) return [];
    return [
      {
        key: `${m[1]!.toUpperCase()} ${path[1]!}`,
        guarded: /\bauthorize(?:Any)?\s*\(/.test(call),
        where: `${relative(repoRoot, file)}:${src.slice(0, m.index).split("\n").length}`,
      },
    ];
  });
});

describe("every route is authorized, or public on purpose", () => {
  it("finds the routes it is supposed to check", () => {
    expect(routes.length).toBeGreaterThanOrEqual(59);
    expect(routes.find((r) => r.key === "GET /api/participants")?.guarded).toBe(true);
    expect(routes.find((r) => r.key === "POST /auth/logout")).toBeDefined();
  });

  it("has no route that is open by omission", () => {
    const open = routes.filter((r) => !r.guarded && !PUBLIC_BY_DESIGN.has(r.key));
    expect(
      open.map((r) => `${r.key}  (${r.where})`),
      "These routes check no permission. Add authorize(), or list the route in PUBLIC_BY_DESIGN with why it's open.",
    ).toEqual([]);
  });

  // The other direction: an entry for a route that has since gained a
  // check, or gone, would leave the list reading as though the door were
  // still open — the kind of note a reviewer trusts and shouldn't have to.
  it("lists nothing that has since been closed or removed", () => {
    const stillOpen = new Set(routes.filter((r) => !r.guarded).map((r) => r.key));
    const stale = [...PUBLIC_BY_DESIGN.keys()].filter((key) => !stillOpen.has(key));
    expect(stale, "These are authorized now, or gone. Remove them from PUBLIC_BY_DESIGN.").toEqual([]);
  });
});
