import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { auditLog, episodes, housingDeposits } from "@nmbm/db";
import { and, eq } from "drizzle-orm";
import { authorizationState, unitsUsed, type CsService } from "@nmbm/shared";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit, orgDaysAgo, unique } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let director: Client;
let directorId: string;
let chw: Client;
let chwId: string;
let billing: Client;
let admin: Client;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const d = await staff(db, "clinical_director");
  directorId = d.id;
  director = await signIn(app, d.email);
  const c = await staff(db, "community_health_worker");
  chwId = c.id;
  chw = await signIn(app, c.email);
  billing = await signIn(app, (await staff(db, "billing_coordinator")).email);
  admin = await signIn(app, (await staff(db, "system_administrator")).email);
});
afterAll(async () => app?.close());

type Ids = { participantId: string; episodeId: string };
const client = () => admit(db, { workerId: chwId, actorId: directorId, startDate: orgDaysAgo(60) });

async function requested(p: Ids, service: CsService, as: Client = director) {
  const res = await as.post(`/api/participants/${p.participantId}/cs-authorizations`, { service, requestedDate: orgDaysAgo(20), plan: "kaiser" });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function approved(p: Ids, service: CsService, extra: Record<string, unknown> = {}) {
  const id = await requested(p, service);
  const res = await director.post(`/api/cs-authorizations/${id}/decision`, {
    decision: "approved",
    decisionDate: orgDaysAgo(15),
    authorizationNumber: unique("ILS-"),
    startDate: orgDaysAgo(15),
    endDate: orgDaysAgo(-90),
    ...(service === "housing_deposits" ? { amountAuthorized: "2000.00" } : {}),
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return id;
}

const logWork = (p: Ids, authorizationId: string, extra: Record<string, unknown> = {}, as: Client = chw) =>
  as.post(`/api/participants/${p.participantId}/housing-services`, {
    authorizationId,
    serviceDate: orgDaysAgo(2),
    minutes: 50,
    activity: "housing_search",
    contactMethod: "in_person",
    note: "Viewed two units.",
    ...extra,
  });

const housing = async (p: Ids, as: Client = chw) => (await as.get(`/api/participants/${p.participantId}/housing`)).body;

describe("what an authorization's state is, derived", () => {
  const a = { status: "approved" as const, startDate: "2026-01-01", endDate: "2026-03-31", endedDate: null };
  it("knows upcoming, active, expiring, expired and ended", () => {
    expect(authorizationState(a, "2025-12-31", 30)).toBe("upcoming");
    expect(authorizationState(a, "2026-02-01", 30)).toBe("active");
    expect(authorizationState(a, "2026-03-01", 30)).toBe("expiring");
    expect(authorizationState(a, "2026-04-01", 30)).toBe("expired");
    // The day it was ended on is the last day it covers.
    expect(authorizationState({ ...a, endedDate: "2026-02-10" }, "2026-02-10", 30)).toBe("active");
    expect(authorizationState({ ...a, endedDate: "2026-02-10" }, "2026-02-11", 30)).toBe("ended");
    expect(authorizationState({ ...a, status: "requested" }, "2026-02-01", 30)).toBe("requested");
  });

  it("counts units the way they're billed", () => {
    const work = [
      { serviceDate: "2026-01-02", minutes: 20 },
      { serviceDate: "2026-01-02", minutes: 50 },
      { serviceDate: "2026-02-10", minutes: 15 },
    ];
    expect(unitsUsed("fifteen_minutes", work)).toBe(2 + 4 + 1);
    expect(unitsUsed("hour", work)).toBe(1.42);
    expect(unitsUsed("visit", work)).toBe(3);
    expect(unitsUsed("day", work)).toBe(2);
    expect(unitsUsed("month", work)).toBe(2);
  });
});

describe("authorizations are asked for, then decided", () => {
  it("are recorded by whoever handles authorizations, on an open stay", async () => {
    const p = await client();
    expect((await chw.post(`/api/participants/${p.participantId}/cs-authorizations`, { service: "housing_deposits", requestedDate: orgDaysAgo(1) })).status).toBe(403);
    await requested(p, "housing_transition_navigation", billing);
    const future = await director.post(`/api/participants/${p.participantId}/cs-authorizations`, { service: "housing_deposits", requestedDate: orgDaysAgo(-3) });
    expect(future.status).toBe(422);
  });

  it("approves with a number and a period; deposits as money, time services in units", async () => {
    const p = await client();
    const htns = await requested(p, "housing_transition_navigation");
    const base = { decision: "approved", decisionDate: orgDaysAgo(10), authorizationNumber: "A1", startDate: orgDaysAgo(10), endDate: orgDaysAgo(-30) };
    expect((await director.post(`/api/cs-authorizations/${htns}/decision`, { ...base, authorizationNumber: undefined })).status).toBe(400);
    expect((await director.post(`/api/cs-authorizations/${htns}/decision`, { ...base, amountAuthorized: "100" })).status).toBe(422);
    expect((await director.post(`/api/cs-authorizations/${htns}/decision`, { ...base, unitsAuthorized: 40 })).status).toBe(422);
    expect((await director.post(`/api/cs-authorizations/${htns}/decision`, { ...base, endDate: orgDaysAgo(20) })).status).toBe(422);
    expect((await director.post(`/api/cs-authorizations/${htns}/decision`, { ...base, decisionDate: orgDaysAgo(30) })).status).toBe(422);
    const ok = await director.post(`/api/cs-authorizations/${htns}/decision`, { ...base, unitType: "fifteen_minutes", unitsAuthorized: 40 });
    expect(ok.status).toBe(200);
    expect((await director.post(`/api/cs-authorizations/${htns}/decision`, { ...base })).status).toBe(409);

    const deposits = await requested(p, "housing_deposits");
    expect((await director.post(`/api/cs-authorizations/${deposits}/decision`, base)).status).toBe(422);
    expect((await director.post(`/api/cs-authorizations/${deposits}/decision`, { ...base, amountAuthorized: "500", unitType: "visit", unitsAuthorized: 2 })).status).toBe(422);
    const money = await director.post(`/api/cs-authorizations/${deposits}/decision`, { ...base, amountAuthorized: "1500.5" });
    expect(money.body.amountAuthorized).toBe("1500.50");
  });

  it("records a denial with its reason", async () => {
    const p = await client();
    const id = await requested(p, "housing_tenancy_sustaining");
    expect((await director.post(`/api/cs-authorizations/${id}/decision`, { decision: "denied", decisionDate: orgDaysAgo(1) })).status).toBe(400);
    expect((await director.post(`/api/cs-authorizations/${id}/decision`, { decision: "denied", decisionDate: orgDaysAgo(1), note: "Not eligible" })).status).toBe(200);
    expect((await housing(p)).authorizations[0]).toMatchObject({ status: "denied", state: "denied", decidedByName: expect.any(String) });
  });

  it("flags one ending within the configured window", async () => {
    const p = await client();
    const id = await approved(p, "housing_transition_navigation", { endDate: orgDaysAgo(-20) });
    expect((await housing(p)).authorizations.find((a: { id: string }) => a.id === id).state).toBe("expiring");
    expect((await admin.put("/api/admin/settings/cs_authorization_warning_days", { value: 10 })).status).toBe(200);
    try {
      expect((await housing(p)).authorizations.find((a: { id: string }) => a.id === id).state).toBe("active");
      expect(((await chw.get("/api/housing/overview")).body.expiring as { id: string }[]).map((a) => a.id)).not.toContain(id);
    } finally {
      expect((await admin.put("/api/admin/settings/cs_authorization_warning_days", { value: 30 })).status).toBe(200);
    }
    expect(((await chw.get("/api/housing/overview")).body.expiring as { id: string }[]).map((a) => a.id)).toContain(id);
  });
});

describe("housing work is logged against an authorization that covers it", () => {
  it("takes work inside an approved time authorization, and counts it", async () => {
    const p = await client();
    const id = await approved(p, "housing_transition_navigation", { unitType: "fifteen_minutes", unitsAuthorized: 8 });
    const res = await logWork(p, id);
    expect(res.status).toBe(201);
    expect(res.body.overAuthorized).toBe(false);
    const auth = (await housing(p)).authorizations.find((a: { id: string }) => a.id === id);
    expect(auth).toMatchObject({ minutesLogged: 50, unitsUsed: 4, overAuthorized: false });
  });

  it("still logs work past the authorized units, and says so", async () => {
    const p = await client();
    const id = await approved(p, "housing_tenancy_sustaining", { unitType: "visit", unitsAuthorized: 1 });
    expect((await logWork(p, id)).body.overAuthorized).toBe(false);
    const over = await logWork(p, id, { serviceDate: orgDaysAgo(1) });
    expect(over.status).toBe(201);
    expect(over.body.overAuthorized).toBe(true);
  });

  it("refuses an authorization that isn't approved, isn't for time, isn't theirs, or doesn't cover the day", async () => {
    const p = await client();
    const other = await client();
    const pending = await requested(p, "housing_transition_navigation");
    const deposits = await approved(p, "housing_deposits");
    const good = await approved(p, "housing_transition_navigation");
    const theirs = await approved(other, "housing_transition_navigation");
    expect((await logWork(p, pending)).status).toBe(422);
    expect((await logWork(p, deposits)).status).toBe(422);
    const crossed = await logWork(p, theirs);
    expect(crossed.status).toBe(422);
    expect(crossed.body.message).toBe("Choose one of this client's authorizations");
    expect((await logWork(p, good, { serviceDate: orgDaysAgo(30) })).status).toBe(422);
    expect((await logWork(p, good, { serviceDate: orgDaysAgo(-1) })).status).toBe(422);
    expect((await logWork(p, good, { minutes: 0 })).status).toBe(400);
    expect((await logWork(p, good)).status).toBe(201);
  });

  it("refuses work against an earlier stay's authorization after a readmission", async () => {
    const p = await client();
    const id = await approved(p, "housing_transition_navigation");
    expect((await director.post(`/api/episodes/${p.episodeId}/close`, { closureReason: "completed" })).status).toBe(200);
    // Somebody who can still write on a closed record is told why.
    expect((await logWork(p, id, {}, director)).status).toBe(409);
    // Closing still dates a case by UTC (a known server bug), so from 4pm
    // in Long Beach a stay closed today ends "tomorrow" and nothing can be
    // readmitted or logged on Long Beach's today. This test is about housing,
    // so it sets the end date itself and works at any hour. The exact message
    // matters: in the evening this used to pass on "can't be in the future".
    await db.update(episodes).set({ endDate: orgDaysAgo(1) }).where(eq(episodes.id, p.episodeId));
    expect((await director.post("/api/episodes", { participantId: p.participantId, startDate: orgDaysAgo(0), assignedWorkerId: chwId })).status).toBe(201);
    const refused = await logWork(p, id, { serviceDate: orgDaysAgo(0) });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toBe("That authorization was for an earlier stay");
  });

  it("ends an authorization early, and nothing goes on it after", async () => {
    const p = await client();
    const id = await approved(p, "housing_transition_navigation");
    expect((await logWork(p, id, { serviceDate: orgDaysAgo(2) })).status).toBe(201);
    const tooEarly = await director.post(`/api/cs-authorizations/${id}/end`, { endedDate: orgDaysAgo(5), reason: "Moved away" });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.message).toMatch(/1 service\(s\) are logged after/);
    expect((await director.post(`/api/cs-authorizations/${id}/end`, { endedDate: orgDaysAgo(2), reason: "Moved away" })).status).toBe(200);
    expect((await logWork(p, id, { serviceDate: orgDaysAgo(1) })).status).toBe(422);
    expect((await housing(p)).authorizations.find((a: { id: string }) => a.id === id).state).toBe("ended");
  });

  it("voids an authorization only once nothing is recorded against it", async () => {
    const p = await client();
    const id = await approved(p, "housing_transition_navigation");
    const work = (await logWork(p, id)).body.service.id;
    expect((await director.post(`/api/cs-authorizations/${id}/void`, { reason: "Entered twice" })).status).toBe(409);
    expect((await chw.post(`/api/housing-services/${work}/void`, { reason: "Wrong client" })).status).toBe(200);
    expect((await director.post(`/api/cs-authorizations/${id}/void`, { reason: "Entered twice" })).status).toBe(200);
    const after = await housing(p);
    expect(after.authorizations[0].state).toBe("void");
    expect(after.services[0].voidReason).toBe("Wrong client");
  });
});

describe("housing situation and tenancies", () => {
  it("keeps a history, the latest by date current, and a void falls back", async () => {
    const p = await client();
    const post = (situation: string, effectiveDate: string) =>
      chw.post(`/api/participants/${p.participantId}/housing-statuses`, { situation, effectiveDate });
    expect((await post("unsheltered", orgDaysAgo(30))).status).toBe(201);
    const later = (await post("emergency_shelter", orgDaysAgo(10))).body.id;
    // Entered late, but earlier in time: not current.
    expect((await post("temporarily_with_others", orgDaysAgo(20))).status).toBe(201);
    expect((await post("unsheltered", orgDaysAgo(-1))).status).toBe(422);
    expect((await housing(p)).current.situation).toBe("emergency_shelter");
    await chw.post(`/api/housing-statuses/${later}/void`, { reason: "Wrong date" });
    expect((await housing(p)).current.situation).toBe("temporarily_with_others");
  });

  it("records a move-in as a tenancy and a housing situation, one home at a time", async () => {
    const p = await client();
    const home = { moveInDate: orgDaysAgo(5), addressLine1: "10 Pine Ave", city: "Long Beach", state: "ca", postalCode: "90802", subsidy: "housing_choice_voucher", monthlyRent: "1650", tenantPortion: "495.00" };
    const first = await chw.post(`/api/participants/${p.participantId}/tenancies`, home);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ state: "CA", monthlyRent: "1650.00", tenantPortion: "495.00" });
    const h = await housing(p);
    expect(h.current).toMatchObject({ situation: "permanent_subsidized", effectiveDate: orgDaysAgo(5) });

    expect((await chw.post(`/api/participants/${p.participantId}/tenancies`, { ...home, addressLine1: "20 Elm" })).status).toBe(409);
    expect((await chw.post(`/api/tenancies/${first.body.id}/move-out`, { moveOutDate: orgDaysAgo(6), reason: "x" })).status).toBe(422);
    expect((await chw.post(`/api/tenancies/${first.body.id}/move-out`, { moveOutDate: orgDaysAgo(1), reason: "Moved to family" })).status).toBe(200);
    expect((await chw.post(`/api/participants/${p.participantId}/tenancies`, { ...home, moveInDate: orgDaysAgo(1), addressLine1: "20 Elm" })).status).toBe(201);
  });
});

