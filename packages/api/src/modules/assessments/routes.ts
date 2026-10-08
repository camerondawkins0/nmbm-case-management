import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import {
  createFormSchema,
  saveAnswersSchema,
  saveQuestionsSchema,
  sendToParticipantSchema,
  startAssessmentSchema,
  voidAssessmentSchema,
} from "@nmbm/shared";
import { z } from "zod";
import { authorize, authorizeAny, CAN_READ_PARTICIPANTS } from "../../plugins/authorize.js";
import { resolveScope, canSeeParticipant } from "../../lib/caseload.js";
import { notFound } from "../../plugins/errors.js";
import * as service from "./service.js";
import * as links from "./links.js";

// Reading a form's questions is needed to fill one in as much as to
// build one.
const FORM_READERS = ["assessments.manage", "assessments.write"] as const;
const RECORD_READERS = [...CAN_READ_PARTICIPANTS, "participants.read.closed"] as const;

export default async function assessmentRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  // An assessment is part of the participant's record and is scoped
  // exactly as the record is; out of scope answers as not found.
  async function assertVisible(userId: string, participantId: string) {
    const caller = await resolveScope(db, userId);
    if (!(await canSeeParticipant(db, caller, participantId))) throw notFound("Not found");
  }

  fastify.get(
    "/api/assessment-forms",
    { preHandler: authorizeAny([...FORM_READERS]) },
    async () => service.listForms(db),
  );

  fastify.post(
    "/api/assessment-forms",
    { preHandler: authorize("assessments.manage") },
    async (request, reply) => {
      const input = createFormSchema.parse(request.body);
      reply.code(201);
      return service.createForm(db, input, request.currentUser!.id);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/assessment-forms/:id",
    { preHandler: authorizeAny([...FORM_READERS]) },
    async (request) => service.getForm(db, request.params.id),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/assessment-forms/:id/drafts",
    { preHandler: authorize("assessments.manage") },
    async (request, reply) => {
      reply.code(201);
      return service.newDraft(db, request.params.id, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/assessment-forms/:id/active",
    { preHandler: authorize("assessments.manage") },
    async (request) => {
      const { active } = z.object({ active: z.boolean() }).parse(request.body);
      return service.setFormActive(db, request.params.id, active, request.currentUser!.id);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/assessment-versions/:id",
    { preHandler: authorizeAny([...FORM_READERS]) },
    async (request) => service.getVersion(db, request.params.id),
  );

  fastify.put<{ Params: { id: string } }>(
    "/api/assessment-versions/:id/questions",
    { preHandler: authorize("assessments.manage") },
    async (request) => {
      const { questions } = saveQuestionsSchema.parse(request.body);
      return service.saveDraftQuestions(db, request.params.id, questions);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/assessment-versions/:id/publish",
    { preHandler: authorize("assessments.manage") },
    async (request) => service.publish(db, request.params.id, request.currentUser!.id),
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/participants/:id/assessments",
    { preHandler: authorizeAny([...RECORD_READERS]) },
    async (request) => {
      await assertVisible(request.currentUser!.id, request.params.id);
      const rows = await service.listForParticipant(db, request.params.id);
      const states = await links.linkStates(db, rows.filter((r) => r.mode === "self").map((r) => r.id));
      return rows.map((r) => ({ ...r, link: states.get(r.id) ?? null }));
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/participants/:id/assessments",
    { preHandler: authorize("assessments.write") },
    async (request, reply) => {
      const input = startAssessmentSchema.parse(request.body);
      await assertVisible(request.currentUser!.id, request.params.id);
      reply.code(201);
      return service.start(db, request.params.id, input, request.currentUser!.id);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/assessments/:id",
    { preHandler: authorizeAny([...RECORD_READERS]) },
    async (request) => {
      const row = await service.find(db, request.params.id);
      await assertVisible(request.currentUser!.id, row.participantId);
      const detail = await service.get(db, request.params.id);
      const states = await links.linkStates(db, row.mode === "self" ? [row.id] : []);
      return { ...detail, link: states.get(row.id) ?? null };
    },
  );

  fastify.patch<{ Params: { id: string } }>(
    "/api/assessments/:id/answers",
    { preHandler: authorize("assessments.write") },
    async (request) => {
      const { answers } = saveAnswersSchema.parse(request.body);
      const row = await service.find(db, request.params.id);
      await assertVisible(request.currentUser!.id, row.participantId);
      return service.saveAnswers(db, request.params.id, answers, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/assessments/:id/complete",
    { preHandler: authorize("assessments.write") },
    async (request) => {
      const row = await service.find(db, request.params.id);
      await assertVisible(request.currentUser!.id, row.participantId);
      return service.complete(db, request.params.id, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/assessments/:id/void",
    { preHandler: authorize("assessments.write") },
    async (request) => {
      const { reason } = voidAssessmentSchema.parse(request.body);
      const row = await service.find(db, request.params.id);
      await assertVisible(request.currentUser!.id, row.participantId);
      return service.voidAssessment(db, request.params.id, reason, request.currentUser!.id);
    },
  );

  // M13: the participant fills the form in themselves. What comes back
  // — the link's secret and the passcode — is shown to the case manager
  // once and can't be fetched again.
  fastify.post<{ Params: { id: string } }>(
    "/api/participants/:id/assessment-links",
    { preHandler: authorize("assessments.write") },
    async (request, reply) => {
      const { formId } = sendToParticipantSchema.parse(request.body);
      await assertVisible(request.currentUser!.id, request.params.id);
      reply.code(201);
      return links.sendToParticipant(db, request.params.id, formId, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/assessments/:id/link",
    { preHandler: authorize("assessments.write") },
    async (request, reply) => {
      const row = await service.find(db, request.params.id);
      await assertVisible(request.currentUser!.id, row.participantId);
      reply.code(201);
      return links.reissue(db, request.params.id, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/assessments/:id/link/revoke",
    { preHandler: authorize("assessments.write") },
    async (request) => {
      const row = await service.find(db, request.params.id);
      await assertVisible(request.currentUser!.id, row.participantId);
      return links.revoke(db, request.params.id, request.currentUser!.id);
    },
  );
}
