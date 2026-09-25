import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { startApp, signIn, client } from "./support/app.js";
import { staff, admit } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;

beforeAll(async () => ({ app, db } = await startApp()));
afterAll(async () => app?.close());

describe("authorization is enforced on the server", () => {
  it("refuses an anonymous caller", async () => {
    expect((await client(app).get("/api/participants")).status).toBe(401);
    expect((await client(app).get("/api/dashboard")).status).toBe(401);
  });

  it("refuses a signed-in caller without the permission", async () => {
    const chw = await staff(db, "community_health_worker");
    const as = await signIn(app, chw.email);
    expect((await as.get("/api/admin/users")).status).toBe(403);
    expect((await as.get("/api/notes/awaiting-review")).status).toBe(403);
  });

  // Regression: read.all didn't imply read.own, and the Clinical
  // Director was locked out of the caseload entirely.
  it("lets a read-all role reach the routes that accept either read permission", async () => {
    const director = await staff(db, "clinical_director");
    const as = await signIn(app, director.email);
    expect((await as.get("/api/participants")).status).toBe(200);
    expect((await as.get("/api/dashboard")).status).toBe(200);
  });

  it("keeps a read-only role from writing", async () => {
    const qa = await staff(db, "quality_assurance_coordinator");
    const chw = await staff(db, "community_health_worker");
    const { participantId, episodeId } = await admit(db, { workerId: chw.id, actorId: chw.id });
    const as = await signIn(app, qa.email);
    const res = await as.post("/api/notes", { participantId, episodeId, contactResult: "contacted", body: "x" });
    expect(res.status).toBe(403);
  });
});

describe("U5: a front-line worker sees their own caseload only", () => {
  it("lists only their own participants", async () => {
    const tasha = await staff(db, "community_health_worker");
    const luis = await staff(db, "community_health_worker");
    const mine = await admit(db, { workerId: tasha.id, actorId: tasha.id });
    const theirs = await admit(db, { workerId: luis.id, actorId: luis.id });

    const ids = (await (await signIn(app, tasha.email)).get("/api/participants")).body.map((r: { id: string }) => r.id);
    expect(ids).toContain(mine.participantId);
    expect(ids).not.toContain(theirs.participantId);
  });

  // Confirming an id belongs to someone else's caseload is itself a
  // leak, so the refusal looks exactly like a record that doesn't exist.
  it("answers a guessed id from another caseload as not found", async () => {
    const tasha = await staff(db, "community_health_worker");
    const luis = await staff(db, "community_health_worker");
    const theirs = await admit(db, { workerId: luis.id, actorId: luis.id });
    const as = await signIn(app, tasha.email);

    const guessed = await as.get(`/api/participants/${theirs.participantId}`);
    const missing = await as.get("/api/participants/00000000-0000-0000-0000-000000000000");
    expect(guessed.status).toBe(404);
    expect(guessed.body).toEqual(missing.body);
  });

  it("refuses writes against another worker's participant", async () => {
    const tasha = await staff(db, "community_health_worker");
    const luis = await staff(db, "community_health_worker");
    const theirs = await admit(db, { workerId: luis.id, actorId: luis.id });
    const as = await signIn(app, tasha.email);
    const res = await as.post("/api/notes", { ...theirs, contactResult: "contacted", body: "x" });
    expect(res.status).toBe(403);
  });
});
