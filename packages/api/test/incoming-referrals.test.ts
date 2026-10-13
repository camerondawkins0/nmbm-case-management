import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { auditLog, incomingReferrals } from "@nmbm/db";
import { and, eq } from "drizzle-orm";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, staffWith, admit, isoDaysAgo, unique } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let intake: Client;
let intakeId: string;
let chw: Client;
let chwId: string;
let director: Client;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const i = await staff(db, "intake_specialist");
  intakeId = i.id;
  intake = await signIn(app, i.email);
  const w = await staff(db, "community_health_worker");
  chwId = w.id;
  chw = await signIn(app, w.email);
  director = await signIn(app, (await staff(db, "clinical_director")).email);
});
afterAll(async () => app?.close());

const referral = (extra: Record<string, unknown> = {}) => ({
  receivedDate: isoDaysAgo(3),
  sourceType: "hospital",
  sourceName: "St Mary's discharge team",
  firstName: unique("Ref"),
  lastName: unique("Person"),
  dateOfBirth: "1990-05-05",
  reason: "Needs housing support after discharge",
  ...extra,
});

async function received(extra: Record<string, unknown> = {}) {
  const res = await intake.post("/api/incoming-referrals", referral(extra));
  expect(res.status).toBe(201);
  return res.body as { id: string; firstName: string; lastName: string };
}

const queue = async (view = "open") =>
  ((await intake.get(`/api/incoming-referrals?view=${view}`)).body as { id: string }[]).map((r) => r.id);

describe("the referrals queue", () => {
  it("is intake's to work, not every worker's", async () => {
    expect((await chw.get("/api/incoming-referrals")).status).toBe(403);
    expect((await chw.post("/api/incoming-referrals", referral())).status).toBe(403);
  });

  it("holds a referral until it's dealt with, and a note means somebody's on it", async () => {
    const r = await received();
    expect(await queue()).toContain(r.id);
    const note = await intake.post(`/api/incoming-referrals/${r.id}/notes`, { body: "Left a voicemail" });
    expect(note.status).toBe(201);
    expect((await intake.get(`/api/incoming-referrals/${r.id}`)).body).toMatchObject({
      status: "contacting",
      notes: [{ body: "Left a voicemail" }],
    });
  });

  it("closes with a reason, keeps the row, and takes nothing more", async () => {
    const r = await received();
    const closed = await intake.post(`/api/incoming-referrals/${r.id}/close`, {
      reason: "unable_to_reach",
      note: "Three calls, no answer",
    });
    expect(closed.status).toBe(200);
    expect(await queue()).not.toContain(r.id);
    expect((await intake.get(`/api/incoming-referrals/${r.id}`)).body).toMatchObject({
      status: "closed",
      closeReason: "unable_to_reach",
    });
    expect((await intake.post(`/api/incoming-referrals/${r.id}/notes`, { body: "late" })).status).toBe(409);
    expect((await intake.post(`/api/incoming-referrals/${r.id}/close`, { reason: "declined" })).status).toBe(409);
  });
});

