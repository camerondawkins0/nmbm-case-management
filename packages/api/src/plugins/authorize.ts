import type { FastifyRequest, FastifyReply } from "fastify";
import type { Db } from "@nmbm/db";
import { userRoles, rolePermissions, permissions as permissionsTable } from "@nmbm/db";
import { eq } from "drizzle-orm";
import type { Permission } from "@nmbm/shared";
import { requireUser } from "./auth.js";

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
export function authorize(code: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
    requireUser(request, reply, () => {});
    if (!request.currentUser) return; // requireUser already replied 401

    const db = (request.server as unknown as { db: Db }).db;
    const codes = await getPermissions(db, request.currentUser.id);
    if (!codes.has(code)) {
      reply.code(403).send({ error: "forbidden", required: code });
      return;
    }
    done();
  };
}