describe("deposits are asked for, decided by somebody else, then paid", () => {
  const ask = (p: Ids, authorizationId: string, amount: string, as: Client = chw) =>
    as.post(`/api/participants/${p.participantId}/housing-deposits`, { authorizationId, purpose: "security_deposit", payee: "Pine Ave Apartments", amount });

  it("only against a Housing Deposits authorization, and never past what it allows", async () => {
    const p = await client();
    const htns = await approved(p, "housing_transition_navigation");
    const id = await approved(p, "housing_deposits", { amountAuthorized: "1000.00" });
    const wrongKind = await ask(p, htns, "100");
    expect(wrongKind.status).toBe(422);
    expect(wrongKind.body.message).toMatch(/against a Housing Deposits authorization/);
    expect((await ask(p, id, "600.50")).status).toBe(201);
    const over = await ask(p, id, "400");
    expect(over.status).toBe(422);
    expect(over.body.message).toContain("$399.50");
    expect((await ask(p, id, "399.50")).status).toBe(201);
    expect((await ask(p, id, "0")).status).toBe(400);
    expect((await ask(p, id, "12.345")).status).toBe(400);
  });

  it("doesn't let two requests at once both fit in what's left", async () => {
    const p = await client();
    const id = await approved(p, "housing_deposits", { amountAuthorized: "1000.00" });
    const both = await Promise.all([ask(p, id, "700"), ask(p, id, "700")]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 422]);
  });

  it("is decided by somebody other than who asked, then paid, and a declined one frees its amount", async () => {
    const p = await client();
    const id = await approved(p, "housing_deposits", { amountAuthorized: "1000.00" });
    const own = (await ask(p, id, "300", director)).body.id;
    expect((await director.post(`/api/housing-deposits/${own}/decision`, { decision: "approved" })).status).toBe(409);
    expect((await chw.post(`/api/housing-deposits/${own}/decision`, { decision: "approved" })).status).toBe(403);
    expect((await billing.post(`/api/housing-deposits/${own}/decision`, { decision: "declined", note: "Use the other quote" })).status).toBe(200);

    const dep = (await ask(p, id, "1000")).body.id;
    expect((await billing.post(`/api/housing-deposits/${dep}/paid`, { paidDate: orgDaysAgo(0), paymentReference: "CHK-1" })).status).toBe(409);
    expect((await billing.post(`/api/housing-deposits/${dep}/decision`, { decision: "approved" })).status).toBe(200);
    expect((await billing.post(`/api/housing-deposits/${dep}/paid`, { paidDate: orgDaysAgo(3), paymentReference: "CHK-1" })).status).toBe(422);
    expect((await billing.post(`/api/housing-deposits/${dep}/paid`, { paidDate: orgDaysAgo(0), paymentReference: "CHK-1" })).status).toBe(200);
    const auth = (await housing(p)).authorizations.find((a: { id: string }) => a.id === id);
    expect(auth).toMatchObject({ amountCommitted: "1000.00", amountPaid: "1000.00" });
  });

  it("voids an unpaid request — the asker while it's only asked for, an approver after — never a paid one", async () => {
    const p = await client();
    const id = await approved(p, "housing_deposits", { amountAuthorized: "1000.00" });
    const a = (await ask(p, id, "100")).body.id;
    expect((await chw.post(`/api/housing-deposits/${a}/void`, { reason: "Duplicate" })).status).toBe(200);
    const b = (await ask(p, id, "100")).body.id;
    await billing.post(`/api/housing-deposits/${b}/decision`, { decision: "approved" });
    expect((await chw.post(`/api/housing-deposits/${b}/void`, { reason: "x" })).status).toBe(409);
    await billing.post(`/api/housing-deposits/${b}/paid`, { paidDate: orgDaysAgo(0), paymentReference: "CHK-2" });
    expect((await billing.post(`/api/housing-deposits/${b}/void`, { reason: "x" })).status).toBe(409);
    const [row] = await db.select().from(housingDeposits).where(eq(housingDeposits.id, b));
    expect(row).toMatchObject({ status: "paid", voidedAt: null, amount: "100.00" });
  });
});

