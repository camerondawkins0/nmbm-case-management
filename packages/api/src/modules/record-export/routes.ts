import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { recordExportSchema } from "@nmbm/shared";
import { authorize } from "../../plugins/authorize.js";
import { resolveScope, canSeeParticipant } from "../../lib/caseload.js";
import { notFound } from "../../plugins/errors.js";
import * as service from "./service.js";

export default async function recordExportRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  // A POST, not a GET: it writes the audit line, and a browser should
  // never fetch it ahead of time or replay it from history.
  fastify.post<{ Params: { id: string } }>(
    "/api/participants/:id/record-export",
    { preHandler: authorize("records.export") },
    async (request) => {
      const input = recordExportSchema.parse(request.body);
      const caller = await resolveScope(db, request.currentUser!.id);
      if (!(await canSeeParticipant(db, caller, request.params.id))) throw notFound("Participant not found");
      return service.buildExport(db, request.params.id, input, request.currentUser!.id);
    },
  );
}
