import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { participantCreateSchema } from "@nmbm/shared";
import { authorize, authorizeAny, CAN_READ_PARTICIPANTS } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import * as service from "./service.js";

// routes.ts: parse with Zod, authorize(), delegate. Never touches
// Drizzle directly — see docs/agent/map.md.
export default async function participantRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  fastify.get(
    "/api/participants",
    { preHandler: authorizeAny(CAN_READ_PARTICIPANTS) },
    async (request) => {
      const caller = await resolveScope(db, request.currentUser!.id);
      return service.listVisibleParticipants(db, caller);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/participants/:id",
    { preHandler: authorizeAny(CAN_READ_PARTICIPANTS) },
    async (request) => {
      const caller = await resolveScope(db, request.currentUser!.id);
      return service.getParticipant(db, caller, request.params.id);
    },
  );

  fastify.post(
    "/api/participants",
    { preHandler: authorize("participants.write") },
    async (request, reply) => {
      const input = participantCreateSchema.parse(request.body);
      const participant = await service.createParticipant(db, input, request.currentUser!.id);
      reply.code(201);
      return participant;
    },
  );
}
