import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let chw: Client;
let manager: Client;
let director: Client;
let chwId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const worker = await staff(db, "community_health_worker");
  chwId = worker.id;
  chw = await signIn(app, worker.email);
  manager = await signIn(app, (await staff(db, "program_manager")).email);
  director = await signIn(app, (await staff(db, "clinical_director")).email);
});
afterAll(async () => app?.close());

async function chwNote() {
  const ids = await admit(db, { workerId: chwId, actorId: chwId });
  const res = await chw.post("/api/notes", { ...ids, contactResult: "contacted", body: "Home visit." });
  expect(res.status).toBe(201);
  return { ...ids, noteId: res.body.note.id as string, status: res.body.note.status as string };
}

describe("U6: work is signed off by someone other than its author", () => {
  it("queues a CHW's note for review, and the CHW can't approve it", async () => {
    const { noteId, status } = await chwNote();
    expect(status).toBe("pending_review");
    expect((await chw.post(`/api/notes/${noteId}/approve`)).status).toBe(403);
    expect((await manager.post(`/api/notes/${noteId}/approve`)).status).toBe(200);
  });

  it("requires a reason to return a note, and shows it to the author", async () => {
    const { noteId, participantId } = await chwNote();
    expect((await manager.post(`/api/notes/${noteId}/return`, {})).status).toBe(400);
    expect((await manager.post(`/api/notes/${noteId}/return`, { reviewNote: "Add the date of the next visit." })).status).toBe(200);
    const note = (await chw.get(`/api/participants/${participantId}`)).body.notes.find((n: { id: string }) => n.id === noteId);
    expect(note.status).toBe("needs_revision");
    expect(note.reviewNote).toBe("Add the date of the next visit.");
  });

  // Nobody sits above a reviewer, so queueing their note would park it forever.
  it("approves a reviewer's own note on creation", async () => {
    const ids = await admit(db, { workerId: chwId, actorId: chwId });
    const res = await director.post("/api/notes", { ...ids, contactResult: "contacted", body: "Reviewed file." });
    expect(res.body.note.status).toBe("approved");
  });

  it("sends a care plan to the Clinical Director, not back to its author", async () => {
    const ids = await admit(db, { workerId: chwId, actorId: chwId });
    const plan = await chw.post("/api/care-plans", { ...ids, goals: "Stable housing application." });
    expect(plan.status).toBe(201);
    expect((await chw.post(`/api/care-plans/${plan.body.id}/submit`)).status).toBe(200);
    expect((await chw.post(`/api/care-plans/${plan.body.id}/approve`)).status).toBe(403);
    expect((await director.post(`/api/care-plans/${plan.body.id}/approve`)).status).toBe(200);
  });
});
