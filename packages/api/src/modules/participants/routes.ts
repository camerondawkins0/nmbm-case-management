import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { participantCreateSchema } from "@nmbm/shared";
import { authorize, getPermissions } from "../../plugins/authorize.js";
import * as service from "./service.js";

// routes.ts: parse with Zod, authorize(), delegate. Never touches
// Drizzle directly — see docs/agent/map.md.
export default async function participantRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  fastify.get(
    "/api/participants",
    { preHandler: authorize("participants.read.own") },
    async (request) => {
      const caller = request.currentUser!;
      const permissions = await getPermissions(db, caller.id);
      return service.listVisibleParticipants(db, {
        id: caller.id,
        canReadAll: permissions.has("participants.read.all"),
      });
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
