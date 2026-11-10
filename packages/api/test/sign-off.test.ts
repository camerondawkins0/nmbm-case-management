import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, staffWith, admit } from "./support/fixtures.js";

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
    // Somebody who can see the record but didn't write the note.
    expect((await director.patch(`/api/notes/${noteId}`, { body: "Not mine to change." })).status).toBe(409);
    // Somebody who can't see the record doesn't get that far.
    const other = await signIn(app, (await staff(db, "community_health_worker")).email);
    expect((await other.patch(`/api/notes/${noteId}`, { body: "Not mine to change." })).status).toBe(403);

    const approved = await chwNote();
    await manager.post(`/api/notes/${approved.noteId}/approve`);
    expect((await chw.patch(`/api/notes/${approved.noteId}`, { body: "Rewriting history." })).status).toBe(409);
  });
});

describe("U6: an intern's notes go to clinical review", () => {
  let intern: Client;
  let internId: string;
  beforeAll(async () => {
    const user = await staff(db, "apcc_acsw_intern");
    internId = user.id;
    intern = await signIn(app, user.email);
  });

  async function internNote() {
    const ids = await admit(db, { workerId: internId, actorId: internId });
    const res = await intern.post("/api/notes", { ...ids, contactResult: "contacted", body: "Session 1." });
    expect(res.status).toBe(201);
    return res.body.note as { id: string; status: string; clinicalReview: boolean };
  }

  it("is signed off by the Clinical Director, not a CHW supervisor", async () => {
    const note = await internNote();
    expect(note).toMatchObject({ status: "pending_review", clinicalReview: true });
    const refused = await manager.post(`/api/notes/${note.id}/approve`);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/clinical review/);
    expect((await manager.post(`/api/notes/${note.id}/return`, { reviewNote: "x" })).status).toBe(403);
    expect((await director.post(`/api/notes/${note.id}/approve`)).status).toBe(200);
  });

  it("shows each reviewer only the notes they can sign", async () => {
    const clinical = await internNote();
    const { noteId: chwNoteId } = await chwNote();
    const managerQueue = ((await manager.get("/api/notes/awaiting-review")).body as { id: string }[]).map((n) => n.id);
    expect(managerQueue).toContain(chwNoteId);
    expect(managerQueue).not.toContain(clinical.id);
    const directorQueue = ((await director.get("/api/notes/awaiting-review")).body as { id: string }[]).map((n) => n.id);
    expect(directorQueue).toEqual(expect.arrayContaining([chwNoteId, clinical.id]));
  });

  it("keeps a clinical reviewer who only reviews clinical notes off CHW notes", async () => {
    const clinicalOnly = await signIn(app, (await staffWith(db, ["notes.approve.clinical", "participants.read.all"])).email);
    const { noteId } = await chwNote();
    expect((await clinicalOnly.post(`/api/notes/${noteId}/approve`)).status).toBe(403);
    const clinical = await internNote();
    expect((await clinicalOnly.post(`/api/notes/${clinical.id}/approve`)).status).toBe(200);
  });

  it("stays in clinical review once written, whatever later happens to the author's roles", async () => {
    const user = await staff(db, "apcc_acsw_intern");
    const asIntern = await signIn(app, user.email);
    const ids = await admit(db, { workerId: user.id, actorId: user.id });
    const note = (await asIntern.post("/api/notes", { ...ids, contactResult: "contacted", body: "Session." })).body.note;
    // Now a CHW instead.
    const admin = await signIn(app, (await staff(db, "system_administrator")).email);
    expect((await admin.post(`/api/admin/users/${user.id}/roles`, { roleCode: "community_health_worker" })).status).toBe(200);
    expect((await admin.del(`/api/admin/users/${user.id}/roles/apcc_acsw_intern`)).status).toBe(200);
    expect((await manager.post(`/api/notes/${note.id}/approve`)).status).toBe(403);
  });

  it("is still approved on the spot when its author can sign off clinical notes themselves", async () => {
    const supervisor = await staffWith(db, ["notes.write", "notes.reviewed_clinically", "notes.approve.clinical", "participants.read.all"]);
    const asSupervisor = await signIn(app, supervisor.email);
    const ids = await admit(db, { workerId: chwId, actorId: chwId });
    const res = await asSupervisor.post("/api/notes", { ...ids, contactResult: "contacted", body: "Supervision." });
    expect(res.body.note).toMatchObject({ status: "approved", clinicalReview: true });
    // Holding only the CHW supervisor's review isn't enough for their own clinical note.
    const crossed = await staffWith(db, ["notes.write", "notes.reviewed_clinically", "notes.approve", "participants.read.all"]);
    const own = await (await signIn(app, crossed.email)).post("/api/notes", { ...ids, contactResult: "contacted", body: "x" });
    expect(own.body.note.status).toBe("pending_review");
  });
});

describe("one care plan per stay, on the client's own stay", () => {
  it("refuses a second plan for the same stay", async () => {
    const ids = await admit(db, { workerId: chwId, actorId: chwId });
    expect((await chw.post("/api/care-plans", { ...ids, goals: "First." })).status).toBe(201);
    const second = await chw.post("/api/care-plans", { ...ids, goals: "Second." });
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already has a care plan/);
    // Two arriving at once: the database refuses the second, and it's still a 409.
    const other = await admit(db, { workerId: chwId, actorId: chwId });
    const both = await Promise.all([1, 2].map((i) => chw.post("/api/care-plans", { ...other, goals: `Race ${i}` })));
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    // So the client is listed once.
    const list = (await chw.get("/api/participants")).body as { id: string }[];
    expect(list.filter((p) => p.id === other.participantId)).toHaveLength(1);
  });

  it("refuses a plan filed against another client's stay, or a closed one", async () => {
    const a = await admit(db, { workerId: chwId, actorId: chwId });
    const b = await admit(db, { workerId: chwId, actorId: chwId });
    const crossed = await chw.post("/api/care-plans", { participantId: a.participantId, episodeId: b.episodeId, goals: "Wrong person." });
    expect(crossed.status).toBe(409);
    expect(crossed.body.message).toMatch(/open episode/);
  });
});
