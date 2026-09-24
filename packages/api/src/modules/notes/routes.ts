import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { z } from "zod";
import { noteCreateSchema } from "@nmbm/shared";
import { authorize, getPermissions } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import { assertCanSee } from "../participants/service.js";
import * as service from "./service.js";
import * as review from "./review.js";

const reviewNoteSchema = z.object({ reviewNote: z.string().min(1).optional() });
const bodySchema = z.object({ body: z.string().min(1) });

export default async function noteRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  fastify.post(
    "/api/notes",
    { preHandler: authorize("notes.write") },
    async (request, reply) => {
      const input = noteCreateSchema.parse(request.body);
      const userId = request.currentUser!.id;
      const caller = await resolveScope(db, userId);
      // notes.write says you may write notes; it doesn't say whose.
      await assertCanSee(db, caller, input.participantId);
      const permissions = await getPermissions(db, userId);
      const result = await service.recordNote(
        db,
        input,
        userId,
        permissions.has("notes.approve"),
      );
      reply.code(201);
      return result;
    },
  );

  // The author's own bounced work. No extra permission: writing notes
  // is what earns you the right to see the ones sent back to you.
  fastify.get(
    "/api/notes/returned",
    { preHandler: authorize("notes.write") },
    async (request) => review.listReturnedToAuthor(db, request.currentUser!.id),
  );

  fastify.patch<{ Params: { id: string } }>(
    "/api/notes/:id",
    { preHandler: authorize("notes.write") },
    async (request) => {
      const { body } = bodySchema.parse(request.body);
      return review.reviseAndResubmit(db, request.params.id, request.currentUser!.id, body);
    },
  );

  fastify.get(
    "/api/notes/awaiting-review",
    { preHandler: authorize("notes.approve") },
    async () => review.listAwaitingReview(db),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/notes/:id/approve",
    { preHandler: authorize("notes.approve") },
    async (request) => review.approve(db, request.params.id, request.currentUser!.id),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/notes/:id/return",
    { preHandler: authorize("notes.approve") },
    async (request) => {
      const input = reviewNoteSchema.parse(request.body);
      return review.returnForRevision(
        db,
        request.params.id,
        request.currentUser!.id,
        input.reviewNote,
      );
    },
  );
}
