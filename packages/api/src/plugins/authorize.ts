import type { FastifyRequest, FastifyReply } from "fastify";
import type { Db } from "@nmbm/db";
import { userRoles, rolePermissions, permissions as permissionsTable } from "@nmbm/db";
import { eq } from "drizzle-orm";
import type { Permission } from "@nmbm/shared";

// Computed from the caller's roles at request time (not cached on the
// session), so a role change takes effect on the next request rather
// than the next login.
export async function getPermissions(db: Db, userId: string): Promise<Set<Permission>> {
  const grants = await db
    .select({ code: permissionsTable.code })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissionsTable, eq(permissionsTable.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));
  return new Set(grants.map((g) => g.code as Permission));
}

// Every route carries authorize() or is explicitly listed as public —
// CLAUDE.md hard rule 2.
//
// Async with no `done` argument on purpose: Fastify treats a hook that
// declares `done` as callback-style and ignores the returned promise,
// so an async hook that also calls done() runs the handler before the
// permission check resolves.
export function authorize(code: Permission) {
  return authorizeAny([code]);
}

// For capabilities split across codes that differ only by scope:
// participants.read.own and participants.read.all are the same act of
// reading, and the service decides how much comes back. Requiring the
// exact code instead locks out anyone holding only the broader one — a
// Clinical Director with read.all but not read.own could not open the
// caseload screen at all.
export function authorizeAny(accepted: Permission[]) {
  return async function authorizeHook(request: FastifyRequest, reply: FastifyReply) {
    if (!request.currentUser) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const { db } = request.server;
    const codes = await getPermissions(db, request.currentUser.id);
    if (!accepted.some((code) => codes.has(code))) {
      return reply.code(403).send({ error: "forbidden", required: accepted.join(" or ") });
    }
  };
}

// The one place that says what "may read a participant record" means,
// so a new read route can't accidentally require only the narrow code.
export const CAN_READ_PARTICIPANTS: Permission[] = [
  "participants.read.own",
  "participants.read.all",
];
