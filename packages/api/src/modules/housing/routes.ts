import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import {
  csAuthorizationCreateSchema,
  csAuthorizationDecisionSchema,
  csAuthorizationEndSchema,
  depositCreateSchema,
  depositDecisionSchema,
  depositPaidSchema,
  housingExportQuerySchema,
  housingServiceCreateSchema,
  housingStatusCreateSchema,
  tenancyCreateSchema,
  tenancyMoveOutSchema,
  voidSchema,
} from "@nmbm/shared";
import { authorize, authorizeAny, CAN_READ_PARTICIPANTS, getPermissions } from "../../plugins/authorize.js";
import { resolveScope, visibleParticipantIds } from "../../lib/caseload.js";
import { assertCanSee, assertCanWrite } from "../participants/service.js";
import * as service from "./service.js";

// Housing Community Supports (M24). Every route checks the permission,
// then whose record the id belongs to — out of reach answers exactly as
// missing — then the rule. Writes need the record on the caller's
// caseload now (canWriteParticipant).
export default async function housingRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const writable = async (userId: string, participantId: string, what = "Participant") =>
    assertCanWrite(db, await resolveScope(db, userId), participantId, what);
  const visibleTo = async (userId: string) => visibleParticipantIds(db, await resolveScope(db, userId));

  fastify.get<{ Params: { id: string } }>(
    "/api/participants/:id/housing",
    { preHandler: authorizeAny([...CAN_READ_PARTICIPANTS, "participants.read.closed"]) },
    async (request) => {
      await assertCanSee(db, await resolveScope(db, request.currentUser!.id), request.params.id);
      return service.housingFor(db, request.params.id);
    },
  );

  // Housing situation.
  fastify.post<{ Params: { id: string } }>(
    "/api/participants/:id/housing-statuses",
    { preHandler: authorize("housing.write") },
    async (request, reply) => {
      const input = housingStatusCreateSchema.parse(request.body);
      await writable(request.currentUser!.id, request.params.id);
      reply.code(201);
      return service.recordStatus(db, request.params.id, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/housing-statuses/:id/void",
    { preHandler: authorize("housing.write") },
    async (request) => {
      const { reason } = voidSchema.parse(request.body);
      const row = await service.findStatus(db, request.params.id);
      await writable(request.currentUser!.id, row.participantId, "Housing status");
      return service.voidStatus(db, row.id, reason, request.currentUser!.id);
    },
  );

  // Authorizations.
  fastify.post<{ Params: { id: string } }>(
    "/api/participants/:id/cs-authorizations",
    { preHandler: authorize("housing.authorizations") },
    async (request, reply) => {
      const input = csAuthorizationCreateSchema.parse(request.body);
      await writable(request.currentUser!.id, request.params.id);
      reply.code(201);
      return service.requestAuthorization(db, request.params.id, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/cs-authorizations/:id/decision",
    { preHandler: authorize("housing.authorizations") },
    async (request) => {
      const input = csAuthorizationDecisionSchema.parse(request.body);
      const row = await service.findAuthorization(db, request.params.id);
      await writable(request.currentUser!.id, row.participantId, "Authorization");
      return service.decideAuthorization(db, row.id, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/cs-authorizations/:id/end",
    { preHandler: authorize("housing.authorizations") },
    async (request) => {
      const input = csAuthorizationEndSchema.parse(request.body);
      const row = await service.findAuthorization(db, request.params.id);
      await writable(request.currentUser!.id, row.participantId, "Authorization");
      return service.endAuthorization(db, row.id, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/cs-authorizations/:id/void",
    { preHandler: authorize("housing.authorizations") },
    async (request) => {
      const { reason } = voidSchema.parse(request.body);
      const row = await service.findAuthorization(db, request.params.id);
      await writable(request.currentUser!.id, row.participantId, "Authorization");
      return service.voidAuthorization(db, row.id, reason, request.currentUser!.id);
    },
  );

  // The work.
  fastify.post<{ Params: { id: string } }>(
    "/api/participants/:id/housing-services",
    { preHandler: authorize("housing.write") },
    async (request, reply) => {
      const input = housingServiceCreateSchema.parse(request.body);
      await writable(request.currentUser!.id, request.params.id);
      reply.code(201);
      return service.logService(db, request.params.id, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/housing-services/:id/void",
    { preHandler: authorize("housing.write") },
    async (request) => {
      const { reason } = voidSchema.parse(request.body);
      const row = await service.findService(db, request.params.id);
      await writable(request.currentUser!.id, row.participantId, "Housing service");
      return service.voidService(db, row.id, reason, request.currentUser!.id);
    },
  );

  // Where they live.
  fastify.post<{ Params: { id: string } }>(
    "/api/participants/:id/tenancies",
    { preHandler: authorize("housing.write") },
    async (request, reply) => {
      const input = tenancyCreateSchema.parse(request.body);
      await writable(request.currentUser!.id, request.params.id);
      reply.code(201);
      return service.recordTenancy(db, request.params.id, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/tenancies/:id/move-out",
    { preHandler: authorize("housing.write") },
    async (request) => {
      const input = tenancyMoveOutSchema.parse(request.body);
      const row = await service.findTenancy(db, request.params.id);
      await writable(request.currentUser!.id, row.participantId, "Tenancy");
      return service.moveOut(db, row.id, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/tenancies/:id/void",
    { preHandler: authorize("housing.write") },
    async (request) => {
      const { reason } = voidSchema.parse(request.body);
      const row = await service.findTenancy(db, request.params.id);
      await writable(request.currentUser!.id, row.participantId, "Tenancy");
      return service.voidTenancy(db, row.id, reason, request.currentUser!.id);
    },
  );

  // Deposits.
  fastify.post<{ Params: { id: string } }>(
    "/api/participants/:id/housing-deposits",
    { preHandler: authorize("housing.write") },
    async (request, reply) => {
      const input = depositCreateSchema.parse(request.body);
      await writable(request.currentUser!.id, request.params.id);
      reply.code(201);
      return service.requestDeposit(db, request.params.id, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/housing-deposits/:id/decision",
    { preHandler: authorize("housing.deposits.approve") },
    async (request) => {
      const input = depositDecisionSchema.parse(request.body);
      const row = await service.findDeposit(db, request.params.id);
      await writable(request.currentUser!.id, row.participantId, "Deposit");
      return service.decideDeposit(db, row.id, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/housing-deposits/:id/paid",
    { preHandler: authorize("housing.deposits.approve") },
    async (request) => {
      const input = depositPaidSchema.parse(request.body);
      const row = await service.findDeposit(db, request.params.id);
      await writable(request.currentUser!.id, row.participantId, "Deposit");
      return service.markPaid(db, row.id, input, request.currentUser!.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/housing-deposits/:id/void",
    { preHandler: authorizeAny(["housing.write", "housing.deposits.approve"]) },
    async (request) => {
      const { reason } = voidSchema.parse(request.body);
      const userId = request.currentUser!.id;
      const row = await service.findDeposit(db, request.params.id);
      await writable(userId, row.participantId, "Deposit");
      const held = await getPermissions(db, userId);
      return service.voidDeposit(db, row.id, reason, userId, held.has("housing.deposits.approve"));
    },
  );

  // Across the caseload: what needs doing, for the records the caller can see.
  fastify.get(
    "/api/housing/overview",
    { preHandler: authorizeAny(CAN_READ_PARTICIPANTS) },
    async (request) => service.overview(db, await visibleTo(request.currentUser!.id)),
  );

  // A POST, not a GET, like the record export: it writes an audit line,
  // and a browser should never fetch it ahead of time.
  fastify.post(
    "/api/housing/service-export",
    { preHandler: authorize("housing.export") },
    async (request, reply) => {
      const range = housingExportQuerySchema.parse(request.body);
      const userId = request.currentUser!.id;
      const { csv } = await service.exportServices(db, range, await visibleTo(userId), userId);
      reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="housing-services-${range.from}-to-${range.to}.csv"`);
      return csv;
    },
  );
}
