import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { consentCreateSchema, consentRevokeSchema } from "@nmbm/shared";
import { authorize } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import { assertCanSee } from "../participants/service.js";
import * as service from "./service.js";

export default async function consentRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  fastify.post(
    "/api/consents",
    { preHandler: authorize("consents.write") },
    async (request, reply) => {
      const input = consentCreateSchema.parse(request.body);
      const caller = await resolveScope(db, request.currentUser!.id);
      await assertCanSee(db, caller, input.participantId);
      const consent = await service.recordConsent(db, input, request.currentUser!.id);
      reply.code(201);
      return consent;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/consents/:id/revoke",
    { preHandler: authorize("consents.write") },
    async (request) => {
      const { reason } = consentRevokeSchema.parse(request.body);
      return service.revokeConsent(db, request.params.id, reason, request.currentUser!.id);
    },
  );
}
