import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit, unique, isoDaysAgo } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let director: Client;
let directorId: string;
let directorName: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const d = await staff(db, "clinical_director", "Director For Attendance");
  directorId = d.id;
  directorName = d.displayName;
  director = await signIn(app, d.email);
});
afterAll(async () => app?.close());

// A running class with one session and two people on the roster.
async function classOfTwo() {
  const program = await director.post("/api/programs", { name: unique("Programme ") });
  const cohort = await director.post("/api/cohorts", {
    programId: program.body.id,
    name: unique("Cohort "),
    startDate: isoDaysAgo(14),
    requiredSessions: 12,
  });
  const session = await director.post(`/api/cohorts/${cohort.body.id}/sessions`, { sessionDate: isoDaysAgo(7) });
  const worker = await staff(db, "community_health_worker");
  const people = [await admit(db, { workerId: worker.id, actorId: directorId }), await admit(db, { workerId: worker.id, actorId: directorId })];
  const enrollments = [];
  for (const p of people) {
    const res = await director.post(`/api/cohorts/${cohort.body.id}/enrollments`, { participantId: p.participantId });
    expect(res.status).toBe(201);
    enrollments.push(res.body.id as string);
  }
  return { cohortId: cohort.body.id as string, sessionId: session.body.id as string, people, enrollments };
}

describe("M14: attendance is evidence", () => {
  it("marks a whole roster in one request", async () => {
    const c = await classOfTwo();
    const res = await director.post(`/api/sessions/${c.sessionId}/attendance`, {
      marks: [
        { enrollmentId: c.enrollments[0], status: "present" },
        { enrollmentId: c.enrollments[1], status: "excused" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.marked).toBe(2);
  });

  it("corrects a mark rather than adding a second one", async () => {
    const c = await classOfTwo();
    const mark = (status: string) =>
      director.post(`/api/sessions/${c.sessionId}/attendance`, { marks: [{ enrollmentId: c.enrollments[0], status }] });
    await mark("absent");
    await mark("present");
    const cohort = await director.get(`/api/cohorts/${c.cohortId}`);
    const theirs = cohort.body.marks.filter((m: { enrollmentId: string }) => m.enrollmentId === c.enrollments[0]);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].status).toBe("present");
  });

  it("refuses marks for anyone not on this roster", async () => {
    const c = await classOfTwo();
    const other = await classOfTwo();
    const res = await director.post(`/api/sessions/${c.sessionId}/attendance`, {
      marks: [{ enrollmentId: other.enrollments[0], status: "present" }],
    });
    expect(res.status).toBe(400);
  });

  it("names who recorded each mark on the participation record", async () => {
    const c = await classOfTwo();
    await director.post(`/api/sessions/${c.sessionId}/attendance`, { marks: [{ enrollmentId: c.enrollments[0], status: "present" }] });
    const record = await director.get(`/api/enrollments/${c.enrollments[0]}/participation`);
    expect(record.status).toBe(200);
    expect(record.body.sessions[0].recordedByName).toBe(directorName);
    expect(record.body.outcome).toBe("in_progress");
  });

  it("keeps a withdrawn person's past marks", async () => {
    const c = await classOfTwo();
    await director.post(`/api/sessions/${c.sessionId}/attendance`, { marks: [{ enrollmentId: c.enrollments[0], status: "present" }] });
    expect((await director.post(`/api/enrollments/${c.enrollments[0]}/withdraw`, { reason: "Moved" })).status).toBe(200);
    const record = await director.get(`/api/enrollments/${c.enrollments[0]}/participation`);
    expect(record.body.attended).toBe(1);
  });
});

describe("R10 on the roster: disenrolment flags, never withdraws", () => {
  it("keeps the person enrolled, flags the date services ended, and still takes marks", async () => {
    const c = await classOfTwo();
    await director.post(`/api/episodes/${c.people[0].episodeId}/close`, { closureReason: "completed" });

    const roster = (await director.get(`/api/cohorts/${c.cohortId}`)).body.roster;
    const closed = roster.find((r: { enrollmentId: string }) => r.enrollmentId === c.enrollments[0]);
    const open = roster.find((r: { enrollmentId: string }) => r.enrollmentId === c.enrollments[1]);
    expect(closed.status).toBe("enrolled");
    expect(closed.servicesEndedOn).toBe(isoDaysAgo(0));
    expect(open.servicesEndedOn).toBeNull();

    const res = await director.post(`/api/sessions/${c.sessionId}/attendance`, {
      marks: [{ enrollmentId: c.enrollments[0], status: "present" }],
    });
    expect(res.status).toBe(200);
  });
});
