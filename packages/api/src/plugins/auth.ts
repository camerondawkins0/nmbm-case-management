import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
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

// Google OIDC (Workspace SSO) — the only login path, since NMBM is
// already a Google Workspace org (discovery M27). No separate Entra ID
// path, unlike the WSL system this was adapted from.
export default fp(async function authPlugin(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const clientId = process.env.GOOGLE_OIDC_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OIDC_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OIDC_REDIRECT_URI;

  await fastify.register(cookie);
  await fastify.register(session, {
    secret: process.env.SESSION_SECRET ?? "dev-only-change-me-32-characters+",
    cookie: { secure: process.env.NODE_ENV === "production", httpOnly: true },
  });

  fastify.get("/auth/google/login", async (request, reply) => {
    if (!clientId || !redirectUri) {
      throw new Error("GOOGLE_OIDC_CLIENT_ID / GOOGLE_OIDC_REDIRECT_URI not configured");
    }
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    // Restricts login to NMBM's own Workspace domain rather than any
    // Google account — set once NMBM confirms their Workspace domain.
    url.searchParams.set("hd", "*");
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

      // TODO before production: verify the id_token signature against
      // Google's JWKS (e.g. via google-auth-library's OAuth2Client),
      // rather than trusting the payload as-is.
      const payload = JSON.parse(
        Buffer.from(id_token.split(".")[1], "base64url").toString("utf8"),
      ) as { email: string; name: string };

      const [existing] = await db.select().from(users).where(eq(users.email, payload.email));
      const user =
        existing ??
        (
          await db
            .insert(users)
            .values({ email: payload.email, displayName: payload.name })
            .returning()
        )[0];

      request.session.userId = user.id;
      return reply.redirect("/");
    },
  );

  fastify.addHook("preHandler", async (request: FastifyRequest) => {
    const userId = request.session.userId;
    if (!userId) return;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (user?.active) {
      request.currentUser = { id: user.id, email: user.email, displayName: user.displayName };
    }
  });
});

export function requireUser(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (!request.currentUser) {
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  done();
}
