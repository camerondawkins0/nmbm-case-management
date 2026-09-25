import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import {
  participantCreateSchema,
  intakeSchema,
  assignmentSchema,
  participantListQuerySchema,
} from "@nmbm/shared";
import { authorize, authorizeAny, CAN_READ_PARTICIPANTS } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import * as service from "./service.js";
import * as intake from "./intake.js";

// routes.ts: parse with Zod, authorize(), delegate. Never touches
// Drizzle directly — see docs/agent/map.md.
export default async function participantRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  fastify.get(
    "/api/participants",
    { preHandler: authorizeAny(CAN_READ_PARTICIPANTS) },
    async (request) => {
      const query = participantListQuerySchema.parse(request.query);
      const caller = await resolveScope(db, request.currentUser!.id);
      return service.listParticipants(db, caller, query);
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

  // Who a case can be handed to. Needed by the intake form before any
  // participant exists, so it hangs off the assign permission rather
  // than a participant id.
  fastify.get(
    "/api/participants/assignable-workers",
    { preHandler: authorize("participants.assign") },
    async () => intake.listAssignableWorkers(db),
  );

  fastify.post(
    "/api/participants/intake",
    { preHandler: authorize("participants.write") },
    async (request, reply) => {
      const input = intakeSchema.parse(request.body);
      const result = await intake.admitParticipant(db, input, request.currentUser!.id);
      reply.code(201);
      return result;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/participants/:id/assignment",
    { preHandler: authorize("participants.assign") },
    async (request) => {
      const { workerId } = assignmentSchema.parse(request.body);
      return intake.reassign(db, request.params.id, workerId, request.currentUser!.id);
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
