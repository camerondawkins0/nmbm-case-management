import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { startApp, signIn, client, sessionCookie } from "./support/app.js";
import { staff } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;

beforeAll(async () => ({ app, db } = await startApp()));
afterAll(async () => app?.close());

const location = (res: { headers: Record<string, unknown> }) => String(res.headers.location ?? "");

describe("the Google round trip", () => {
  it("sends a one-use state token, the Workspace domain and the account chooser", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/login" });
    const url = new URL(location({ headers: res.headers }));
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("state")).toMatch(/^[\w-]{40,}$/);
    expect(url.searchParams.get("hd")).toBe("nmbm.example.org");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  // Without the state check, anyone could complete sign-in in a
  // victim's browser with the attacker's own authorisation code.
  it("refuses a callback whose state doesn't match this browser's", async () => {
    const start = await app.inject({ method: "GET", url: "/auth/google/login" });
    const cookie = sessionCookie(start.headers["set-cookie"])!;
    const res = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=attacker-code&state=forged",
      headers: { cookie },
    });
    expect(location(res)).toBe("/login?error=expired");
  });

  it("refuses a callback with no session at all", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/callback?code=x&state=y" });
    expect(location(res)).toBe("/login?error=expired");
  });

  it("reports a cancellation at Google as cancelled", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/callback?error=access_denied" });
    expect(location(res)).toBe("/login?error=cancelled");
  });

  it("explains an unconfigured installation instead of failing with a 500", async () => {
    const bare = await startApp({ GOOGLE_WORKSPACE_DOMAIN: "" });
    try {
      const res = await bare.app.inject({ method: "GET", url: "/auth/google/login" });
      expect(location(res)).toBe("/login?error=not_configured");
    } finally {
      await bare.app.close();
    }
  });
});

describe("sessions", () => {
  it("issues a new session id at sign-in, and the old one signs nobody in", async () => {
    const user = await staff(db, "community_health_worker");
    const start = await app.inject({ method: "GET", url: "/auth/google/login" });
    const before = sessionCookie(start.headers["set-cookie"])!;
    const res = await app.inject({ method: "GET", url: `/auth/dev-login?email=${user.email}`, headers: { cookie: before } });
    const after = sessionCookie(res.headers["set-cookie"])!;
    expect(after).not.toBe(before);
    expect((await client(app, before).get("/api/me")).status).toBe(401);
    expect((await client(app, after).get("/api/me")).status).toBe(200);
  });

  it("refuses a deactivated account with its own reason", async () => {
    const user = await staff(db, "community_health_worker");
    const admin = await signIn(app, (await staff(db, "system_administrator")).email);
    await admin.post(`/api/admin/users/${user.id}/deactivate`);
    const res = await app.inject({ method: "GET", url: `/auth/dev-login?email=${user.email}` });
    expect(location(res)).toBe("/login?error=deactivated");
  });

  it("returns to the requested page, and only to a same-origin path", async () => {
    const user = await staff(db, "community_health_worker");
    const go = (returnTo: string) =>
      app.inject({ method: "GET", url: `/auth/dev-login?email=${user.email}&returnTo=${encodeURIComponent(returnTo)}` });
    expect(location(await go("/programs"))).toBe("/programs");
    expect(location(await go("//evil.example"))).toBe("/");
  });

  it("ends a session after the idle limit, and says why", async () => {
    // 0.001 minutes is 60ms.
    const quick = await startApp({ SESSION_IDLE_MINUTES: "0.001" });
    try {
      const user = await staff(db, "community_health_worker");
      const as = await signIn(quick.app, user.email);
      await new Promise((r) => setTimeout(r, 150));
      const res = await as.get("/api/me");
      expect(res.status).toBe(401);
      expect(res.body.reason).toBe("session_expired");
    } finally {
      await quick.app.close();
    }
  });

  it("tells a role-less account apart from a working one", async () => {
    const newcomer = await staff(db, null);
    const me = await (await signIn(app, newcomer.email)).get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.roles).toEqual([]);
    expect(me.body.permissions).toEqual([]);
  });
});

describe("sign-out", () => {
  // A browser's form post is urlencoded. Fastify refuses that type by
  // default, and a JSON-only test passed while every real browser got 415.
  it("works as a browser form post", async () => {
    const as = await signIn(app, (await staff(db, "community_health_worker")).email);
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: as.cookie!, "content-type": "application/x-www-form-urlencoded" },
      payload: "",
    });
    expect(res.statusCode).toBe(302);
    expect(location({ headers: res.headers })).toBe("/login?signed_out=1");
    expect((await as.get("/api/me")).status).toBe(401);
  });

  it("doesn't open form bodies up on the rest of the API", async () => {
    const as = await signIn(app, (await staff(db, "community_health_worker")).email);
    const res = await app.inject({
      method: "POST",
      url: "/api/feedback",
      headers: { cookie: as.cookie!, "content-type": "application/x-www-form-urlencoded" },
      payload: "category=bug&subject=x&description=y",
    });
    expect(res.statusCode).toBe(415);
  });
});

describe("the audit trail", () => {
  it("records sign-in and sign-out", async () => {
    const user = await staff(db, "community_health_worker");
    const as = await signIn(app, user.email);
    await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: as.cookie! } });
    const admin = await signIn(app, (await staff(db, "system_administrator")).email);
    const entries = (await admin.get("/api/admin/audit?limit=100")).body as { action: string; entityId: string }[];
    const mine = entries.filter((e) => e.entityId === user.id).map((e) => e.action);
    expect(mine).toEqual(expect.arrayContaining(["auth.signed_in", "auth.signed_out"]));
  });
});
