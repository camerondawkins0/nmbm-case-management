import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { episodes } from "@nmbm/db";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit, contacts, isoDaysAgo, backdateAssignmentEnd } from "./support/fixtures.js";
import { reassign } from "../src/modules/participants/intake.js";

let app: FastifyInstance;
let db: Db;
let director: Client;
let admin: Client;
let directorId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const d = await staff(db, "clinical_director");
  directorId = d.id;
  director = await signIn(app, d.email);
  admin = await signIn(app, (await staff(db, "system_administrator")).email);
});
afterEach(async () => {
  await admin.put("/api/admin/settings/former_worker_access_days", { value: 90 });
});
afterAll(async () => app?.close());

async function closedCase(workerId: string, reason = "completed") {
  const ids = await admit(db, { workerId, actorId: directorId });
  expect((await director.post(`/api/episodes/${ids.episodeId}/close`, { closureReason: reason })).status).toBe(200);
  return ids;
}
const ids = (res: { body: { id: string }[] }) => res.body.map((r) => r.id);

describe("R10: closing takes the person off the active caseload immediately", () => {
  it("removes them from the worker's list and dashboard in the same request", async () => {
    const worker = await staff(db, "community_health_worker");
    const as = await signIn(app, worker.email);
    const open = await admit(db, { workerId: worker.id, actorId: directorId });
    const closing = await admit(db, { workerId: worker.id, actorId: directorId });
    expect((await as.get("/api/dashboard")).body.caseloadSize).toBe(2);

    await director.post(`/api/episodes/${closing.episodeId}/close`, { closureReason: "completed" });

    const list = ids(await as.get("/api/participants"));
    expect(list).toContain(open.participantId);
    expect(list).not.toContain(closing.participantId);
    expect((await as.get("/api/dashboard")).body.caseloadSize).toBe(1);
  });

  // A supervisor's list isn't built from assignments, so it's the one
  // place the open-episode filter is the only thing keeping closed
  // people out.
  it("keeps closed people off a read-all list too", async () => {
    const worker = await staff(db, "community_health_worker");
    const open = await admit(db, { workerId: worker.id, actorId: directorId });
    const { participantId } = await closedCase(worker.id);
    const list = ids(await director.get("/api/participants"));
    expect(list).toContain(open.participantId);
    expect(list).not.toContain(participantId);
  });

  it("doesn't present a closed record as needing attention", async () => {
    const worker = await staff(db, "community_health_worker");
    const { participantId } = await closedCase(worker.id);
    const record = await director.get(`/api/participants/${participantId}`);
    expect(record.body.needsAttention).toBe(false);
    expect(record.body.flags.carePlan.missing).toBe(false);
  });

  // U9: a worker whose only cases have closed isn't holding anyone.
  it("doesn't block deactivating a worker whose cases have all closed", async () => {
    const worker = await staff(db, "community_health_worker");
    await closedCase(worker.id);
    expect((await admin.post(`/api/admin/users/${worker.id}/deactivate`)).status).toBe(200);
  });

  it("allows only one open episode per participant, in the database itself", async () => {
    const worker = await staff(db, "community_health_worker");
    const { participantId } = await admit(db, { workerId: worker.id, actorId: directorId });
    await expect(
      db.insert(episodes).values({ participantId, startDate: isoDaysAgo(0) }),
    ).rejects.toThrow(/episodes_one_open_per_participant/);
  });
});

