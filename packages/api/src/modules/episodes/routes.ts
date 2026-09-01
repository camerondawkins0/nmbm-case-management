import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { episodeCreateSchema } from "@nmbm/shared";
import { authorize } from "../../plugins/authorize.js";
import * as service from "./service.js";

export default async function episodeRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  fastify.post(
    "/api/episodes",
    { preHandler: authorize("episodes.write") },
    async (request, reply) => {
      const input = episodeCreateSchema.parse(request.body);
      const episode = await service.openEpisode(db, input);
      reply.code(201);
      return episode;
    },
  );
}
