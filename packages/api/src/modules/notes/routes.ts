import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { noteCreateSchema } from "@nmbm/shared";
import { authorize } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import { assertCanSee } from "../participants/service.js";
import * as service from "./service.js";

export default async function noteRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  fastify.post(
    "/api/notes",
    { preHandler: authorize("notes.write") },
    async (request, reply) => {
      const input = noteCreateSchema.parse(request.body);
      const caller = await resolveScope(db, request.currentUser!.id);
      // notes.write says you may write notes; it doesn't say whose.
      await assertCanSee(db, caller, input.participantId);
      const result = await service.recordNote(db, input, request.currentUser!.id);
      reply.code(201);
      return result;
    },
  );
}
