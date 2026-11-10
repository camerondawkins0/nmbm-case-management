import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { todayInOrg } from "@nmbm/shared";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit, isoDaysAgo } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let chw: Client;
let chwId: string;
let manager: Client;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const worker = await staff(db, "community_health_worker");
  chwId = worker.id;
  chw = await signIn(app, worker.email);
  manager = await signIn(app, (await staff(db, "program_manager")).email);
});
afterAll(async () => app?.close());

const stay = () => admit(db, { workerId: chwId, actorId: chwId, startDate: isoDaysAgo(20) });
const note = (ids: { participantId: string; episodeId: string }, contactResult: "contacted" | "no_contact", serviceDate?: string) =>
  chw.post("/api/notes", { ...ids, contactResult, body: `${contactResult} ${serviceDate ?? ""}`, ...(serviceDate ? { serviceDate } : {}) });

describe("a note records the day the contact happened", () => {
  it("is today in Long Beach unless said otherwise, even when it's already tomorrow in UTC", () => {
    // 9pm Pacific on November 9 is 5am UTC on November 10.
    expect(todayInOrg(new Date("2026-11-10T05:00:00Z"))).toBe("2026-11-09");
    expect(todayInOrg(new Date("2026-07-01T06:59:00Z"))).toBe("2026-06-30");
  });

  it("defaults to today, takes an earlier day in the stay, and lists newest contact first", async () => {
    const ids = await stay();
    const today = await note(ids, "contacted");
    expect(today.body.note.serviceDate).toBe(todayInOrg());
    const earlier = await note(ids, "contacted", isoDaysAgo(5));
    expect(earlier.status).toBe(201);
    expect(earlier.body.note.serviceDate).toBe(isoDaysAgo(5));
    const notes = (await chw.get(`/api/participants/${ids.participantId}`)).body.notes as { serviceDate: string }[];
    expect(notes.map((n) => n.serviceDate)).toEqual([todayInOrg(), isoDaysAgo(5)]);
  });

  it("can't be in the future, or before the stay began", async () => {
    const ids = await stay();
    const future = await note(ids, "contacted", "2999-01-01");
    expect(future.status).toBe(422);
    expect(future.body.message).toMatch(/future/);
    const before = await note(ids, "contacted", isoDaysAgo(30));
    expect(before.status).toBe(422);
    expect(before.body.message).toMatch(/before this stay began/);
  });

  it("can be corrected when the note comes back for revision, within the same limits", async () => {
    const ids = await stay();
    const { id } = (await note(ids, "contacted")).body.note;
    await manager.post(`/api/notes/${id}/return`, { reviewNote: "This was Tuesday's visit." });
    expect((await chw.patch(`/api/notes/${id}`, { body: "Visit.", serviceDate: "2999-01-01" })).status).toBe(422);
    const fixed = await chw.patch(`/api/notes/${id}`, { body: "Visit.", serviceDate: isoDaysAgo(2) });
    expect(fixed.status).toBe(200);
    expect(fixed.body.serviceDate).toBe(isoDaysAgo(2));
  });
});

describe("M6 counts attempts in the order they happened, not the order they were typed", () => {
  const count = async (participantId: string) =>
    (await chw.get(`/api/participants/${participantId}`)).body.consecutiveNoContacts as number;

  it("isn't reset by a contact written up late that came before the missed attempts", async () => {
    const ids = await stay();
    await note(ids, "no_contact", isoDaysAgo(3));
    await note(ids, "no_contact", isoDaysAgo(2));
    // Logged now, but it happened before both misses.
    await note(ids, "contacted", isoDaysAgo(6));
    expect(await count(ids.participantId)).toBe(2);
  });

  it("doesn't count a missed attempt written up late that came before the last contact", async () => {
    const ids = await stay();
    await note(ids, "contacted", isoDaysAgo(2));
    await note(ids, "no_contact", isoDaysAgo(4));
    expect(await count(ids.participantId)).toBe(0);
    await note(ids, "no_contact", isoDaysAgo(1));
    expect(await count(ids.participantId)).toBe(1);
  });

  it("measures from the latest contact by date, not the latest one written", async () => {
    const ids = await stay();
    await note(ids, "contacted", isoDaysAgo(1));
    await note(ids, "no_contact", isoDaysAgo(3));
    // An older contact, written up last, doesn't bring the miss back.
    await note(ids, "contacted", isoDaysAgo(6));
    expect(await count(ids.participantId)).toBe(0);
  });

  it("orders attempts on the same day by when they were written", async () => {
    const ids = await stay();
    await note(ids, "no_contact", isoDaysAgo(1));
    await note(ids, "contacted", isoDaysAgo(1));
    await note(ids, "no_contact", isoDaysAgo(1));
    expect(await count(ids.participantId)).toBe(1);
  });

  it("measures from the latest contact by date, not the latest one written", async () => {
    const ids = await stay();
    await note(ids, "contacted", isoDaysAgo(1));
    await note(ids, "no_contact", isoDaysAgo(3));
    // An older contact, written up last, doesn't bring the miss back.
    await note(ids, "contacted", isoDaysAgo(6));
    expect(await count(ids.participantId)).toBe(0);
  });
});
