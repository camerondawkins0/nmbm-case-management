import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { authorizeAny, getPermissions, CAN_READ_PARTICIPANTS } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import * as participantService from "../participants/service.js";
import * as carePlanRepository from "../care-plans/repository.js";
import * as referralService from "../referrals/service.js";
import { caseloadParticipantIds } from "../../lib/caseload.js";

// The discovery doc's own framing of care plans (M9): an overdue plan
// should "turn up on the worker's home screen instead of a report
// nobody opens". This is that screen's data — the same derived flags
// the caseload list uses, filtered to the things that want doing.
export default async function dashboardRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  fastify.get(
    "/api/dashboard",
    { preHandler: authorizeAny(CAN_READ_PARTICIPANTS) },
    async (request) => {
      const userId = request.currentUser!.id;
      const caller = await resolveScope(db, userId);
      const participants = await participantService.listVisibleParticipants(db, caller);

      const noContactWarnings = participants.filter((p) => p.flags.noContact.warning);
      const carePlansMissing = participants.filter((p) => p.flags.carePlan.missing);
      const carePlanReviewsDue = participants.filter((p) => p.flags.carePlan.reviewOverdue);
      const carePlansReturned = participants.filter((p) => p.flags.carePlan.needsRevision);

      // The approval queue is only meaningful to whoever can act on it.
      const permissions = await getPermissions(db, userId);
      const awaitingReview = permissions.has("care_plans.approve")
        ? await carePlanRepository.listAwaitingReview(db)
        : [];

      // M17: scoped the same way the caseload is — a CHW chases their
      // own referrals, a supervisor sees all of them.
      const referralsAwaitingOutcome = await referralService.listAwaitingOutcome(
        db,
        caller.canReadAll ? null : await caseloadParticipantIds(db, userId),
      );

      return {
        caseloadSize: participants.length,
        referralsAwaitingOutcome,
        needsAttention: participants.filter((p) => p.needsAttention).length,
        noContactWarnings,
        carePlansMissing,
        carePlanReviewsDue,
        carePlansReturned,
        awaitingReview,
      };
    },
  );
}
