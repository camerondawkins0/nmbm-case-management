import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import { OAuth2Client } from "google-auth-library";
import type { Db } from "@nmbm/db";
import { users } from "@nmbm/db";
import { eq } from "drizzle-orm";

declare module "fastify" {
  interface Session {
    userId?: string;
  }
  interface FastifyRequest {
    currentUser?: { id: string; email: string; displayName: string };
  }
}

// Google OIDC (Workspace SSO) — the only real login path, since NMBM is
// already a Google Workspace org (discovery M27). No separate Entra ID
// path, unlike the WSL system this was adapted from.
export default fp(async function authPlugin(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const clientId = process.env.GOOGLE_OIDC_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OIDC_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OIDC_REDIRECT_URI;
  // Restricts sign-in to NMBM's own Workspace domain rather than any
  // Google account. Still unanswered by NMBM — until it's set, the
  // login route refuses to start the flow rather than silently
  // accepting every Google account on the internet.
  const workspaceDomain = process.env.GOOGLE_WORKSPACE_DOMAIN;

  await fastify.register(cookie);
  await fastify.register(session, {
    secret: process.env.SESSION_SECRET ?? "dev-only-change-me-32-characters+",
    cookie: { secure: process.env.NODE_ENV === "production", httpOnly: true },
  });

  async function findOrCreateUser(email: string, displayName: string) {
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) return existing;
    const [created] = await db.insert(users).values({ email, displayName }).returning();
    return created;
  }

  fastify.get("/auth/google/login", async (request, reply) => {
    if (!clientId || !redirectUri) {
      throw new Error("GOOGLE_OIDC_CLIENT_ID / GOOGLE_OIDC_REDIRECT_URI not configured");
    }
    if (!workspaceDomain) {
      throw new Error("GOOGLE_WORKSPACE_DOMAIN not configured — refusing to allow any Google account");
    }
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("hd", workspaceDomain);
    return reply.redirect(url.toString());
  });

  fastify.get<{ Querystring: { code?: string } }>(
    "/auth/google/callback",
    async (request, reply) => {
      const { code } = request.query;
      if (!code || !clientId || !clientSecret || !redirectUri) {
        throw new Error("Missing OAuth code or Google OIDC configuration");
      }

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) {
        throw new Error(`Google token exchange failed: ${tokenRes.status}`);
      }
      const { id_token } = (await tokenRes.json()) as { id_token: string };

      // Verified against Google's JWKS rather than decoded and trusted:
      // an unverified payload is forgeable by anyone who can reach the
      // callback, which would be a full authentication bypass.
      const ticket = await new OAuth2Client(clientId).verifyIdToken({
        idToken: id_token,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.email || !payload.email_verified) {
        return reply.code(401).send({ error: "unverified_google_account" });
      }
      // `hd` on the authorize request is a UI hint, not enforcement —
      // Google will still return a token for another domain if the user
      // picks one, so the domain is checked again here.
      if (workspaceDomain && payload.hd !== workspaceDomain) {
        return reply.code(403).send({ error: "wrong_workspace_domain" });
      }

      const user = await findOrCreateUser(payload.email, payload.name ?? payload.email);
      request.session.userId = user.id;
      return reply.redirect("/");
    },
  );

  // Local development and demos only. Double-gated, and the route is
  // never registered unless both hold, so it 404s in production rather
  // than existing as a disabled bypass.
  if (process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_LOGIN === "true") {
    fastify.log.warn("ALLOW_DEV_LOGIN is on — /auth/dev-login bypasses Google sign-in");
    fastify.get<{ Querystring: { email?: string } }>("/auth/dev-login", async (request, reply) => {
      const email = request.query.email;
      if (!email) return reply.code(400).send({ error: "email query parameter required" });
      const [user] = await db.select().from(users).where(eq(users.email, email));
      if (!user) return reply.code(404).send({ error: "no such user — run seed:synthetic first" });
      request.session.userId = user.id;
      return reply.redirect("/");
    });
  }

  fastify.post("/auth/logout", async (request, reply) => {
    await request.session.destroy();
    return reply.redirect("/login");
  });

  fastify.addHook("preHandler", async (request: FastifyRequest) => {
    const userId = request.session.userId;
    if (!userId) return;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (user?.active) {
      request.currentUser = { id: user.id, email: user.email, displayName: user.displayName };
    }
  });
});
