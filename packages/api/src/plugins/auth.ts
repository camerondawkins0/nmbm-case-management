import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@nmbm/db";
import { users, userRoles, roles } from "@nmbm/db";
import { eq, asc } from "drizzle-orm";
import {
  DEFAULT_SESSION_IDLE_MINUTES,
  SESSION_MAX_HOURS,
  type SignInError,
} from "@nmbm/shared";
import { writeAudit } from "./audit.js";
import { PostgresSessionStore } from "./session-store.js";

declare module "fastify" {
  interface Session {
    userId?: string;
    // One-use CSRF token for the Google round trip — see /auth/google/login.
    oauthState?: string;
    returnTo?: string;
    signedInAt?: number;
    lastSeenAt?: number;
  }
  interface FastifyRequest {
    currentUser?: { id: string; email: string; displayName: string };
    // Set when a session existed but timed out on this request, so /api/me
    // can tell the login page why the person is looking at it.
    sessionExpired?: boolean;
  }
}

// Where to land after signing in. Same-origin paths only: "//host" and
// "/\host" are read by browsers as another site, and browsers strip tabs
// and newlines before parsing — any of those would turn the sign-in page
// into an open redirect that carries NMBM's name.
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!/^\/(?![/\\])[^\s\\]*$/.test(value)) return "/";
  if (value.startsWith("/auth/") || value === "/login" || value.startsWith("/login?")) return "/";
  return value;
}

