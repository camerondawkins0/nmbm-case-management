import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { auditLog } from "@nmbm/db";
import { and, eq } from "drizzle-orm";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit, unique, isoDaysAgo } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let intake: Client;
let chw: Client;
let chwId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  intake = await signIn(app, (await staff(db, "intake_specialist")).email);
  const worker = await staff(db, "community_health_worker");
  chwId = worker.id;
  chw = await signIn(app, worker.email);
});
afterAll(async () => app?.close());

// CINs must be unique across the shared test database.
let cinCounter = 0;
const cin = () => `${String(Date.now() % 1e7).padStart(7, "0")}${cinCounter++ % 10}A`;

const admission = (details: Record<string, unknown> = {}) => ({
  firstName: unique("F"),
  lastName: unique("L"),
  dateOfBirth: "1966-06-06",
  assignedWorkerId: chwId,
  startDate: isoDaysAgo(1),
  ...details,
});

describe("intake takes contact and insurance details", () => {
  it("stores them tidied up, and shows them on the record", async () => {
    const number = cin();
    const res = await intake.post(
      "/api/participants/intake",
      admission({
        phone: "1 (562) 555-0134",
        email: " Someone@Example.COM ",
        addressLine1: "100 Ocean Blvd",
        addressLine2: "",
        city: "Long Beach",
        state: "ca",
        postalCode: "90802",
        mediCalCin: number.toLowerCase().replace(/^(\d{4})/, "$1 "),
        planMemberId: " K-12345 ",
        emergencyContactName: "Ana Ruiz",
        emergencyContactPhone: "562.555.0199",
        emergencyContactRelationship: "Sister",
      }),
    );
    expect(res.status).toBe(201);
    const record = (await chw.get(`/api/participants/${res.body.participant.id}`)).body;
    expect(record.details).toMatchObject({
      phone: "5625550134",
      email: "someone@example.com",
      addressLine1: "100 Ocean Blvd",
      addressLine2: null,
      city: "Long Beach",
      state: "CA",
      postalCode: "90802",
      mediCalCin: number,
      planMemberId: "K-12345",
      emergencyContactPhone: "5625550199",
    });
  });

  it("still admits with none of them: what intake must know is unanswered (M3)", async () => {
    const res = await intake.post("/api/participants/intake", admission());
    expect(res.status).toBe(201);
    const record = (await chw.get(`/api/participants/${res.body.participant.id}`)).body;
    expect(record.details.phone).toBeNull();
  });

  it("refuses values that can't be right, saying what's wrong", async () => {
    for (const bad of [{ phone: "555-0134" }, { mediCalCin: "1234567A" }, { postalCode: "9080" }, { state: "Calif" }, { email: "nope" }]) {
      const res = await intake.post("/api/participants/intake", admission(bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    const res = await intake.post("/api/participants/intake", admission({ mediCalCin: "12345" }));
    expect(JSON.stringify(res.body)).toMatch(/8 digits and a letter/);
  });

  it("refuses a second record with the same Medi-Cal CIN, even when told it's somebody else", async () => {
    const number = cin();
    expect((await intake.post("/api/participants/intake", admission({ mediCalCin: number }))).status).toBe(201);
    const again = await intake.post("/api/participants/intake", admission({ mediCalCin: number, confirmNotDuplicate: true }));
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/Medi-Cal CIN already exists/);
  });
});

describe("details are kept current on the record", () => {
  it("lets the case manager change them, logging which fields changed but not what to", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const res = await chw.patch(`/api/participants/${participantId}/details`, { phone: "(562) 555-0111", city: "Signal Hill" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ phone: "5625550111", city: "Signal Hill" });
    const [line] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, participantId), eq(auditLog.action, "participant.details_updated")));
    expect(line.detail).toBe("Changed: Phone, City");
    expect(line.detail).not.toContain("555");

    // Only what's sent changes; a blank clears.
    const cleared = await chw.patch(`/api/participants/${participantId}/details`, { city: "" });
    expect(cleared.body).toMatchObject({ phone: "5625550111", city: null });
  });

  it("writes nothing when nothing changed", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    await chw.patch(`/api/participants/${participantId}/details`, { city: "Lakewood" });
    await chw.patch(`/api/participants/${participantId}/details`, { city: "Lakewood" });
    const lines = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, participantId), eq(auditLog.action, "participant.details_updated")));
    expect(lines).toHaveLength(1);
  });

  it("is for people who can update details and see the client", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const otherChw = await signIn(app, (await staff(db, "community_health_worker")).email);
    expect((await otherChw.patch(`/api/participants/${participantId}/details`, { city: "x" })).status).toBe(403);
    const qa = await signIn(app, (await staff(db, "quality_assurance_coordinator")).email);
    expect((await qa.patch(`/api/participants/${participantId}/details`, { city: "x" })).status).toBe(403);
  });

  it("won't take a CIN that's already on another record", async () => {
    const number = cin();
    await intake.post("/api/participants/intake", admission({ mediCalCin: number }));
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const res = await chw.patch(`/api/participants/${participantId}/details`, { mediCalCin: number });
    expect(res.status).toBe(409);
  });

  it("goes into the whole-record export", async () => {
    const director = await signIn(app, (await staff(db, "clinical_director")).email);
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    await chw.patch(`/api/participants/${participantId}/details`, { phone: "5625550122" });
    const doc = (await director.post(`/api/participants/${participantId}/record-export`, { purpose: "participant_request" })).body;
    expect(doc.participant.details.phone).toBe("5625550122");
  });
});
