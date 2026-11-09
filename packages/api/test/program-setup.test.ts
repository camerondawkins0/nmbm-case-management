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

describe("M14: what completing a program takes is NMBM's to set", () => {
  // One class held, attended late by one person and excused for another.
  async function lateAndExcused(programExtra: Record<string, unknown> = {}) {
    const program = (await manager.post("/api/programs", { name: unique("Rules "), ...programExtra })).body;
    const c = (await manager.post("/api/cohorts", { programId: program.id, name: unique("C "), startDate: isoDaysAgo(7) })).body;
    const session = (await manager.post(`/api/cohorts/${c.id}/sessions`, { sessionDate: isoDaysAgo(1) })).body;
    const people: string[] = [];
    for (const status of ["late", "excused"]) {
      const { participantId } = await admit(db, { workerId: chwId, actorId: managerId });
      const e = (await manager.post(`/api/cohorts/${c.id}/enrollments`, { participantId })).body;
      await manager.post(`/api/sessions/${session.id}/attendance`, { marks: [{ enrollmentId: e.id, status }] });
      people.push(e.id as string);
    }
    const attended = async () =>
      ((await manager.get(`/api/cohorts/${c.id}`)).body.roster as { enrollmentId: string; attended: number }[]).map(
        (r) => [people.indexOf(r.enrollmentId) === 0 ? "late" : "excused", r.attended],
      );
    return { program, cohort: c, people, attended };
  }

  it("counts late but not excused until told otherwise", async () => {
    const { attended } = await lateAndExcused();
    expect(Object.fromEntries(await attended())).toEqual({ late: 1, excused: 0 });
  });

  it("counts what the program says, on the roster and on the participation record", async () => {
    const { program, people, attended } = await lateAndExcused();
    const res = await manager.patch(`/api/programs/${program.id}`, { lateCounts: false, excusedCounts: true });
    expect(res.status).toBe(200);
    expect(Object.fromEntries(await attended())).toEqual({ late: 0, excused: 1 });

    const record = (await manager.get(`/api/enrollments/${people[1]}/participation`)).body;
    expect(record).toMatchObject({ attended: 1, countedStatuses: ["present", "excused"] });

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, program.id), eq(auditLog.action, "program.updated")));
    expect(entry.detail).toBe("lateCounts: yes → no; excusedCounts: no → yes");
  });

  it("gives new cohorts the program's number of sessions, unless the cohort sets its own", async () => {
    const program = (await manager.post("/api/programs", { name: unique("Twelve "), defaultRequiredSessions: 12 })).body;
    const make = async (extra: Record<string, unknown> = {}) =>
      (await manager.post("/api/cohorts", { programId: program.id, name: unique("C "), startDate: isoDaysAgo(0), ...extra })).body;
    expect((await make()).requiredSessions).toBe(12);
    expect((await make({ requiredSessions: 8 })).requiredSessions).toBe(8);

    await manager.patch(`/api/programs/${program.id}`, { defaultRequiredSessions: 10 });
    expect((await make()).requiredSessions).toBe(10);
  });

  it("edits a cohort after it's made, and keeps its dates in order", async () => {
    const c = await cohort();
    const res = await manager.patch(`/api/cohorts/${c.id}`, { requiredSessions: 6, name: "Renamed" });
    expect(res.body).toMatchObject({ requiredSessions: 6, name: "Renamed" });
    expect((await manager.patch(`/api/cohorts/${c.id}`, { endDate: isoDaysAgo(30) })).status).toBe(422);
    // Clearing the number means "no requirement", not zero.
    expect((await manager.patch(`/api/cohorts/${c.id}`, { requiredSessions: null })).body.requiredSessions).toBeNull();
  });

  it("retires a program: it takes no new cohorts until reactivated", async () => {
    const program = (await manager.post("/api/programs", { name: unique("Old ") })).body;
    await manager.patch(`/api/programs/${program.id}`, { active: false });
    const attempt = () => manager.post("/api/cohorts", { programId: program.id, name: "Late", startDate: isoDaysAgo(0) });
    expect((await attempt()).status).toBe(409);
    await manager.patch(`/api/programs/${program.id}`, { active: true });
    expect((await attempt()).status).toBe(201);
  });

  it("is for whoever sets programs up, and won't take a name already in use", async () => {
    const a = (await manager.post("/api/programs", { name: unique("A ") })).body;
    const b = (await manager.post("/api/programs", { name: unique("B ") })).body;
    expect((await chw.patch(`/api/programs/${a.id}`, { excusedCounts: true })).status).toBe(403);
    expect((await manager.patch(`/api/programs/${b.id}`, { name: a.name })).status).toBe(409);
  });
});
