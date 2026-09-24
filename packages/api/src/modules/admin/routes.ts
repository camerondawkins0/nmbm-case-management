import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { z } from "zod";
import { authorize } from "../../plugins/authorize.js";
import * as service from "./service.js";
import * as audit from "./audit.js";

const roleSchema = z.object({ roleCode: z.string().min(1) });

export default async function adminRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  fastify.get(
    "/api/admin/users",
    { preHandler: authorize("admin.users.manage") },
    async () => service.listUsers(db),
  );

  fastify.get(
    "/api/admin/roles",
    { preHandler: authorize("admin.users.manage") },
    async () => service.listRoles(db),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/roles",
    { preHandler: authorize("admin.users.manage") },
    async (request) => {
      const { roleCode } = roleSchema.parse(request.body);
      return service.grantRole(db, request.params.id, roleCode, request.currentUser!.id);
    },
  );

  fastify.delete<{ Params: { id: string; roleCode: string } }>(
    "/api/admin/users/:id/roles/:roleCode",
    { preHandler: authorize("admin.users.manage") },
    async (request) =>
      service.revokeRole(db, request.params.id, request.params.roleCode, request.currentUser!.id),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/deactivate",
    { preHandler: authorize("admin.users.manage") },
    async (request) => service.deactivateUser(db, request.params.id, request.currentUser!.id),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/reactivate",
    { preHandler: authorize("admin.users.manage") },
    async (request) => service.reactivateUser(db, request.params.id, request.currentUser!.id),
  );

  // M30: nothing is deleted, so the trail is the answer to "who changed
  // this". Read-only by construction — there is no write endpoint.
  fastify.get<{ Querystring: { limit?: string } }>(
    "/api/admin/audit",
    { preHandler: authorize("admin.settings.manage") },
    async (request) => audit.listRecent(db, Number(request.query.limit ?? 100)),
  );
}
