import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { followUpCalls } from "@nmbm/db";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit, isoDaysAgo, backdateEpisodeEnd } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let director: Client;
let qa: Client;
let intake: Client;
let chw: Client;
let directorId: string;
let qaId: string;
let workerId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const d = await staff(db, "clinical_director");
  directorId = d.id;
  director = await signIn(app, d.email);
  const q = await staff(db, "quality_assurance_coordinator");
  qaId = q.id;
  qa = await signIn(app, q.email);
  intake = await signIn(app, (await staff(db, "intake_specialist")).email);
  const w = await staff(db, "community_health_worker");
  workerId = w.id;
  chw = await signIn(app, w.email);
});
afterAll(async () => app?.close());

// A case that closed `daysAgo` days ago.
async function closedAgo(daysAgo: number) {
  const ids = await admit(db, { workerId, actorId: directorId, startDate: isoDaysAgo(daysAgo + 60) });
  expect((await director.post(`/api/episodes/${ids.episodeId}/close`, { closureReason: "completed" })).status).toBe(200);
  await backdateEpisodeEnd(db, ids.episodeId, isoDaysAgo(daysAgo));
  return ids;
}

type QueueItem = { episodeId: string; months: number; attempts: number };
const inQueue = async (bucket: "overdue" | "due" | "upcoming", episodeId: string) =>
  ((await qa.get("/api/follow-ups")).body[bucket] as QueueItem[]).find((i) => i.episodeId === episodeId);

const record = (as: Client, episodeId: string, milestoneMonths: number, outcome: string, note?: string) =>
  as.post("/api/follow-ups", { episodeId, milestoneMonths, outcome, ...(note ? { note } : {}) });

describe("M12: the queue", () => {
  it("puts a 3-month call in the queue once it's due, and overdue after", async () => {
    const due = await closedAgo(92);
    const overdue = await closedAgo(125);
    const recent = await closedAgo(10);
    expect(await inQueue("due", due.episodeId)).toMatchObject({ months: 3 });
    expect(await inQueue("overdue", overdue.episodeId)).toMatchObject({ months: 3 });
    const queue = (await qa.get("/api/follow-ups")).body;
    const all = [...queue.overdue, ...queue.due, ...queue.upcoming].map((i: QueueItem) => i.episodeId);
    expect(all).not.toContain(recent.episodeId);
  });

  it("is QA's — a CHW can neither see it nor record calls", async () => {
    const { episodeId } = await closedAgo(92);
    expect((await chw.get("/api/follow-ups")).status).toBe(403);
    expect((await record(chw, episodeId, 3, "no_answer")).status).toBe(403);
  });
});

describe("M12: recording a call", () => {
  it("keeps an unanswered attempt in the queue, with the attempt counted", async () => {
    const { episodeId } = await closedAgo(92);
    expect((await record(qa, episodeId, 3, "no_answer")).status).toBe(201);
    expect(await inQueue("due", episodeId)).toMatchObject({ attempts: 1 });
  });

  it("settles the milestone once someone is reached, and only once", async () => {
    const { episodeId } = await closedAgo(92);
    expect((await record(qa, episodeId, 3, "reached_doing_well", "Working again.")).status).toBe(201);
    expect(await inQueue("due", episodeId)).toBeUndefined();
    expect((await record(qa, episodeId, 3, "declined")).status).toBe(409);
  });

  it("needs a note when someone was reached", async () => {
    const { episodeId } = await closedAgo(92);
    expect((await record(qa, episodeId, 3, "reached_doing_well")).status).toBe(400);
  });

  it("refuses a call that isn't due yet", async () => {
    const { episodeId } = await closedAgo(10);
    const res = await record(qa, episodeId, 3, "no_answer");
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/isn't due until/);
  });

  it("records who made the call, on the participant's record", async () => {
    const { participantId, episodeId } = await closedAgo(92);
    await record(qa, episodeId, 3, "reached_doing_well", "Housing stable.");
    const schedule = (await qa.get(`/api/participants/${participantId}`)).body.followUps;
    const three = schedule.milestones.find((m: { months: number }) => m.months === 3);
    expect(three.state).toBe("completed");
    expect(three.result.note).toBe("Housing stable.");
    expect(three.result.calledByName).toBeTruthy();
  });

  it("allows only one result per milestone in the database itself", async () => {
    const { participantId, episodeId } = await closedAgo(92);
    await record(qa, episodeId, 3, "declined");
    await expect(
      db.insert(followUpCalls).values({ participantId, episodeId, milestoneMonths: 3, outcome: "wrong_number", calledById: qaId }),
    ).rejects.toThrow(/follow_up_calls_one_result_per_milestone/);
  });
});

describe("M12: 'this may lead to re-enrollment'", () => {
  it("lists someone who asked to come back for intake, until they're readmitted", async () => {
    const { participantId, episodeId } = await closedAgo(92);
    await record(qa, episodeId, 3, "reached_wants_services", "Asked for help with rent again.");

    const listed = async () =>
      ((await intake.get("/api/follow-ups/re-enrollment-requests")).body as { participantId: string }[]).some(
        (r) => r.participantId === participantId,
      );
    expect(await listed()).toBe(true);

    const res = await intake.post("/api/episodes", { participantId, startDate: isoDaysAgo(0), assignedWorkerId: workerId });
    expect(res.status).toBe(201);
    expect(await listed()).toBe(false);
  });

  it("stops the old schedule once they're readmitted", async () => {
    const { participantId, episodeId } = await closedAgo(92);
    await director.post("/api/episodes", { participantId, startDate: isoDaysAgo(0), assignedWorkerId: workerId });
    expect(await inQueue("due", episodeId)).toBeUndefined();
    expect((await record(qa, episodeId, 3, "no_answer")).status).toBe(409);
    expect((await director.get(`/api/participants/${participantId}`)).body.followUps).toBeNull();
  });

  it("shows the counts on the Today page only to the roles that act on them", async () => {
    await closedAgo(92);
    const forQa = (await qa.get("/api/dashboard")).body;
    expect(forQa.followUps.due).toBeGreaterThan(0);
    const forChw = (await chw.get("/api/dashboard")).body;
    expect(forChw.followUps).toBeNull();
    expect(forChw.reEnrollmentRequests).toBeNull();
  });
});