describe("admitting someone who was referred", () => {
  it("admits a new person and settles the referral in the same act", async () => {
    const r = await received();
    const res = await intake.post("/api/participants/intake", {
      firstName: r.firstName,
      lastName: r.lastName,
      dateOfBirth: "1990-05-05",
      assignedWorkerId: chwId,
      startDate: isoDaysAgo(0),
      incomingReferralId: r.id,
    });
    expect(res.status).toBe(201);
    const after = (await intake.get(`/api/incoming-referrals/${r.id}`)).body;
    expect(after).toMatchObject({
      status: "admitted",
      participantId: res.body.participant.id,
      episodeId: res.body.episode.id,
    });

    // And the record says who sent them, for whoever can open it.
    const record = (await chw.get(`/api/participants/${res.body.participant.id}`)).body;
    expect(record.referralsIn).toEqual([
      expect.objectContaining({ sourceName: "St Mary's discharge team", reason: "Needs housing support after discharge" }),
    ]);
  });

  it("doesn't admit anybody if the referral was already dealt with", async () => {
    const r = await received();
    await intake.post(`/api/incoming-referrals/${r.id}/close`, { reason: "declined" });
    const res = await intake.post("/api/participants/intake", {
      firstName: r.firstName,
      lastName: r.lastName,
      dateOfBirth: "1990-05-05",
      assignedWorkerId: chwId,
      startDate: isoDaysAgo(0),
      incomingReferralId: r.id,
    });
    expect(res.status).toBe(409);
    // The transaction rolled back: no record was made either.
    expect((await intake.get(`/api/participants/search?q=${r.lastName}`)).body).toEqual([]);
  });

  it("isn't for an admitter who can't work the queue", async () => {
    // No seeded role admits without also holding the queue, but grants
    // are NMBM's to change.
    const admitter = await signIn(
      app,
      (await staffWith(db, ["participants.write", "episodes.write", "participants.read.closed"])).email,
    );
    const r = await received();
    const body = {
      firstName: r.firstName,
      lastName: r.lastName,
      dateOfBirth: "1990-05-05",
      assignedWorkerId: chwId,
      startDate: isoDaysAgo(0),
    };
    expect((await admitter.post("/api/participants/intake", { ...body, incomingReferralId: r.id })).status).toBe(403);
    // Without the referral, the same person admits as before.
    expect((await admitter.post("/api/participants/intake", body)).status).toBe(201);

    // And the same for readmission.
    const { participantId, episodeId } = await admit(db, { workerId: chwId, actorId: intakeId });
    await director.post(`/api/episodes/${episodeId}/close`, { closureReason: "completed" });
    const readmit = { participantId, startDate: isoDaysAgo(0), assignedWorkerId: chwId };
    expect((await admitter.post("/api/episodes", { ...readmit, incomingReferralId: r.id })).status).toBe(403);
    expect((await admitter.post("/api/episodes", readmit)).status).toBe(201);
  });

  it("readmits a returning client from the referral, settling it in the same act", async () => {
    const { participantId, episodeId } = await admit(db, { workerId: chwId, actorId: intakeId });
    const r = await received();
    await director.post(`/api/episodes/${episodeId}/close`, { closureReason: "completed" });
    const closedLink = await intake.post(`/api/incoming-referrals/${r.id}/link`, { participantId });
    expect(closedLink.status).toBe(409);
    expect(closedLink.body.message).toMatch(/readmit/);

    // Intake can see the closed record to readmit it, but not the
    // active one it becomes — so the referral goes with the readmission.
    const readmitted = await intake.post("/api/episodes", {
      participantId,
      startDate: isoDaysAgo(0),
      assignedWorkerId: chwId,
      incomingReferralId: r.id,
    });
    expect(readmitted.status).toBe(201);
    expect((await intake.get(`/api/incoming-referrals/${r.id}`)).body).toMatchObject({
      status: "admitted",
      participantId,
      episodeId: readmitted.body.id,
    });
  });

  it("links a referral for somebody already active to their current stay", async () => {
    const { participantId, episodeId } = await admit(db, { workerId: chwId, actorId: intakeId });
    const r = await received();
    // The Clinical Director can see every active record.
    const linked = await director.post(`/api/incoming-referrals/${r.id}/link`, { participantId });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ status: "admitted", episodeId });
  });

  it("won't link to a record the person linking can't open", async () => {
    // Intake sees closed records, not other workers' active ones.
    const { participantId } = await admit(db, { workerId: chwId, actorId: intakeId });
    const r = await received();
    expect((await intake.post(`/api/incoming-referrals/${r.id}/link`, { participantId })).status).toBe(404);
  });
});

describe("closing the loop with the referrer", () => {
  it("is owed once there's an outcome, and recorded once", async () => {
    const r = await received();
    expect((await intake.post(`/api/incoming-referrals/${r.id}/outcome-reported`)).status).toBe(409);
    await intake.post(`/api/incoming-referrals/${r.id}/close`, { reason: "not_eligible" });
    expect(await queue("outcome_owed")).toContain(r.id);

    expect((await intake.post(`/api/incoming-referrals/${r.id}/outcome-reported`)).status).toBe(200);
    expect(await queue("outcome_owed")).not.toContain(r.id);
    expect((await intake.post(`/api/incoming-referrals/${r.id}/outcome-reported`)).status).toBe(409);
  });

  it("isn't owed for a self-referral or one entered in error", async () => {
    const self = await received({ sourceType: "self", sourceName: null });
    await intake.post(`/api/incoming-referrals/${self.id}/close`, { reason: "declined" });
    const mistake = await received();
    await intake.post(`/api/incoming-referrals/${mistake.id}/close`, { reason: "entered_in_error" });
    const owed = await queue("outcome_owed");
    expect(owed).not.toContain(self.id);
    expect(owed).not.toContain(mistake.id);
  });

  it("audits what happened to it", async () => {
    const r = await received();
    await intake.post(`/api/incoming-referrals/${r.id}/close`, { reason: "declined" });
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, r.id), eq(auditLog.actorUserId, intakeId)));
    expect(rows.map((x) => x.action).sort()).toEqual(["incoming_referral.closed", "incoming_referral.recorded"]);
    const [row] = await db.select().from(incomingReferrals).where(eq(incomingReferrals.id, r.id));
    expect(row.closedById).toBe(intakeId);
  });
});
