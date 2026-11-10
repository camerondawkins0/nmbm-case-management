import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { z } from "zod";
import { noteCreateSchema, noteReviseSchema } from "@nmbm/shared";
import { authorize, authorizeAny, getPermissions } from "../../plugins/authorize.js";
import { resolveScope } from "../../lib/caseload.js";
import { assertCanSee } from "../participants/service.js";
import * as service from "./service.js";
import * as review from "./review.js";

const reviewNoteSchema = z.object({ reviewNote: z.string().min(1).optional() });

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
      const result = await service.recordNote(db, input, userId, await getPermissions(db, userId));
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
      const input = noteReviseSchema.parse(request.body);
      return review.reviseAndResubmit(db, request.params.id, request.currentUser!.id, input);
    },
  );

  // Either chain's reviewer gets in; which notes they may sign is
  // checked per note (review.ts).
  const REVIEWS_NOTES = ["notes.approve", "notes.approve.clinical"] as const;

  fastify.get(
    "/api/notes/awaiting-review",
    { preHandler: authorizeAny([...REVIEWS_NOTES]) },
    async (request) => review.listAwaitingReview(db, await getPermissions(db, request.currentUser!.id)),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/notes/:id/approve",
    { preHandler: authorizeAny([...REVIEWS_NOTES]) },
    async (request) => {
      const userId = request.currentUser!.id;
      return review.approve(db, request.params.id, userId, await getPermissions(db, userId));
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/notes/:id/return",
    { preHandler: authorizeAny([...REVIEWS_NOTES]) },
    async (request) => {
      const input = reviewNoteSchema.parse(request.body);
      const userId = request.currentUser!.id;
      return review.returnForRevision(db, request.params.id, userId, input.reviewNote, await getPermissions(db, userId));
    },
  );
}
