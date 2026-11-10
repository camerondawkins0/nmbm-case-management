import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import {
  programCreateSchema,
  cohortCreateSchema,
  sessionCreateSchema,
  cohortEnrollSchema,
  cohortWithdrawSchema,
  cohortStatusSchema,
  programUpdateSchema,
  cohortUpdateSchema,
  attendanceMarkSchema,
} from "@nmbm/shared";
import { authorize, authorizeAny, CAN_READ_PARTICIPANTS, getPermissions } from "../../plugins/authorize.js";
import { resolveScope, visibleParticipantIds } from "../../lib/caseload.js";
import { assertCanSee, assertCanWrite } from "../participants/service.js";
import * as service from "./service.js";

export default async function programRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  // Reading the program list needs no more than being able to read
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

  // What completing it takes, its name, whether it's still offered.
  fastify.patch<{ Params: { id: string } }>(
    "/api/programs/:id",
    { preHandler: authorize("programs.manage") },
    async (request) => {
      const input = programUpdateSchema.parse(request.body);
      return service.updateProgram(db, request.params.id, input, request.currentUser!.id);
    },
  );

  fastify.patch<{ Params: { id: string } }>(
    "/api/cohorts/:id",
    { preHandler: authorize("programs.manage") },
    async (request) => {
      const input = cohortUpdateSchema.parse(request.body);
      return service.updateCohort(db, request.params.id, input, request.currentUser!.id);
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
    async (request) => {
      // The whole roster is for the people who run classes: setting them
      // up, or taking attendance, which needs every name in the room.
      // Anyone else sees only their own clients in it.
      const userId = request.currentUser!.id;
      const held = await getPermissions(db, userId);
      const runsClasses = held.has("programs.manage") || held.has("attendance.record");
      const visible = runsClasses ? "all" : await visibleParticipantIds(db, await resolveScope(db, userId));
      return service.getCohort(db, request.params.id, visible);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/cohorts/:id/status",
    { preHandler: authorize("programs.manage") },
    async (request) => {
      const { status } = cohortStatusSchema.parse(request.body);
      return service.setCohortStatus(db, request.params.id, status, request.currentUser!.id);
    },
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
      await assertCanWrite(db, caller, participantId);
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
      // The same rule as enrolling them.
      const enrollment = await service.findEnrollment(db, request.params.id);
      await assertCanWrite(db, await resolveScope(db, request.currentUser!.id), enrollment.participantId);
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
  // usually the case manager, not a program administrator.
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
