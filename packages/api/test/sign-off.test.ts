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

describe("U6: a returned note goes back to its author, and round again", () => {
  async function returned() {
    const n = await chwNote();
    await manager.post(`/api/notes/${n.noteId}/return`, { reviewNote: "Say where the visit was." });
    return n;
  }

  it("lists the author's returned notes, and only theirs", async () => {
    const mine = await returned();
    const otherWorker = await staff(db, "community_health_worker");
    const other = await signIn(app, otherWorker.email);

    const list = (await chw.get("/api/notes/returned")).body as { id: string; reviewNote: string }[];
    expect(list.find((n) => n.id === mine.noteId)?.reviewNote).toBe("Say where the visit was.");
    expect(((await other.get("/api/notes/returned")).body as { id: string }[]).map((n) => n.id)).not.toContain(mine.noteId);
  });

  it("goes back into the review queue once revised, without the old reason", async () => {
    const { noteId } = await returned();
    const res = await chw.patch(`/api/notes/${noteId}`, { body: "Home visit at the shelter on 4th St." });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "pending_review", reviewNote: null, body: "Home visit at the shelter on 4th St." });

    expect(((await chw.get("/api/notes/returned")).body as { id: string }[]).map((n) => n.id)).not.toContain(noteId);
    const queue = (await manager.get("/api/notes/awaiting-review")).body as { id: string }[];
    expect(queue.map((n) => n.id)).toContain(noteId);
  });

  it("is revised by its author only, and never once approved", async () => {
    const { noteId } = await returned();
    const other = await signIn(app, (await staff(db, "community_health_worker")).email);
    expect((await other.patch(`/api/notes/${noteId}`, { body: "Not mine to change." })).status).toBe(409);

    const approved = await chwNote();
    await manager.post(`/api/notes/${approved.noteId}/approve`);
    expect((await chw.patch(`/api/notes/${approved.noteId}`, { body: "Rewriting history." })).status).toBe(409);
  });
});
