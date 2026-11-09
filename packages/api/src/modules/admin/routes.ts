import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { z } from "zod";
import { authorize } from "../../plugins/authorize.js";
import * as service from "./service.js";
import * as audit from "./audit.js";
import { appSettingUpdateSchema, roleCreateSchema, rolePermissionSchema, roleUpdateSchema } from "@nmbm/shared";
import * as grid from "./permissions.js";
import * as settings from "../../lib/settings.js";

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

  // M31: settings NMBM change themselves, without asking for a deploy.
  fastify.get(
    "/api/admin/settings",
    { preHandler: authorize("admin.settings.manage") },
    async () => settings.listSettings(db),
  );

  fastify.put<{ Params: { key: string } }>(
    "/api/admin/settings/:key",
    { preHandler: authorize("admin.settings.manage") },
    async (request) => {
      const { value } = appSettingUpdateSchema.parse(request.body);
      return settings.updateSetting(db, request.params.key, value, request.currentUser!.id);
    },
  );

  // NMBM decide their own permission grid (see migration 0015).
  fastify.get(
    "/api/admin/permissions",
    { preHandler: authorize("admin.roles.manage") },
    async () => grid.getGrid(db),
  );

  fastify.put<{ Params: { role: string; permission: string } }>(
    "/api/admin/roles/:role/permissions/:permission",
    { preHandler: authorize("admin.roles.manage") },
    async (request) => {
      const { granted } = rolePermissionSchema.parse(request.body);
      return grid.setGrant(db, request.params.role, request.params.permission, granted, request.currentUser!.id);
    },
  );

  // Roles NMBM add themselves (migration 0016).
  fastify.post(
    "/api/admin/roles",
    { preHandler: authorize("admin.roles.manage") },
    async (request, reply) => {
      const input = roleCreateSchema.parse(request.body);
      reply.code(201);
      return grid.createRole(db, input, request.currentUser!.id);
    },
  );

  fastify.patch<{ Params: { role: string } }>(
    "/api/admin/roles/:role",
    { preHandler: authorize("admin.roles.manage") },
    async (request) => {
      const input = roleUpdateSchema.parse(request.body);
      return grid.updateRole(db, request.params.role, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { role: string } }>(
    "/api/admin/roles/:role/retire",
    { preHandler: authorize("admin.roles.manage") },
    async (request) => grid.retireRole(db, request.params.role, request.currentUser!.id),
  );
}
