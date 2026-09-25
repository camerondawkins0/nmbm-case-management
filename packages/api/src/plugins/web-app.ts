import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";

const defaultDir = fileURLToPath(new URL("../../../web/dist", import.meta.url));

// The API and the built React app are one Cloud Run service. API and
// sign-in routes are registered first and win; anything else is a file
// from the build, or — for a path like /participants/abc that only the
// browser's router knows — the app's index.html.
export async function registerWebApp(fastify: FastifyInstance, dir = process.env.WEB_DIST_DIR ?? defaultDir) {
  const hasApp = existsSync(`${dir}/index.html`);
  if (!hasApp) {
    // Normal in development, where Vite serves the app on its own port.
    fastify.log.warn(`No web build at ${dir}; serving the API only`);
  } else {
    await fastify.register(fastifyStatic, {
      root: dir,
      index: false,
      wildcard: false,
      setHeaders(res, path) {
        // Vite names built assets by content hash, so they never change
        // under the same name. index.html must always be re-checked, or a
        // deploy wouldn't reach people until their cache expired.
        res.setHeader(
          "cache-control",
          path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    });
  }

  fastify.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const isAppRoute =
      hasApp &&
      request.method === "GET" &&
      !request.url.startsWith("/api/") &&
      !request.url.startsWith("/auth/") &&
      (request.headers.accept ?? "").includes("text/html");
    if (isAppRoute) {
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    }
    // An unknown API path stays a JSON 404 rather than a page of HTML a
    // caller would try to parse.
    return reply.code(404).send({ error: "not_found", message: "Not found" });
  });
}

// Headers on every response. The app holds client records, so: no
// framing (clickjacking), no MIME sniffing, no referrer leaking a record
// URL to another site, and API responses never cached by a browser or a
// proxy. The CSP is strict because it can be — the build has no inline
// script or style, and nothing loads from another origin.
export function registerSecurityHeaders(fastify: FastifyInstance, { https }: { https: boolean }) {
  fastify.addHook("onSend", async (request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "same-origin");
    reply.header(
      "content-security-policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; " +
        "font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    if (https) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    if (request.url.startsWith("/api/")) reply.header("cache-control", "no-store");
  });
}
