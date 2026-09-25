import { inject } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { buildServer } from "../../src/server.js";

export type Response = { status: number; body: any; headers: Record<string, unknown> };

// Environment is read when the auth plugin registers, so it's set before
// each server is built. Google is "configured" with dummy values: no test
// reaches Google, but the login route needs to believe it could.
export async function startApp(env: Record<string, string> = {}) {
  Object.assign(process.env, {
    DATABASE_URL: inject("databaseUrl"),
    NODE_ENV: "test",
    ALLOW_DEV_LOGIN: "true",
    GOOGLE_OIDC_CLIENT_ID: "test-client.apps.googleusercontent.com",
    GOOGLE_OIDC_CLIENT_SECRET: "test-secret",
    GOOGLE_OIDC_REDIRECT_URI: "http://localhost:8080/auth/google/callback",
    GOOGLE_WORKSPACE_DOMAIN: "nmbm.example.org",
    SESSION_IDLE_MINUTES: "60",
    ...env,
  });
  const app = await buildServer({ logger: false });
  await app.ready();
  return { app, db: app.db as Db };
}

export function sessionCookie(setCookie: unknown): string | null {
  const header = Array.isArray(setCookie) ? setCookie : [setCookie];
  const found = header.find((c) => typeof c === "string" && c.startsWith("sessionId="));
  return found ? (found as string).split(";")[0] : null;
}

// Signs in through the real dev-login route, so the session is built
// exactly as a browser's would be.
export async function signIn(app: FastifyInstance, email: string) {
  const res = await app.inject({ method: "GET", url: `/auth/dev-login?email=${encodeURIComponent(email)}` });
  const cookie = sessionCookie(res.headers["set-cookie"]);
  if (res.statusCode !== 302 || !cookie) {
    throw new Error(`dev-login for ${email} failed: ${res.statusCode} ${res.body}`);
  }
  return client(app, cookie);
}

export type Client = ReturnType<typeof client>;

export function client(app: FastifyInstance, cookie?: string) {
  async function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown): Promise<Response> {
    const res = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
      headers: cookie ? { cookie } : {},
    });
    let body: unknown = res.body;
    try {
      body = res.json();
    } catch {
      // Not JSON — a redirect or an empty reply; the raw body stands.
    }
    return { status: res.statusCode, body, headers: res.headers };
  }
  return {
    cookie,
    get: (url: string) => call("GET", url),
    post: (url: string, payload: unknown = {}) => call("POST", url, payload),
    put: (url: string, payload: unknown) => call("PUT", url, payload),
    patch: (url: string, payload: unknown) => call("PATCH", url, payload),
    del: (url: string) => call("DELETE", url),
  };
}
