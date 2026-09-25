import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit, contacts } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let director: Client;
let chwId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const d = await staff(db, "clinical_director");
  chwId = (await staff(db, "community_health_worker")).id;
  director = await signIn(app, d.email);
});
afterAll(async () => app?.close());

async function caseWith(results: ("contacted" | "no_contact")[], payer: "medi_cal" | "molina" = "medi_cal") {
  const ids = await admit(db, { workerId: chwId, actorId: chwId, payer });
  await contacts(db, { ...ids, authorId: chwId }, results);
  return ids;
}

const close = (episodeId: string, closureReason: string) =>
  director.post(`/api/episodes/${episodeId}/close`, { closureReason });

describe("M6: disenrolment for no contact is a gate", () => {
  it("refuses at four consecutive misses and says how many more are needed", async () => {
    const { episodeId } = await caseWith(["no_contact", "no_contact", "no_contact", "no_contact"]);
    const res = await close(episodeId, "no_contact");
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/1 more required/);
  });

  it("allows it at five", async () => {
    const { episodeId } = await caseWith(Array(5).fill("no_contact"));
    expect((await close(episodeId, "no_contact")).status).toBe(200);
  });

  it("counts only the run since the last successful contact", async () => {
    const { episodeId } = await caseWith(["no_contact", "no_contact", "no_contact", "contacted", "no_contact", "no_contact"]);
    expect((await close(episodeId, "no_contact")).status).toBe(422);
  });

  it("requires the Molina warning letter before closing a Molina case", async () => {
    const { episodeId } = await caseWith(Array(5).fill("no_contact"), "molina");
    const refused = await close(episodeId, "no_contact");
    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(/Molina/);

    expect((await director.post(`/api/episodes/${episodeId}/disenrollment-letter`)).status).toBe(200);
    expect((await close(episodeId, "no_contact")).status).toBe(200);
  });

  // Blocking other exits would be inventing a rule NMBM never asked for.
  it("doesn't block any other closure reason", async () => {
    const { episodeId } = await caseWith([]);
    expect((await close(episodeId, "completed")).status).toBe(200);
  });

  it("tells the worker where the ladder stands when they log an attempt", async () => {
    const chw = await staff(db, "community_health_worker");
    const ids = await admit(db, { workerId: chw.id, actorId: chw.id });
    await contacts(db, { ...ids, authorId: chw.id }, ["no_contact", "no_contact"]);
    const res = await (await signIn(app, chw.email)).post("/api/notes", {
      ...ids,
      contactResult: "no_contact",
      body: "No answer.",
    });
    expect(res.status).toBe(201);
    expect(res.body.noContact).toMatchObject({ count: 3, warning: true, attemptsUntilDisenrollment: 2 });
  });
});
