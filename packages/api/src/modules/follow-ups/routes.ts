import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { followUpCallSchema } from "@nmbm/shared";
import { resolveScope, visibleParticipantIds } from "../../lib/caseload.js";
import { authorize, authorizeAny } from "../../plugins/authorize.js";
import * as service from "./service.js";

export default async function followUpRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const visibleTo = async (userId: string) => visibleParticipantIds(db, await resolveScope(db, userId));

  fastify.get(
    "/api/follow-ups",
    { preHandler: authorize("follow_ups.record") },
    async (request) => service.listQueue(db, await visibleTo(request.currentUser!.id)),
  );

  fastify.post(
    "/api/follow-ups",
    { preHandler: authorize("follow_ups.record") },
    async (request, reply) => {
      const input = followUpCallSchema.parse(request.body);
      const row = await service.recordCall(db, input, await resolveScope(db, request.currentUser!.id));
      reply.code(201);
      return row;
    },
  );

  // QA finds out someone wants to come back; intake is who readmits them.
  // Both need this list, and intake holds read.closed rather than
  // follow_ups.record.
  fastify.get(
    "/api/follow-ups/re-enrollment-requests",
    { preHandler: authorizeAny(["follow_ups.record", "participants.read.closed", "participants.read.all"]) },
    async (request) => service.listReEnrollmentRequests(db, await visibleTo(request.currentUser!.id)),
  );
}
