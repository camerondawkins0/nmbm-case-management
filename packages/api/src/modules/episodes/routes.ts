import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { episodeCreateSchema, episodeCloseSchema } from "@nmbm/shared";
import { authorize, getPermissions } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import { assertCanSee, assertCanWrite } from "../participants/service.js";
import * as service from "./service.js";
import * as repository from "./repository.js";
import { forbidden, notFound } from "../../plugins/errors.js";

export default async function episodeRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  async function assertEpisodeWritable(userId: string, episodeId: string) {
    const episode = await repository.findById(db, episodeId);
    if (!episode) throw notFound("Episode not found");
    await assertCanWrite(db, await resolveScope(db, userId), episode.participantId);
    return episode;
  }

  fastify.post(
    "/api/episodes",
    { preHandler: authorize("episodes.write") },
    async (request, reply) => {
      const input = episodeCreateSchema.parse(request.body);
      const caller = await resolveScope(db, request.currentUser!.id);
      // Readmission is the write that's made on a closed record, so it's
      // checked against sight of the record (intake's read.closed, the
      // former worker's window), not the caseload.
      await assertCanSee(db, caller, input.participantId);
      if (input.incomingReferralId) {
        const held = await getPermissions(db, request.currentUser!.id);
        if (!held.has("incoming_referrals.manage")) throw forbidden("You can't work the referrals queue");
      }
      const episode = await service.openEpisode(db, input, request.currentUser!.id);
      reply.code(201);
      return episode;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/episodes/:id/close",
    { preHandler: authorize("episodes.write") },
    async (request) => {
      const input = episodeCloseSchema.parse(request.body);
      await assertEpisodeWritable(request.currentUser!.id, request.params.id);
      return service.closeEpisode(db, request.params.id, input, request.currentUser!.id);
    },
  );

  // M6: recording the Molina warning letter is what unblocks a
  // no-contact disenrollment for those participants.
  fastify.post<{ Params: { id: string } }>(
    "/api/episodes/:id/disenrollment-letter",
    { preHandler: authorize("episodes.write") },
    async (request) => {
      await assertEpisodeWritable(request.currentUser!.id, request.params.id);
      return service.recordDisenrollmentLetter(db, request.params.id, request.currentUser!.id);
    },
  );
}
