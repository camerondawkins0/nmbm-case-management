import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { referralCreateSchema, referralOutcomeSchema } from "@nmbm/shared";
import { authorize } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import { assertCanSee } from "../participants/service.js";
import * as service from "./service.js";

export default async function referralRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  fastify.post(
    "/api/referrals",
    { preHandler: authorize("referrals.write") },
    async (request, reply) => {
      const input = referralCreateSchema.parse(request.body);
      const caller = await resolveScope(db, request.currentUser!.id);
      await assertCanSee(db, caller, input.participantId);
      const referral = await service.createReferral(db, input, request.currentUser!.id);
      reply.code(201);
      return referral;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/referrals/:id/outcome",
    { preHandler: authorize("referrals.write") },
    async (request) => {
      const input = referralOutcomeSchema.parse(request.body);
      return service.recordOutcome(db, request.params.id, input, request.currentUser!.id);
    },
  );
}
