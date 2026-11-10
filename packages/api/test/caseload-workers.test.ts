import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { roles, userRoles } from "@nmbm/db";
import { eq } from "drizzle-orm";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, staffWith, admit, unique, isoDaysAgo } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let intake: Client;
let manager: Client;
let chwId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  intake = await signIn(app, (await staff(db, "intake_specialist")).email);
  manager = await signIn(app, (await staff(db, "program_manager")).email);
  chwId = (await staff(db, "community_health_worker")).id;
});
afterAll(async () => app?.close());

const admission = (workerId: string) => ({
  firstName: unique("F"),
  lastName: unique("L"),
  dateOfBirth: "1971-07-07",
  assignedWorkerId: workerId,
  startDate: isoDaysAgo(1),
});

describe("a case goes only to somebody who can work it", () => {
  it("offers only people who can write notes and see clients", async () => {
    const admin = await staff(db, "system_administrator");
    const qa = await staff(db, "quality_assurance_coordinator");
    const intern = await staff(db, "apcc_acsw_intern");
    const director = await staff(db, "clinical_director");
    const ids = ((await intake.get("/api/participants/assignable-workers")).body as { id: string }[]).map((w) => w.id);
    expect(ids).toEqual(expect.arrayContaining([chwId, intern.id, director.id]));
    expect(ids).not.toContain(admin.id);
    expect(ids).not.toContain(qa.id);
  });

  it("refuses admitting, readmitting or reassigning to anyone else", async () => {
    const admin = await staff(db, "system_administrator", "Sam Admin");
    const refused = await intake.post("/api/participants/intake", admission(admin.id));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/Sam Admin can't take a caseload/);

    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    expect((await manager.post(`/api/participants/${participantId}/assignment`, { workerId: admin.id })).status).toBe(409);

    // Seeing clients without writing notes isn't enough, and nor is the reverse.
    const looker = await staffWith(db, ["participants.read.all"]);
    const writer = await staffWith(db, ["notes.write"]);
    expect((await intake.post("/api/participants/intake", admission(looker.id))).status).toBe(409);
    expect((await intake.post("/api/participants/intake", admission(writer.id))).status).toBe(409);
    const both = await staffWith(db, ["notes.write", "participants.read.own"]);
    expect((await intake.post("/api/participants/intake", admission(both.id))).status).toBe(201);
  });

  it("refuses readmission to someone who can't hold a caseload", async () => {
    const director = await signIn(app, (await staff(db, "clinical_director")).email);
    const { participantId, episodeId } = await admit(db, { workerId: chwId, actorId: chwId, startDate: isoDaysAgo(30) });
    expect((await director.post(`/api/episodes/${episodeId}/close`, { closureReason: "completed" })).status).toBe(200);
    const qa = await staff(db, "quality_assurance_coordinator");
    const res = await director.post("/api/episodes", { participantId, startDate: isoDaysAgo(0), assignedWorkerId: qa.id });
    expect(res.status).toBe(409);
  });

  it("doesn't count a role that's been retired", async () => {
    const worker = await staffWith(db, ["notes.write", "participants.read.own"]);
    const [{ roleId }] = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, worker.id));
    await db.update(roles).set({ active: false }).where(eq(roles.id, roleId));
    expect((await intake.post("/api/participants/intake", admission(worker.id))).status).toBe(409);
  });

  it("still lists everyone active as a possible class facilitator", async () => {
    const admin = await staff(db, "system_administrator");
    const ids = ((await manager.get("/api/participants/assignable-workers?for=facilitator")).body as { id: string }[]).map((w) => w.id);
    expect(ids).toContain(admin.id);
  });
});

describe("an id in the address that can't name anything", () => {
  it("is not found, not a server error", async () => {
    const res = await manager.post("/api/notes/not-a-uuid/approve");
    expect(res.status).toBe(404);
    expect((await manager.get("/api/participants/undefined")).status).toBe(404);
  });
});
