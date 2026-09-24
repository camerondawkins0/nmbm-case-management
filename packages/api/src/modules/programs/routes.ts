import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import {
  programCreateSchema,
  cohortCreateSchema,
  sessionCreateSchema,
  cohortEnrollSchema,
  cohortWithdrawSchema,
  attendanceMarkSchema,
} from "@nmbm/shared";
import { authorize, authorizeAny, CAN_READ_PARTICIPANTS } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import { assertCanSee } from "../participants/service.js";
import * as service from "./service.js";

export default async function programRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  // Reading the programme list needs no more than being able to read
  // participants — a facilitator has to find their class before they
  // can mark it.
  fastify.get(
    "/api/programs",
    { preHandler: authorizeAny(CAN_READ_PARTICIPANTS) },
    async () => service.listPrograms(db),
  );

  fastify.post(
    "/api/programs",
    { preHandler: authorize("programs.manage") },
    async (request, reply) => {
      const input = programCreateSchema.parse(request.body);
      const program = await service.createProgram(db, input, request.currentUser!.id);
      reply.code(201);
      return program;
    },
  );

  fastify.post(
    "/api/cohorts",
    { preHandler: authorize("programs.manage") },
    async (request, reply) => {
      const input = cohortCreateSchema.parse(request.body);
      const cohort = await service.createCohort(db, input, request.currentUser!.id);
      reply.code(201);
      return cohort;
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/cohorts/:id",
    { preHandler: authorizeAny(CAN_READ_PARTICIPANTS) },
    async (request) => service.getCohort(db, request.params.id),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/cohorts/:id/sessions",
    { preHandler: authorize("programs.manage") },
    async (request, reply) => {
      const input = sessionCreateSchema.parse(request.body);
      const session = await service.addSession(db, request.params.id, input, request.currentUser!.id);
      reply.code(201);
      return session;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/cohorts/:id/enrollments",
    { preHandler: authorize("programs.manage") },
    async (request, reply) => {
      const { participantId } = cohortEnrollSchema.parse(request.body);
      const caller = await resolveScope(db, request.currentUser!.id);
      await assertCanSee(db, caller, participantId);
      const enrollment = await service.enroll(db, request.params.id, participantId, request.currentUser!.id);
      reply.code(201);
      return enrollment;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/enrollments/:id/withdraw",
    { preHandler: authorize("programs.manage") },
    async (request) => {
      const { reason } = cohortWithdrawSchema.parse(request.body);
      return service.withdraw(db, request.params.id, reason, request.currentUser!.id);
    },
  );

  // M14: the whole roster in one request, because that's how a class is
  // actually marked.
  fastify.post<{ Params: { id: string } }>(
    "/api/sessions/:id/attendance",
    { preHandler: authorize("attendance.record") },
    async (request) => {
      const input = attendanceMarkSchema.parse(request.body);
      return service.markAttendance(db, request.params.id, input, request.currentUser!.id);
    },
  );

  // Proof of participation. Readable by anyone who can see the
  // participant — the person producing it for a probation officer is
  // usually the case manager, not a programme administrator.
  fastify.get<{ Params: { id: string } }>(
    "/api/enrollments/:id/participation",
    { preHandler: authorizeAny(CAN_READ_PARTICIPANTS) },
    async (request) => {
      const record = await service.participationRecord(db, request.params.id);
      const caller = await resolveScope(db, request.currentUser!.id);
      await assertCanSee(db, caller, record.enrollment.participantId);
      return record;
    },
  );
}
