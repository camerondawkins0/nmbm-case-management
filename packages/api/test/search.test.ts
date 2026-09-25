import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { participants } from "@nmbm/db";
import { eq } from "drizzle-orm";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit, unique, isoDaysAgo } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let director: Client;
let intake: Client;
let directorId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const d = await staff(db, "clinical_director");
  directorId = d.id;
  director = await signIn(app, d.email);
  intake = await signIn(app, (await staff(db, "intake_specialist")).email);
});
afterAll(async () => app?.close());

// Someone with a known, searchable name.
async function person(workerId: string, first: string, dob = "1970-05-05") {
  const ids = await admit(db, { workerId, actorId: directorId });
  const last = unique("Zz");
  await db.update(participants).set({ firstName: first, lastName: last, dateOfBirth: dob }).where(eq(participants.id, ids.participantId));
  return { ...ids, first, last, dob };
}
const close = (episodeId: string) => director.post(`/api/episodes/${episodeId}/close`, { closureReason: "completed" });
const found = async (as: Client, query: string) =>
  ((await as.get(`/api/participants/search?${query}`)).body as { id: string }[]).map((r) => r.id);

describe("R10 readmission search", () => {
  it("finds a closed record for intake by name or date of birth", async () => {
    const worker = await staff(db, "community_health_worker");
    const p = await person(worker.id, "Imogen", "1961-11-11");
    await close(p.episodeId);
    expect(await found(intake, `q=${p.last}`)).toContain(p.participantId);
    expect(await found(intake, `q=imo%20${p.last.slice(0, 4)}`)).toContain(p.participantId);
    expect(await found(intake, "dob=1961-11-11")).toContain(p.participantId);
  });

  it("doesn't show intake anyone active", async () => {
    const worker = await staff(db, "community_health_worker");
    const p = await person(worker.id, "Active");
    expect(await found(intake, `q=${p.last}`)).not.toContain(p.participantId);
  });

  // A search mustn't be a way to learn who is on someone else's caseload.
  it("shows a worker their own people and not another worker's", async () => {
    const mine = await staff(db, "community_health_worker");
    const theirs = await staff(db, "community_health_worker");
    const a = await person(mine.id, "Mine");
    const b = await person(theirs.id, "Theirs");
    const as = await signIn(app, mine.email);
    expect(await found(as, `q=${a.last}`)).toContain(a.participantId);
    expect(await found(as, `q=${b.last}`)).not.toContain(b.participantId);
  });

  it("shows a read-all role everyone", async () => {
    const worker = await staff(db, "community_health_worker");
    const p = await person(worker.id, "Everyone");
    expect(await found(director, `q=${p.last}`)).toContain(p.participantId);
  });

  it("treats % and _ as letters, not wildcards", async () => {
    expect(await found(director, "q=%25%25")).toEqual([]);
    expect(await found(director, "q=__")).toEqual([]);
  });

  it("needs at least two letters or a date of birth", async () => {
    expect((await director.get("/api/participants/search?q=a")).status).toBe(400);
  });
});

describe("R10 intake refuses a likely duplicate", () => {
  const intakeBody = (first: string, last: string, dob: string, workerId: string, extra = {}) => ({
    firstName: first,
    lastName: last,
    dateOfBirth: dob,
    assignedWorkerId: workerId,
    startDate: isoDaysAgo(0),
    ...extra,
  });

  it("refuses the same name and date of birth, with a code the page can act on", async () => {
    const worker = await staff(db, "community_health_worker");
    const p = await person(worker.id, "Dupe", "1966-06-06");
    await close(p.episodeId);
    const as = await signIn(app, (await staff(db, "intake_specialist")).email);
    const res = await as.post("/api/participants/intake", intakeBody("dupe", p.last.toUpperCase(), "1966-06-06", worker.id));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("possible_duplicate");
  });

  it("catches a changed surname by first name and date of birth", async () => {
    const worker = await staff(db, "community_health_worker");
    const p = await person(worker.id, "Renamed", "1967-07-07");
    const res = await intake.post("/api/participants/intake", intakeBody("Renamed", "Newsurname", "1967-07-07", worker.id));
    expect(res.status).toBe(409);
  });

  it("admits when intake confirms it's a different person, and says so in the audit log", async () => {
    const worker = await staff(db, "community_health_worker");
    const p = await person(worker.id, "Twin", "1968-08-08");
    const res = await intake.post(
      "/api/participants/intake",
      intakeBody("Twin", p.last, "1968-08-08", worker.id, { confirmNotDuplicate: true }),
    );
    expect(res.status).toBe(201);
    const admin = await signIn(app, (await staff(db, "system_administrator")).email);
    const entry = ((await admin.get("/api/admin/audit?limit=50")).body as { entityId: string; detail: string }[]).find(
      (e) => e.entityId === res.body.participant.id,
    );
    expect(entry?.detail).toMatch(/despite 1 record/);
  });

  it("lets a genuinely new person through without asking", async () => {
    const worker = await staff(db, "community_health_worker");
    const res = await intake.post("/api/participants/intake", intakeBody("Brand", unique("New"), "1999-09-09", worker.id));
    expect(res.status).toBe(201);
  });
});
