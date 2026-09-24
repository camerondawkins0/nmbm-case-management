import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { episodeCreateSchema, episodeCloseSchema } from "@nmbm/shared";
import { authorize } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import { assertCanSee } from "../participants/service.js";
import * as service from "./service.js";
import * as repository from "./repository.js";
import { notFound } from "../../plugins/errors.js";

export default async function episodeRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  async function assertEpisodeVisible(userId: string, episodeId: string) {
    const episode = await repository.findById(db, episodeId);
    if (!episode) throw notFound("Episode not found");
    const caller = await resolveScope(db, userId);
    await assertCanSee(db, caller, episode.participantId);
    return episode;
  }

  fastify.post(
    "/api/episodes",
    { preHandler: authorize("episodes.write") },
    async (request, reply) => {
      const input = episodeCreateSchema.parse(request.body);
      const caller = await resolveScope(db, request.currentUser!.id);
      await assertCanSee(db, caller, input.participantId);
      const episode = await service.openEpisode(db, input);
      reply.code(201);
      return episode;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/episodes/:id/close",
    { preHandler: authorize("episodes.write") },
    async (request) => {
      const input = episodeCloseSchema.parse(request.body);
      await assertEpisodeVisible(request.currentUser!.id, request.params.id);
      return service.closeEpisode(db, request.params.id, input, request.currentUser!.id);
    },
  );

  // M6: recording the Molina warning letter is what unblocks a
  // no-contact disenrolment for those participants.
  fastify.post<{ Params: { id: string } }>(
    "/api/episodes/:id/disenrollment-letter",
    { preHandler: authorize("episodes.write") },
    async (request) => {
      await assertEpisodeVisible(request.currentUser!.id, request.params.id);
      return service.recordDisenrollmentLetter(db, request.params.id, request.currentUser!.id);
    },
  );
}
