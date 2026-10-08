import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { documentUploadSchema, documentVoidSchema } from "@nmbm/shared";
import { authorize, authorizeAny, CAN_READ_PARTICIPANTS } from "../../plugins/authorize.js";
import { resolveScope, canSeeParticipant } from "../../lib/caseload.js";
import { notFound } from "../../plugins/errors.js";
import type { StorageProvider } from "../../lib/storage.js";
import * as service from "./service.js";

export default async function documentRoutes(fastify: FastifyInstance, opts: { db: Db; storage: StorageProvider }) {
  const { db, storage } = opts;

  // Every document route is scoped to the participant it belongs to, by
  // the same rules as the record itself. Out of scope answers as not
  // found, so a guessed id doesn't confirm a document exists.
  async function assertVisible(userId: string, participantId: string) {
    const caller = await resolveScope(db, userId);
    if (!(await canSeeParticipant(db, caller, participantId))) throw notFound("Not found");
  }

  fastify.get<{ Params: { id: string } }>(
    "/api/participants/:id/documents",
    { preHandler: authorizeAny([...CAN_READ_PARTICIPANTS, "participants.read.closed"]) },
    async (request) => {
      await assertVisible(request.currentUser!.id, request.params.id);
      return service.listForParticipant(db, request.params.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/participants/:id/documents",
    { preHandler: authorize("documents.write") },
    async (request, reply) => {
      const input = documentUploadSchema.parse(request.body);
      await assertVisible(request.currentUser!.id, request.params.id);
      reply.code(201);
      return service.requestUpload(db, storage, request.params.id, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/documents/:id/confirm",
    { preHandler: authorize("documents.write") },
    async (request) => {
      const doc = await service.findDocument(db, request.params.id);
      await assertVisible(request.currentUser!.id, doc.participantId);
      return service.confirmUpload(db, storage, request.params.id, request.currentUser!.id);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/documents/:id/download-url",
    { preHandler: authorizeAny([...CAN_READ_PARTICIPANTS, "participants.read.closed"]) },
    async (request) => {
      const doc = await service.findDocument(db, request.params.id);
      await assertVisible(request.currentUser!.id, doc.participantId);
      return service.downloadUrl(db, storage, request.params.id, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/documents/:id/void",
    { preHandler: authorize("documents.write") },
    async (request) => {
      const { reason } = documentVoidSchema.parse(request.body);
      const doc = await service.findDocument(db, request.params.id);
      await assertVisible(request.currentUser!.id, doc.participantId);
      return service.voidDocument(db, request.params.id, reason, request.currentUser!.id);
    },
  );
}
