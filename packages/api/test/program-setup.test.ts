import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { auditLog } from "@nmbm/db";
import { and, eq } from "drizzle-orm";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, staffWith, admit, unique, isoDaysAgo } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let manager: Client;
let managerId: string;
let chw: Client;
let chwId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const m = await staff(db, "program_manager");
  managerId = m.id;
  manager = await signIn(app, m.email);
  const w = await staff(db, "community_health_worker");
  chwId = w.id;
  chw = await signIn(app, w.email);
});
afterAll(async () => app?.close());

async function cohort(extra: Record<string, unknown> = {}) {
  const program = await manager.post("/api/programs", { name: unique("Program ") });
  const res = await manager.post("/api/cohorts", {
    programId: program.body.id,
    name: unique("Cohort "),
    startDate: isoDaysAgo(7),
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; status: string };
}

describe("M14: setting a program up", () => {
  it("is for whoever runs the programs, not every worker", async () => {
    expect((await chw.post("/api/programs", { name: unique("Mine ") })).status).toBe(403);
    const c = await cohort();
    expect((await chw.post(`/api/cohorts/${c.id}/sessions`, { sessionDate: isoDaysAgo(0) })).status).toBe(403);
    expect((await chw.post(`/api/cohorts/${c.id}/status`, { status: "completed" })).status).toBe(403);
  });

  it("refuses a second program with the same name", async () => {
    const name = unique("Parenting ");
    expect((await manager.post("/api/programs", { name })).status).toBe(201);
    expect((await manager.post("/api/programs", { name })).status).toBe(409);
  });

  it("refuses a cohort that ends before it starts", async () => {
    const program = await manager.post("/api/programs", { name: unique("Program ") });
    const res = await manager.post("/api/cohorts", {
      programId: program.body.id,
      name: "Backwards",
      startDate: isoDaysAgo(0),
      endDate: isoDaysAgo(10),
    });
    expect(res.status).toBe(422);
  });

  it("builds a class: dates, a roster, and somebody withdrawn without losing their attendance", async () => {
    const c = await cohort();
    const session = await manager.post(`/api/cohorts/${c.id}/sessions`, { sessionDate: isoDaysAgo(1), topic: "Week one" });
    expect(session.status).toBe(201);
    const { participantId } = await admit(db, { workerId: chwId, actorId: managerId });
    const enrollment = await manager.post(`/api/cohorts/${c.id}/enrollments`, { participantId });
    expect(enrollment.status).toBe(201);
    expect((await manager.post(`/api/cohorts/${c.id}/enrollments`, { participantId })).status).toBe(409);

    await manager.post(`/api/sessions/${session.body.id}/attendance`, {
      marks: [{ enrollmentId: enrollment.body.id, status: "present" }],
    });
    const out = await manager.post(`/api/enrollments/${enrollment.body.id}/withdraw`, { reason: "Moved away" });
    expect(out.status).toBe(200);

    const detail = (await manager.get(`/api/cohorts/${c.id}`)).body;
    expect(detail.roster[0]).toMatchObject({ status: "withdrawn", withdrawnReason: "Moved away", attended: 1 });
  });

  it("only enrolls somebody the person enrolling can see", async () => {
    // Every default holder of programs.manage reads every record, so a
    // role made for the test pairs it with an ordinary caseload.
    const narrow = await signIn(app, (await staffWith(db, ["programs.manage", "participants.read.own"])).email);
    const c = await cohort();
    const { participantId } = await admit(db, { workerId: chwId, actorId: managerId });
    expect((await narrow.post(`/api/cohorts/${c.id}/enrollments`, { participantId })).status).toBe(403);
  });
});

describe("M14: a cohort's life", () => {
  const set = (id: string, status: string) => manager.post(`/api/cohorts/${id}/status`, { status });

  it("finishes, and a finished class takes no new people or dates until reopened", async () => {
    const c = await cohort();
    expect((await set(c.id, "completed")).body.status).toBe("completed");

    const { participantId } = await admit(db, { workerId: chwId, actorId: managerId });
    expect((await manager.post(`/api/cohorts/${c.id}/enrollments`, { participantId })).status).toBe(409);
    expect((await manager.post(`/api/cohorts/${c.id}/sessions`, { sessionDate: isoDaysAgo(0) })).status).toBe(409);

    expect((await set(c.id, "running")).status).toBe(200);
    expect((await manager.post(`/api/cohorts/${c.id}/sessions`, { sessionDate: isoDaysAgo(0) })).status).toBe(201);
  });

  it("can be canceled, and canceled is final", async () => {
    const c = await cohort();
    expect((await set(c.id, "canceled")).status).toBe(200);
    expect((await set(c.id, "running")).status).toBe(409);
    expect((await set(c.id, "completed")).status).toBe(409);
  });

  it("doesn't jump from running back to running, and audits each change", async () => {
    const c = await cohort();
    expect((await set(c.id, "running")).status).toBe(409);
    await set(c.id, "completed");
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, c.id), eq(auditLog.action, "cohort.status_changed")));
    expect(rows.map((r) => r.detail)).toEqual(["running → completed"]);
  });
});
