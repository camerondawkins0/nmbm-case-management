import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { z } from "zod";
import {
  incomingReferralCloseSchema,
  incomingReferralCreateSchema,
  incomingReferralLinkSchema,
  incomingReferralNoteSchema,
} from "@nmbm/shared";
import { authorize } from "../../plugins/authorize.js";
import { resolveScope, canSeeParticipant } from "../../lib/caseload.js";
import { notFound } from "../../plugins/errors.js";
import * as service from "./service.js";

export default async function incomingReferralRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  fastify.get<{ Querystring: { view?: string } }>("/api/incoming-referrals", { preHandler: authorize("incoming_referrals.manage") }, async (request) => {
    const { view } = z
      .object({ view: z.enum(["open", "outcome_owed", "all"]).default("open") })
      .parse(request.query);
    return service.list(db, view);
  });

  fastify.get("/api/incoming-referrals/counts", { preHandler: authorize("incoming_referrals.manage") }, async () => service.counts(db));

  fastify.post("/api/incoming-referrals", { preHandler: authorize("incoming_referrals.manage") }, async (request, reply) => {
    const input = incomingReferralCreateSchema.parse(request.body);
    reply.code(201);
    return service.create(db, input, request.currentUser!.id);
  });

  fastify.get<{ Params: { id: string } }>("/api/incoming-referrals/:id", { preHandler: authorize("incoming_referrals.manage") }, async (request) =>
    service.get(db, request.params.id),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/incoming-referrals/:id/notes",
    { preHandler: authorize("incoming_referrals.manage") },
    async (request, reply) => {
      const { body } = incomingReferralNoteSchema.parse(request.body);
      reply.code(201);
      return service.addNote(db, request.params.id, body, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/incoming-referrals/:id/close",
    { preHandler: authorize("incoming_referrals.manage") },
    async (request) => {
      const input = incomingReferralCloseSchema.parse(request.body);
      return service.close(db, request.params.id, input, request.currentUser!.id);
    },
  );

  // Attaching a referral to somebody's record says something about that
  // record, so the caller has to be able to open it.
  fastify.post<{ Params: { id: string } }>(
    "/api/incoming-referrals/:id/link",
    { preHandler: authorize("incoming_referrals.manage") },
    async (request) => {
      const { participantId } = incomingReferralLinkSchema.parse(request.body);
      const caller = await resolveScope(db, request.currentUser!.id);
      if (!(await canSeeParticipant(db, caller, participantId))) throw notFound("Participant not found");
      return service.linkToParticipant(db, request.params.id, participantId, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/incoming-referrals/:id/outcome-reported",
    { preHandler: authorize("incoming_referrals.manage") },
    async (request) => service.reportOutcome(db, request.params.id, request.currentUser!.id),
  );
}
