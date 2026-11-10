import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { auditLog } from "@nmbm/db";
import { and, eq } from "drizzle-orm";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, staffWith, admit, contacts, isoDaysAgo } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let director: Client;
let directorId: string;
let qa: Client;
let chw: Client;
let chwId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const d = await staff(db, "clinical_director");
  directorId = d.id;
  director = await signIn(app, d.email);
  qa = await signIn(app, (await staff(db, "quality_assurance_coordinator")).email);
  const w = await staff(db, "community_health_worker");
  chwId = w.id;
  chw = await signIn(app, w.email);
});
afterAll(async () => app?.close());

const exportOf = (as: Client, participantId: string, body: Record<string, unknown> = { purpose: "participant_request" }) =>
  as.post(`/api/participants/${participantId}/record-export`, body);

describe("exporting a whole record", () => {
  it("is held by few: a worker can read the record but not export it", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: directorId });
    expect((await chw.get(`/api/participants/${participantId}`)).status).toBe(200);
    expect((await exportOf(chw, participantId)).status).toBe(403);
    expect((await exportOf(qa, participantId)).status).toBe(200);
  });

  it("needs a purpose, and says what 'other' is", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: directorId });
    expect((await exportOf(director, participantId, {})).status).toBe(400);
    expect((await exportOf(director, participantId, { purpose: "other" })).status).toBe(400);
    expect((await exportOf(director, participantId, { purpose: "other", note: "Board review" })).status).toBe(200);
  });

  it("is audited as a disclosure, with the purpose", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: directorId });
    await exportOf(director, participantId, { purpose: "legal_request", note: "Subpoena 24-117" });
    const [row] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, participantId), eq(auditLog.action, "record.exported")));
    expect(row).toMatchObject({ actorUserId: directorId, detail: "legal_request: Subpoena 24-117" });
  });

  it("holds the whole record — and answers in words, not stored codes", async () => {
    const { participantId, episodeId } = await admit(db, { workerId: chwId, actorId: directorId });
    await contacts(db, { participantId, episodeId, authorId: chwId }, ["contacted"]);
    await chw.post("/api/consents", {
      participantId,
      type: "release_of_information",
      formName: "Authorization to release information",
      signedDate: isoDaysAgo(1),
    });
    await chw.post("/api/referrals", { participantId, partnerName: "Food Bank", serviceType: "Food" });

    const helps = randomUUID();
    const form = (await director.post("/api/assessment-forms", { name: `Export ${randomUUID().slice(0, 6)}` })).body;
    await director.put(`/api/assessment-versions/${form.draftVersionId}/questions`, {
      questions: [
        {
          stableId: helps,
          type: "multi_choice",
          prompt: "What would help?",
          required: true,
          options: [
            { value: "o_food", label: "Food" },
            { value: "o_bus", label: "Bus pass" },
          ],
        },
      ],
    });
    await director.post(`/api/assessment-versions/${form.draftVersionId}/publish`);
    const a = (await chw.post(`/api/participants/${participantId}/assessments`, { formId: form.id, mode: "with_staff" })).body;
    await chw.patch(`/api/assessments/${a.id}/answers`, { answers: { [helps]: ["o_bus"] } });
    await chw.post(`/api/assessments/${a.id}/complete`);

    const res = await exportOf(director, participantId);
    expect(res.status).toBe(200);
    const doc = res.body;
    expect(doc.participant.id).toBe(participantId);
    expect(doc.purpose).toBe("participant_request");
    expect(doc.episodes).toHaveLength(1);
    expect(doc.caseManagers).toHaveLength(1);
    expect(doc.notes).toHaveLength(1);
    expect(doc.consents).toHaveLength(1);
    expect(doc.referralsOut).toHaveLength(1);
    expect(doc.assessments[0].answers).toEqual([{ section: null, question: "What would help?", answer: "Bus pass" }]);
    expect(JSON.stringify(doc)).not.toContain("o_bus");
    expect(doc.omitted.length).toBeGreaterThan(0);
  });

  it("follows the record's scoping: an export permission doesn't widen what you can see", async () => {
    // Both default holders read everything, so a role made for the test
    // pairs the export with an ordinary caseload (and the note-writing
    // that lets somebody hold one).
    const exporter = await staffWith(db, ["records.export", "participants.read.own", "notes.write"]);
    const asExporter = await signIn(app, exporter.email);
    const theirs = await admit(db, { workerId: exporter.id, actorId: directorId });
    const someoneElses = await admit(db, { workerId: chwId, actorId: directorId });

    expect((await exportOf(asExporter, theirs.participantId)).status).toBe(200);
    // Not on their caseload answers the same as not existing.
    expect((await exportOf(asExporter, someoneElses.participantId)).status).toBe(404);
    expect((await exportOf(asExporter, randomUUID())).status).toBe(404);
  });
});