function sameString(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
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
  // Google account. There is no default: until it's set, sign-in refuses
  // to start rather than accepting every Google account on the internet.
  const workspaceDomain = process.env.GOOGLE_WORKSPACE_DOMAIN;
  const configured = Boolean(clientId && clientSecret && redirectUri && workspaceDomain);
  const idleMs =
    Number(process.env.SESSION_IDLE_MINUTES ?? DEFAULT_SESSION_IDLE_MINUTES) * 60_000;
  const maxMs = SESSION_MAX_HOURS * 3_600_000;

  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    // The fallback below is public in this repository; a production
    // session signed with it could be forged by anyone who has read it.
    throw new Error("SESSION_SECRET must be set in production");
  }

  await fastify.register(cookie);
  await fastify.register(session, {
    secret: process.env.SESSION_SECRET || "dev-only-change-me-32-characters+",
    // Shared by every instance, and survives restarts — see
    // plugins/session-store.ts.
    store: new PostgresSessionStore(db, maxMs),
    // A session is written only once there's something in it. Otherwise
    // every anonymous request — Cloud Run's health checks included —
    // would add a row.
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      // Lax, not strict: Google's redirect back to the callback is a
      // cross-site top-level navigation, and it has to carry the cookie
      // holding the state token.
      sameSite: "lax",
      path: "/",
      maxAge: maxMs,
    },
  });

  function refuse(reply: FastifyReply, code: SignInError) {
    return reply.redirect(`/login?error=${code}`);
  }

  async function findOrCreateUser(email: string, displayName: string) {
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) return { user: existing, created: false };
    // Anyone in NMBM's Workspace can get this far, and arrives with no
    // role and therefore no access. They see a holding page until an
    // administrator assigns one — see the Staff page.
    const [created] = await db.insert(users).values({ email, displayName }).returning();
    return { user: created, created: true };
  }

  // Everything that establishes a session goes through here, so the
  // real and the development path can't drift apart on fixation or audit.
  async function startSession(
    request: FastifyRequest,
    userId: string,
    via: "google" | "dev-login",
  ) {
    const returnTo = safeReturnTo(request.session.returnTo);
    // A fresh session id at the moment of sign-in, so an id planted in
    // the browser beforehand never becomes an authenticated one.
    await request.session.regenerate();
    const now = Date.now();
    request.session.userId = userId;
    request.session.signedInAt = now;
    request.session.lastSeenAt = now;
    await writeAudit(db, {
      actorUserId: userId,
      action: "auth.signed_in",
      entityType: "user",
      entityId: userId,
      detail: via,
    });
    return returnTo;
  }

  fastify.get<{ Querystring: { returnTo?: string } }>(
    "/auth/google/login",
    async (request, reply) => {
      if (!configured) {
        request.log.error(
          "Google sign-in is not configured: GOOGLE_OIDC_CLIENT_ID, GOOGLE_OIDC_CLIENT_SECRET, " +
            "GOOGLE_OIDC_REDIRECT_URI and GOOGLE_WORKSPACE_DOMAIN are all required",
        );
        return refuse(reply, "not_configured");
      }
      // Bound to this browser's session and checked on the way back.
      // Without it, anyone could send a victim through the callback with
      // the attacker's own authorisation code and have them working —
      // and entering participant notes — in the attacker's account.
      const state = randomBytes(32).toString("base64url");
      request.session.oauthState = state;
      request.session.returnTo = safeReturnTo(request.query.returnTo);

      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", clientId!);
      url.searchParams.set("redirect_uri", redirectUri!);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("hd", workspaceDomain!);
      // Staff are often signed into a personal Google account in the
      // same browser. Asking every time is what stops that account being
      // picked silently and refused with no idea why.
      url.searchParams.set("prompt", "select_account");
      return reply.redirect(url.toString());
    },
  );

  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/google/callback",
    async (request, reply) => {
      const { code, state, error } = request.query;
      const expected = request.session.oauthState;
      request.session.oauthState = undefined;

      if (error) return refuse(reply, error === "access_denied" ? "cancelled" : "google_failed");
      if (!configured) return refuse(reply, "not_configured");
      if (!code || !state || !expected || !sameString(state, expected)) {
        return refuse(reply, "expired");
      }

      let payload: TokenPayload | undefined;
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId!,
            client_secret: clientSecret!,
            redirect_uri: redirectUri!,
            grant_type: "authorization_code",
          }),
        });
        if (!tokenRes.ok) throw new Error(`token exchange returned ${tokenRes.status}`);
        const { id_token } = (await tokenRes.json()) as { id_token: string };
        // Verified against Google's JWKS rather than decoded and trusted:
        // an unverified payload is forgeable by anyone who can reach the
        // callback, which would be a full authentication bypass.
        const ticket = await new OAuth2Client(clientId).verifyIdToken({
          idToken: id_token,
          audience: clientId!,
        });
        payload = ticket.getPayload();
      } catch (err) {
        request.log.error({ err }, "Google sign-in did not complete");
        return refuse(reply, "google_failed");
      }

      if (!payload?.email || !payload.email_verified) return refuse(reply, "unverified");
      // `hd` on the authorize request is a UI hint, not enforcement —
      // Google will still return a token for another domain if the user
      // picks one, so the domain is checked again here.
      if (payload.hd !== workspaceDomain) {
        request.log.warn({ domain: payload.hd ?? "(personal account)" }, "sign-in refused: outside the Workspace domain");
        return refuse(reply, "wrong_domain");
      }

      const { user, created } = await findOrCreateUser(payload.email, payload.name ?? payload.email);
      if (created) {
        await writeAudit(db, {
          actorUserId: user.id,
          action: "user.provisioned",
          entityType: "user",
          entityId: user.id,
          detail: "first Google sign-in; no role assigned",
        });
      }
      // U9: a deactivated account is kept, not deleted, so its notes keep
      // their author — which means Google will happily vouch for it.
      if (!user.active) {
        await writeAudit(db, {
          actorUserId: user.id,
          action: "auth.sign_in_refused",
          entityType: "user",
          entityId: user.id,
          detail: "account deactivated",
        });
        return refuse(reply, "deactivated");
      }

      return reply.redirect(await startSession(request, user.id, "google"));
    },
  );

  // Local development and demos only. Double-gated, and the routes are
  // never registered unless both hold, so they 404 in production rather
  // than existing as a disabled bypass.
  if (process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_LOGIN === "true") {
    fastify.log.warn("ALLOW_DEV_LOGIN is on — /auth/dev-login bypasses Google sign-in");

    fastify.get<{ Querystring: { email?: string; returnTo?: string } }>(
      "/auth/dev-login",
      async (request, reply) => {
        const email = request.query.email;
        if (!email) return reply.code(400).send({ error: "email query parameter required" });
        const [user] = await db.select().from(users).where(eq(users.email, email));
        if (!user) return reply.code(404).send({ error: "no such user — run seed:synthetic first" });
        if (!user.active) return refuse(reply, "deactivated");
        request.session.returnTo = safeReturnTo(request.query.returnTo);
        return reply.redirect(await startSession(request, user.id, "dev-login"));
      },
    );

    // Lets the login page offer the seeded staff by role, so a demo
    // doesn't depend on remembering email addresses. Exists only under
    // the same gate as the route above; in production the page asks,
    // gets a 404, and shows nothing.
    fastify.get("/auth/dev-login/accounts", async () => {
      const rows = await db
        .select({ email: users.email, displayName: users.displayName, role: roles.label })
        .from(users)
        .leftJoin(userRoles, eq(userRoles.userId, users.id))
        .leftJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(users.active, true))
        .orderBy(asc(users.displayName));
      const byEmail = new Map<string, { email: string; displayName: string; roles: string[] }>();
      for (const row of rows) {
        const entry = byEmail.get(row.email) ?? { email: row.email, displayName: row.displayName, roles: [] };
        if (row.role) entry.roles.push(row.role);
        byEmail.set(row.email, entry);
      }
      return [...byEmail.values()];
    });
  }

  // Sign-out is a plain HTML form post, which a browser always sends as
  // application/x-www-form-urlencoded — a type Fastify refuses with 415
  // by default. The parser is added inside this encapsulated scope only:
  // accepting form bodies across the API would let any site's HTML form
  // post to it, and every other route stays JSON-only.
  await fastify.register(async (scope) => {
    scope.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_request, _body, done) => done(null, {}),
    );
    scope.post("/auth/logout", async (request, reply) => {
      const userId = request.session.userId;
      if (userId) {
        await writeAudit(db, {
          actorUserId: userId,
          action: "auth.signed_out",
          entityType: "user",
          entityId: userId,
        });
      }
      await request.session.destroy();
      return reply.redirect("/login?signed_out=1");
    });
  });

  fastify.addHook("preHandler", async (request: FastifyRequest) => {
    const userId = request.session.userId;
    if (!userId) return;

    const now = Date.now();
    const lastSeen = request.session.lastSeenAt ?? 0;
    const signedIn = request.session.signedInAt ?? 0;
    if (now - lastSeen > idleMs || now - signedIn > maxMs) {
      await request.session.destroy();
      request.sessionExpired = true;
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (user?.active) {
      request.session.lastSeenAt = now;
      request.currentUser = { id: user.id, email: user.email, displayName: user.displayName };
    }
  });
});
