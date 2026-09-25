import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { CONSENT_VALID_DAYS } from "@nmbm/shared";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit, isoDaysAgo } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let chw: Client;
let chwId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const worker = await staff(db, "community_health_worker");
  chwId = worker.id;
  chw = await signIn(app, worker.email);
});
afterAll(async () => app?.close());

const release = (participantId: string, signedDate = isoDaysAgo(1)) =>
  chw.post("/api/consents", {
    participantId,
    type: "release_of_information",
    formName: "Authorisation to release information",
    signedDate,
  });

const refer = (participantId: string) =>
  chw.post("/api/referrals", { participantId, partnerName: "Partner Agency", serviceType: "Housing" });

describe("M16: consent expiry", () => {
  // "A year after the client is enrolled" — not after signing. A form
  // signed eleven months in is good for one more month, not twelve.
  it("counts a year from the enrolment date, not the signature", async () => {
    const start = isoDaysAgo(330);
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId, startDate: start });
    const res = await release(participantId, isoDaysAgo(2));
    expect(res.status).toBe(201);

    const expected = new Date(start);
    expected.setDate(expected.getDate() + CONSENT_VALID_DAYS);
    expect(res.body.expiresDate).toBe(expected.toISOString().slice(0, 10));
    expect(res.body.status).toBe("active");
  });

  it("refuses a form dated in the future", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    expect((await release(participantId, isoDaysAgo(-1))).status).toBe(400);
  });
});

describe("M15/M17: a referral needs a usable release", () => {
  it("refuses when there's no release, and says so", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const res = await refer(participantId);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/no release of information on file/);
  });

  it("refuses when the release has expired, and says so", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId, startDate: isoDaysAgo(400) });
    const recorded = await release(participantId, isoDaysAgo(390));
    expect(recorded.body.status).toBe("expired");
    const res = await refer(participantId);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/has expired/);
  });

  it("refuses when the release was revoked, and says so", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const recorded = await release(participantId);
    expect((await chw.post(`/api/consents/${recorded.body.id}/revoke`, { reason: "Client withdrew" })).status).toBe(200);
    const res = await refer(participantId);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/revoked/);
  });

  it("sends with a current release, and records which one authorised it", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const recorded = await release(participantId);
    const res = await refer(participantId);
    expect(res.status).toBe(201);
    expect(res.body.consentId).toBe(recorded.body.id);
  });
});