describe("R10: who can still reach a closed record", () => {
  it("shows every closed record to intake and read-all roles", async () => {
    const worker = await staff(db, "community_health_worker");
    const { participantId } = await closedCase(worker.id);
    const intake = await signIn(app, (await staff(db, "intake_specialist")).email);
    expect(ids(await intake.get("/api/participants?status=closed"))).toContain(participantId);
    expect(ids(await director.get("/api/participants?status=closed"))).toContain(participantId);
    expect((await intake.get(`/api/participants/${participantId}`)).status).toBe(200);
  });

  it("gives intake nothing on active cases", async () => {
    const worker = await staff(db, "community_health_worker");
    const active = await admit(db, { workerId: worker.id, actorId: directorId });
    const intake = await signIn(app, (await staff(db, "intake_specialist")).email);
    expect((await intake.get(`/api/participants/${active.participantId}`)).status).toBe(404);
  });

  it("lets the last worker read it, with the date access ends", async () => {
    const worker = await staff(db, "community_health_worker");
    const { participantId } = await closedCase(worker.id);
    const as = await signIn(app, worker.email);
    const closed = await as.get("/api/participants?status=closed");
    const row = closed.body.find((r: { id: string }) => r.id === participantId);
    expect(row.accessUntil).toBe(isoDaysAgo(-90));
    expect((await as.get(`/api/participants/${participantId}`)).status).toBe(200);
  });

  it("gives nothing to a worker who handed the case on before it closed", async () => {
    const first = await staff(db, "community_health_worker");
    const last = await staff(db, "community_health_worker");
    const ids0 = await admit(db, { workerId: first.id, actorId: directorId });
    await reassign(db, ids0.participantId, last.id, directorId);
    await director.post(`/api/episodes/${ids0.episodeId}/close`, { closureReason: "completed" });

    const as = await signIn(app, first.email);
    expect((await as.get(`/api/participants/${ids0.participantId}`)).status).toBe(404);
    expect(ids(await as.get("/api/participants?status=closed"))).not.toContain(ids0.participantId);
    expect((await (await signIn(app, last.email)).get(`/api/participants/${ids0.participantId}`)).status).toBe(200);
  });

  it("gives nothing to any other worker", async () => {
    const worker = await staff(db, "community_health_worker");
    const other = await signIn(app, (await staff(db, "community_health_worker")).email);
    const { participantId } = await closedCase(worker.id);
    expect((await other.get(`/api/participants/${participantId}`)).status).toBe(404);
    expect(ids(await other.get("/api/participants?status=closed"))).not.toContain(participantId);
  });

  it("ends the last worker's access when the window passes", async () => {
    const worker = await staff(db, "community_health_worker");
    const { participantId } = await closedCase(worker.id);
    await backdateAssignmentEnd(db, participantId, 91);
    expect((await (await signIn(app, worker.email)).get(`/api/participants/${participantId}`)).status).toBe(404);
  });

  it("follows the administrator's setting, which can shorten the window", async () => {
    const worker = await staff(db, "community_health_worker");
    const { participantId } = await closedCase(worker.id);
    await backdateAssignmentEnd(db, participantId, 40);
    const as = await signIn(app, worker.email);
    expect((await as.get(`/api/participants/${participantId}`)).status).toBe(200);

    expect((await admin.put("/api/admin/settings/former_worker_access_days", { value: 30 })).status).toBe(200);
    expect((await as.get(`/api/participants/${participantId}`)).status).toBe(404);

    await admin.put("/api/admin/settings/former_worker_access_days", { value: 0 });
    const fresh = await closedCase(worker.id);
    expect((await as.get(`/api/participants/${fresh.participantId}`)).status).toBe(404);
  });

  it("caps the window at 90 days, and only an administrator can change it", async () => {
    const res = await admin.put("/api/admin/settings/former_worker_access_days", { value: 91 });
    expect(res.status).toBe(422);
    const chw = await signIn(app, (await staff(db, "community_health_worker")).email);
    expect((await chw.put("/api/admin/settings/former_worker_access_days", { value: 30 })).status).toBe(403);
  });

  it("keeps a closed record read-only", async () => {
    const worker = await staff(db, "community_health_worker");
    const { participantId, episodeId } = await closedCase(worker.id);
    const as = await signIn(app, worker.email);
    const note = await as.post("/api/notes", { participantId, episodeId, contactResult: "contacted", body: "x" });
    expect(note.status).toBe(409);
  });

  it("refuses to reassign a closed record — readmission is the way back", async () => {
    const worker = await staff(db, "community_health_worker");
    const { participantId } = await closedCase(worker.id);
    const res = await director.post(`/api/participants/${participantId}/assignment`, { workerId: worker.id });
    expect(res.status).toBe(409);
  });
});

describe("R10: readmission", () => {
  it("starts a fresh no-contact run, linked to the previous episode", async () => {
    const worker = await staff(db, "community_health_worker");
    const first = await admit(db, { workerId: worker.id, actorId: directorId, startDate: isoDaysAgo(60) });
    await contacts(db, { ...first, authorId: worker.id }, Array(5).fill("no_contact"));
    await director.post(`/api/episodes/${first.episodeId}/close`, { closureReason: "no_contact" });

    const intake = await signIn(app, (await staff(db, "intake_specialist")).email);
    const res = await intake.post("/api/episodes", {
      participantId: first.participantId,
      startDate: isoDaysAgo(0),
      assignedWorkerId: worker.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.readmittedFromEpisodeId).toBe(first.episodeId);

    const row = (await (await signIn(app, worker.email)).get("/api/participants")).body.find(
      (r: { id: string }) => r.id === first.participantId,
    );
    expect(row.flags.noContact.count).toBe(0);
    expect(row.flags.noContact.warning).toBe(false);
  });

  it("refuses a second open episode, and a start before the last one ended", async () => {
    const worker = await staff(db, "community_health_worker");
    const { participantId } = await closedCase(worker.id);
    const body = { participantId, startDate: isoDaysAgo(0), assignedWorkerId: worker.id };
    expect((await director.post("/api/episodes", { ...body, startDate: isoDaysAgo(30) })).status).toBe(422);
    expect((await director.post("/api/episodes", body)).status).toBe(201);
    expect((await director.post("/api/episodes", body)).status).toBe(409);
  });

  it("ends the former worker's window once the case is someone's again", async () => {
    const worker = await staff(db, "community_health_worker");
    const next = await staff(db, "community_health_worker");
    const { participantId } = await closedCase(worker.id);
    await director.post("/api/episodes", { participantId, startDate: isoDaysAgo(0), assignedWorkerId: next.id });
    expect((await (await signIn(app, worker.email)).get(`/api/participants/${participantId}`)).status).toBe(404);
  });

  // The worker list feeds the intake and readmit forms. It used to need
  // participants.assign, which intake doesn't hold.
  it("lets intake load the list of workers to assign", async () => {
    const intake = await signIn(app, (await staff(db, "intake_specialist")).email);
    expect((await intake.get("/api/participants/assignable-workers")).status).toBe(200);
  });
});
