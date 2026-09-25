import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { userRoles, roles as rolesTable } from "@nmbm/db";
import { eq } from "drizzle-orm";
import { getPermissions } from "../../plugins/authorize.js";

// The SPA can't render its own navigation without knowing who is signed
// in and what they're allowed to do — every gated control on the client
// reads from this. It is not the authorization check itself: that stays
// server-side on each route (CLAUDE.md hard rule 2).
export default async function meRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  // PUBLIC_BY_DESIGN: answers "is anyone signed in?", which the login
  // redirect needs before a session exists. Returns 401 with no detail
  // rather than leaking anything to an anonymous caller.
  fastify.get("/api/me", async (request, reply) => {
    if (!request.currentUser) {
      // `reason` lets the login page say "you were signed out after an
      // hour idle" instead of looking as if nothing happened. It reveals
      // only that this browser's own session timed out.
      return reply
        .code(401)
        .send({ error: "unauthorized", reason: request.sessionExpired ? "session_expired" : null });
    }
    const { id, email, displayName } = request.currentUser;
    const [assignedRoles, permissions] = await Promise.all([
      db
        .select({ code: rolesTable.code, label: rolesTable.label })
        .from(userRoles)
        .innerJoin(rolesTable, eq(rolesTable.id, userRoles.roleId))
        .where(eq(userRoles.userId, id)),
      getPermissions(db, id),
    ]);

    return {
      id,
      email,
      displayName,
      roles: assignedRoles,
      permissions: [...permissions].sort(),
    };
  });
}
