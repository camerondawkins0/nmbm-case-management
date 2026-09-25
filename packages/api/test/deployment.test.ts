import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { sessions } from "@nmbm/db";
import { sql } from "drizzle-orm";
import { startApp, signIn, client, sessionCookie } from "./support/app.js";
import { staff } from "./support/fixtures.js";

// A stand-in for the web build, so these tests don't depend on Vite.
const webDir = mkdtempSync(join(tmpdir(), "nmbm-web-"));
mkdirSync(join(webDir, "assets"));
writeFileSync(join(webDir, "index.html"), "<!doctype html><title>NMBM</title><div id=root></div>");
writeFileSync(join(webDir, "assets", "index-abc123.js"), "console.log(1)");

let app: FastifyInstance;
let db: Db;
const html = { accept: "text/html,application/xhtml+xml" };

beforeAll(async () => ({ app, db } = await startApp({ WEB_DIST_DIR: webDir })));
afterAll(async () => app?.close());

const rowCount = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(sessions))[0].n;

describe("sessions are shared, and survive a restart", () => {
  // Cloud Run runs more than one instance and replaces them on every
  // deploy. With sessions in memory, each of those signed people out.
  it("honours a session on another instance of the server", async () => {
    const user = await staff(db, "community_health_worker");
    const first = await signIn(app, user.email);
    const second = await startApp({ WEB_DIST_DIR: webDir });
    try {
      const res = await client(second.app, first.cookie).get("/api/me");
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(user.email);
    } finally {
      await second.app.close();
    }
  });

  it("signs out everywhere when signed out on one instance", async () => {
    const user = await staff(db, "community_health_worker");
    const as = await signIn(app, user.email);
    const second = await startApp({ WEB_DIST_DIR: webDir });
    try {
      await second.app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: as.cookie! } });
      expect((await as.get("/api/me")).status).toBe(401);
    } finally {
      await second.app.close();
    }
  });

  // Anyone who could read the table could otherwise become any
  // signed-in user.
  it("stores a hash of the session id, never the id", async () => {
    const user = await staff(db, "community_health_worker");
    const as = await signIn(app, user.email);
    const raw = decodeURIComponent(as.cookie!.split("=")[1]);
    const id = raw.slice(0, raw.lastIndexOf("."));
    const stored = (await db.select({ idHash: sessions.idHash }).from(sessions)).map((r) => r.idHash);
    expect(stored).not.toContain(id);
    expect(stored).toContain(createHash("sha256").update(id).digest("hex"));
  });

  it("refuses a session past its expiry, whatever the cookie says", async () => {
    const user = await staff(db, "community_health_worker");
    const as = await signIn(app, user.email);
    const raw = decodeURIComponent(as.cookie!.split("=")[1]);
    const hash = createHash("sha256").update(raw.slice(0, raw.lastIndexOf("."))).digest("hex");
    await db.execute(sql`update sessions set expires_at = now() - interval '1 minute' where id_hash = ${hash}`);
    expect((await as.get("/api/me")).status).toBe(401);
  });

  // Cloud Run's health checks would otherwise add a row every few seconds.
  it("doesn't write a session for anonymous requests", async () => {
    const before = await rowCount();
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "GET", url: "/api/health" });
      await app.inject({ method: "GET", url: "/api/me" });
      await app.inject({ method: "GET", url: "/", headers: html });
    }
    expect(await rowCount()).toBe(before);
  });
});

describe("one service serves the app and the API", () => {
  it("serves the app at / and at any path the app's router owns", async () => {
    for (const url of ["/", "/participants/abc", "/follow-ups"]) {
      const res = await app.inject({ method: "GET", url, headers: html });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<div id=root>');
      expect(res.headers["cache-control"]).toBe("no-cache");
    }
  });

  it("caches hashed assets for good", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("keeps unknown API and sign-in paths as JSON 404s, not the app", async () => {
    for (const url of ["/api/nothing-here", "/auth/nothing-here"]) {
      const res = await app.inject({ method: "GET", url, headers: html });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: "not_found" });
    }
    expect((await app.inject({ method: "POST", url: "/participants" })).statusCode).toBe(404);
  });
});

describe("security headers", () => {
  it("sets them on pages and API responses", async () => {
    const page = await app.inject({ method: "GET", url: "/", headers: html });
    expect(page.headers["x-frame-options"]).toBe("DENY");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    expect(page.headers["referrer-policy"]).toBe("same-origin");
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(page.headers["content-security-policy"]).not.toContain("unsafe-inline");
  });

  it("never lets an API response be cached", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("in production", () => {
  const production = { NODE_ENV: "production", SESSION_SECRET: "x".repeat(40), WEB_DIST_DIR: webDir };

  it("refuses to start without a session secret", async () => {
    await expect(startApp({ NODE_ENV: "production", SESSION_SECRET: "" })).rejects.toThrow(/SESSION_SECRET/);
  });

  // With a real account: for someone who doesn't exist the route would
  // answer 404 "no such user" even if it were wrongly switched on.
  it("has no development sign-in route at all", async () => {
    const user = await staff(db, "system_administrator");
    const prod = await startApp({ ...production, ALLOW_DEV_LOGIN: "true" });
    try {
      const res = await prod.app.inject({ method: "GET", url: `/auth/dev-login?email=${user.email}` });
      expect(res.statusCode).toBe(404);
      expect(sessionCookie(res.headers["set-cookie"])).toBeNull();
    } finally {
      await prod.app.close();
    }
  });

  it("sends HSTS", async () => {
    const prod = await startApp({ ...production, TRUST_PROXY: "true" });
    try {
      const res = await prod.app.inject({ method: "GET", url: "/api/health" });
      expect(res.headers["strict-transport-security"]).toContain("max-age=");
    } finally {
      await prod.app.close();
    }
  });

  // Cloud Run forwards plain HTTP and says so in X-Forwarded-Proto. If
  // the server doesn't trust that, the Secure cookie never goes out and
  // sign-in fails without an error.
  it("sets the secure session cookie behind Cloud Run's proxy only when told to trust it", async () => {
    const behindProxy = { "x-forwarded-proto": "https" };
    const trusting = await startApp({ ...production, TRUST_PROXY: "true" });
    const untrusting = await startApp({ ...production, TRUST_PROXY: "false" });
    try {
      const ok = await trusting.app.inject({ method: "GET", url: "/auth/google/login", headers: behindProxy });
      const cookie = String(ok.headers["set-cookie"] ?? "");
      expect(sessionCookie(ok.headers["set-cookie"])).not.toBeNull();
      expect(cookie).toContain("Secure");

      const lost = await untrusting.app.inject({ method: "GET", url: "/auth/google/login", headers: behindProxy });
      expect(sessionCookie(lost.headers["set-cookie"])).toBeNull();
    } finally {
      await trusting.app.close();
      await untrusting.app.close();
    }
  });
});
