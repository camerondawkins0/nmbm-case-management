import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { auditLog, consents, episodes } from "@nmbm/db";
import { and, eq } from "drizzle-orm";
import { addDays, CARE_PLAN_REVIEW_INTERVAL_DAYS, todayInOrg } from "@nmbm/shared";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit } from "./support/fixtures.js";
import { followUpSchedule } from "../src/lib/follow-ups.js";
import { getSetting } from "../src/lib/settings.js";

// Every date the server decides is Long Beach's, not UTC's. The clock here
// is held at 02:30 UTC on the real current day, which is 6:30pm (7:30pm in
// summer) the evening before in Long Beach: the hours when the two disagree
// and the server used to act as if it were already tomorrow. Holding it
// there makes these run the same whatever hour CI does.
const evening = new Date();
evening.setUTCHours(2, 30, 0, 0);
const utcDay = evening.toISOString().slice(0, 10);
const orgToday = todayInOrg(evening);

let app: FastifyInstance;
let db: Db;
let chw: Client;
let chwId: string;
let director: Client;
let directorId: string;

beforeAll(async () => {
  // Only Date is held; timers run, so the database driver is unaffected.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(evening);
  ({ app, db } = await startApp());
  const w = await staff(db, "community_health_worker");
  chwId = w.id;
  chw = await signIn(app, w.email);
  const d = await staff(db, "clinical_director");
  directorId = d.id;
  director = await signIn(app, d.email);
});
afterAll(async () => {
  vi.useRealTimers();
  await app?.close();
});

const client = () => admit(db, { workerId: chwId, actorId: directorId, startDate: addDays(orgToday, -40) });

describe("the server's today is Long Beach's today", () => {
  it("is evening in Long Beach while UTC is already tomorrow (the premise)", () => {
    expect(orgToday).toBe(addDays(utcDay, -1));
  });

  it("dates a case closed in the evening by Long Beach's day, so it can be readmitted that day", async () => {
    const { participantId, episodeId } = await client();
    expect((await director.post(`/api/episodes/${episodeId}/close`, { closureReason: "completed" })).status).toBe(200);
    const [closed] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    expect(closed.endDate).toBe(orgToday);
    const readmitted = await director.post("/api/episodes", { participantId, startDate: orgToday, assignedWorkerId: chwId });
    expect(readmitted.status).toBe(201);
  });

  it("refuses a consent dated tomorrow, and keeps one expiring today active", async () => {
    const { participantId } = await client();
    const consent = (signedDate: string) =>
      chw.post("/api/consents", { participantId, type: "release_of_information", formName: "Release", signedDate });
    const tomorrow = await consent(addDays(orgToday, 1));
    expect(tomorrow.status).toBe(400);
    expect(tomorrow.body.message).toBe("A consent can't be signed in the future");

    const signed = await consent(orgToday);
    expect(signed.status).toBe(201);
    await db.update(consents).set({ expiresDate: orgToday }).where(eq(consents.id, signed.body.id));
    const record = (await chw.get(`/api/participants/${participantId}`)).body;
    expect(record.consents.find((c: { id: string }) => c.id === signed.body.id).status).toBe("active");
  });

  it("doesn't call a care plan due today overdue", async () => {
    const { participantId, episodeId } = await client();
    await db.update(episodes).set({ carePlanDueDate: orgToday }).where(eq(episodes.id, episodeId));
    const flags = (await chw.get(`/api/participants/${participantId}`)).body.flags.carePlan;
    expect(flags).toMatchObject({ missing: true, completionOverdue: false, daysUntilCompletionDue: 0 });
  });

  it("counts a care plan's next review from the Long Beach day it was approved", async () => {
    const ids = await client();
    const plan = await chw.post("/api/care-plans", { ...ids, goals: "Stable housing." });
    expect(plan.status).toBe(201);
    expect((await chw.post(`/api/care-plans/${plan.body.id}/submit`)).status).toBe(200);
    expect((await director.post(`/api/care-plans/${plan.body.id}/approve`)).status).toBe(200);
    const flags = (await chw.get(`/api/participants/${ids.participantId}`)).body.flags.carePlan;
    expect(flags.reviewDueDate).toBe(addDays(orgToday, CARE_PLAN_REVIEW_INTERVAL_DAYS));
  });

  it("tells a former case manager the Long Beach day their access ends", async () => {
    const days = await getSetting(db, "former_worker_access_days");
    expect(days).toBeGreaterThan(0);
    const { participantId, episodeId } = await client();
    expect((await director.post(`/api/episodes/${episodeId}/close`, { closureReason: "completed" })).status).toBe(200);
    const closed = (await chw.get("/api/participants?status=closed")).body as { id: string; accessUntil: string }[];
    expect(closed.find((r) => r.id === participantId)?.accessUntil).toBe(addDays(orgToday, days));
  });

  it("records a participant link's expiry as the Long Beach day", async () => {
    const days = await getSetting(db, "self_serve_link_days");
    const form = (await director.post("/api/assessment-forms", { name: `Evening ${randomUUID().slice(0, 6)}` })).body;
    const q = randomUUID();
    await director.put(`/api/assessment-versions/${form.draftVersionId}/questions`, {
      questions: [{ stableId: q, type: "yes_no", prompt: "Housed?", required: true, options: [] }],
    });
    await director.post(`/api/assessment-versions/${form.draftVersionId}/publish`);
    const { participantId } = await client();
    expect((await chw.post(`/api/participants/${participantId}/assessment-links`, { formId: form.id })).status).toBe(201);
    const [row] = await db
      .select({ detail: auditLog.detail })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, participantId), eq(auditLog.action, "assessment.link_issued")));
    expect(row.detail).toBe(`expires ${addDays(orgToday, days)}`);
  });
});

describe("follow-up calls fall due on Long Beach's days", () => {
  // A case end date where the schedule reads differently on Long Beach's
  // today than on UTC's, with a call shown in the queue either way.
  function boundary() {
    for (let k = -500; k <= 0; k++) {
      const end = addDays(orgToday, k);
      const org = followUpSchedule(end, [], orgToday);
      const utc = followUpSchedule(end, [], utcDay);
      const m = org.findIndex((x, i) => x.state !== utc[i].state && (x.state === "due" || x.state === "overdue"));
      if (m >= 0) return { end, months: org[m].months, state: org[m].state };
    }
    throw new Error("no boundary found");
  }

  it("works out the schedule from Long Beach's today when none is given", () => {
    const b = boundary();
    expect(followUpSchedule(b.end, []).find((x) => x.months === b.months)?.state).toBe(b.state);
  });

  it("shows a call in the queue as Long Beach's day has it", async () => {
    const b = boundary();
    const { participantId, episodeId } = await admit(db, { workerId: chwId, actorId: directorId, startDate: addDays(b.end, -60) });
    expect((await director.post(`/api/episodes/${episodeId}/close`, { closureReason: "completed" })).status).toBe(200);
    await db.update(episodes).set({ endDate: b.end }).where(eq(episodes.id, episodeId));
    const queue = (await director.get("/api/follow-ups")).body as Record<string, { participantId: string; months: number; state: string }[]>;
    const item = [...queue.overdue, ...queue.due].find((i) => i.participantId === participantId && i.months === b.months);
    expect(item?.state).toBe(b.state);
  });
});
