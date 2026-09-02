import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { feedbackCreateSchema, feedbackStatusUpdateSchema } from "@nmbm/shared";
import { authorize } from "../../plugins/authorize.js";
import * as service from "./service.js";

export default async function feedbackRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  // Any logged-in user can submit — NMBM has no dedicated IT/dev staff,
  // see docs/SUPPORT.md.
  fastify.post(
    "/api/feedback",
    { preHandler: authorize("feedback.submit") },
    async (request, reply) => {
      const input = feedbackCreateSchema.parse(request.body);
      const item = await service.submitFeedback(db, input, request.currentUser!.id);
      reply.code(201);
      return item;
    },
  );

  // A submitter can see the status of their own tickets without the
  // broader feedback.manage permission.
  fastify.get(
    "/api/feedback/mine",
    { preHandler: authorize("feedback.submit") },
    async (request) => service.listMyFeedback(db, request.currentUser!.id),
  );

  fastify.get(
    "/api/feedback",
    { preHandler: authorize("feedback.manage") },
    async () => service.listAllFeedback(db),
  );

  fastify.patch<{ Params: { id: string } }>(
    "/api/feedback/:id/status",
    { preHandler: authorize("feedback.manage") },
    async (request) => {
      const input = feedbackStatusUpdateSchema.parse(request.body);
      return service.updateFeedbackStatus(db, request.params.id, input, request.currentUser!.id);
    },
  );
}
