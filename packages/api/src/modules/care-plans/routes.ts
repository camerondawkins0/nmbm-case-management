import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { z } from "zod";
import { carePlanCreateSchema, carePlanReviewSchema } from "@nmbm/shared";
import { authorize } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import { assertCanSee } from "../participants/service.js";
import * as service from "./service.js";
import * as repository from "./repository.js";
import { notFound } from "../../plugins/errors.js";

const goalsSchema = z.object({ goals: z.string().min(1) });

export default async function carePlanRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  async function assertPlanVisible(userId: string, planId: string) {
    const plan = await repository.findById(db, planId);
    if (!plan) throw notFound("Care plan not found");
    const caller = await resolveScope(db, userId);
    await assertCanSee(db, caller, plan.participantId);
  }

  fastify.post(
    "/api/care-plans",
    { preHandler: authorize("care_plans.write") },
    async (request, reply) => {
      const input = carePlanCreateSchema.parse(request.body);
      const caller = await resolveScope(db, request.currentUser!.id);
      await assertCanSee(db, caller, input.participantId);
      const plan = await service.createCarePlan(db, input);
      reply.code(201);
      return plan;
    },
  );

  fastify.patch<{ Params: { id: string } }>(
    "/api/care-plans/:id",
    { preHandler: authorize("care_plans.write") },
    async (request) => {
      const { goals } = goalsSchema.parse(request.body);
      await assertPlanVisible(request.currentUser!.id, request.params.id);
      return service.updateGoals(db, request.params.id, goals);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/care-plans/:id/submit",
    { preHandler: authorize("care_plans.write") },
    async (request) => {
      await assertPlanVisible(request.currentUser!.id, request.params.id);
      return service.submitForReview(db, request.params.id);
    },
  );

  // U6: approval is the Clinical Director's, and it is a different
  // permission from writing the plan on purpose — a CHW holding
  // care_plans.write must not be able to sign off their own work.
  fastify.get(
    "/api/care-plans/awaiting-review",
    { preHandler: authorize("care_plans.approve") },
    async () => service.listAwaitingReview(db),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/care-plans/:id/approve",
    { preHandler: authorize("care_plans.approve") },
    async (request) => service.approve(db, request.params.id, request.currentUser!.id),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/care-plans/:id/return",
    { preHandler: authorize("care_plans.approve") },
    async (request) => {
      const input = carePlanReviewSchema.parse(request.body);
      return service.returnForRevision(db, request.params.id, input);
    },
  );
}