describe("across the caseload", () => {
  it("shows what needs doing for the clients the caller can see, and no one else's", async () => {
    const p = await client();
    const waiting = await requested(p, "housing_transition_navigation");
    const deposits = await approved(p, "housing_deposits");
    const dep = (await chw.post(`/api/participants/${p.participantId}/housing-deposits`, { authorizationId: deposits, purpose: "moving_costs", payee: "Movers", amount: "250" })).body.id;
    const mine = (await chw.get("/api/housing/overview")).body;
    expect(mine.awaitingDecision.map((a: { id: string }) => a.id)).toContain(waiting);
    expect(mine.depositsAwaitingDecision.map((d: { id: string }) => d.id)).toContain(dep);
    expect(mine.noSituation.map((n: { participantId: string }) => n.participantId)).toContain(p.participantId);

    const stranger = await signIn(app, (await staff(db, "community_health_worker")).email);
    const theirs = (await stranger.get("/api/housing/overview")).body;
    expect(theirs.awaitingDecision.map((a: { id: string }) => a.id)).not.toContain(waiting);
    expect(theirs.depositsAwaitingDecision.map((d: { id: string }) => d.id)).not.toContain(dep);
  });

  it("exports the service log for a period: by permission, scoped, safe in a spreadsheet, and audited", async () => {
    const p = await admit(db, { workerId: chwId, actorId: directorId, startDate: orgDaysAgo(60) });
    // A name a spreadsheet would run as a formula.
    await director.patch(`/api/participants/${p.participantId}/details`, { mediCalCin: "91234567Q" });
    const { participants } = await import("@nmbm/db");
    await db.update(participants).set({ firstName: "=HYPERLINK(\"x\")" }).where(eq(participants.id, p.participantId));
    const id = await approved(p, "housing_transition_navigation");
    await logWork(p, id, { serviceDate: orgDaysAgo(3) });

    const range = { from: orgDaysAgo(4), to: orgDaysAgo(0) };
    expect((await chw.post("/api/housing/service-export", range)).status).toBe(403);
    expect((await billing.post("/api/housing/service-export", { from: orgDaysAgo(0), to: orgDaysAgo(4) })).status).toBe(400);
    const res = await app.inject({ method: "POST", url: "/api/housing/service-export", payload: range, headers: { cookie: billing.cookie! } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.body.split("\r\n");
    expect(lines[0]).toBe("Date of service,Last name,First name,Date of birth,Medi-Cal CIN,Plan,Authorization number,Service,Activity,Contact method,Minutes,Staff");
    const row = lines.find((l) => l.includes("91234567Q"))!;
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain(",Kaiser,");
    expect(row).toContain("Housing Transition Navigation,Housing search,In person,50");
    expect(res.body).not.toContain("Viewed two units");

    const empty = await app.inject({ method: "POST", url: "/api/housing/service-export", payload: { from: "2001-01-01", to: "2001-01-31" }, headers: { cookie: billing.cookie! } });
    expect(empty.body.split("\r\n")).toHaveLength(1);
    const lines2 = await db.select().from(auditLog).where(and(eq(auditLog.action, "housing.services_exported")));
    expect(lines2.some((l) => l.detail === `${range.from} to ${range.to}, ${lines.length - 1} rows`)).toBe(true);
  });

  it("is part of the whole-record export", async () => {
    const p = await client();
    await approved(p, "housing_transition_navigation");
    await chw.post(`/api/participants/${p.participantId}/housing-statuses`, { situation: "emergency_shelter", effectiveDate: orgDaysAgo(3) });
    const doc = (await director.post(`/api/participants/${p.participantId}/record-export`, { purpose: "participant_request" })).body;
    expect(doc.housing.current.situation).toBe("emergency_shelter");
    expect(doc.housing.authorizations).toHaveLength(1);
  });
});
