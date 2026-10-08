import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { assessmentLinks, auditLog } from "@nmbm/db";
import { and, eq } from "drizzle-orm";
import type { FormQuestionInput } from "@nmbm/shared";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let director: Client;
let directorId: string;
let chw: Client;
let chwId: string;
let admin: Client;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const d = await staff(db, "clinical_director");
  directorId = d.id;
  director = await signIn(app, d.email);
  const w = await staff(db, "community_health_worker");
  chwId = w.id;
  chw = await signIn(app, w.email);
  admin = await signIn(app, (await staff(db, "system_administrator")).email);
});
afterAll(async () => app?.close());

const ids = { housed: randomUUID(), where: randomUUID() };
const questions: FormQuestionInput[] = [
  { stableId: ids.housed, type: "yes_no", prompt: "Do you have stable housing?", required: true, options: [] },
  {
    stableId: ids.where,
    type: "short_text",
    prompt: "Where are you staying?",
    required: true,
    options: [],
    showIf: { mode: "all", conditions: [{ questionId: ids.housed, op: "eq", value: "no" }] },
  },
];

let formId: string;
beforeAll(async () => {
  const form = (await director.post("/api/assessment-forms", { name: `Self ${randomUUID().slice(0, 6)}` })).body;
  await director.put(`/api/assessment-versions/${form.draftVersionId}/questions`, { questions });
  await director.post(`/api/assessment-versions/${form.draftVersionId}/publish`);
  formId = form.id;
});

type Sent = { assessmentId: string; token: string; passcode: string; expiresAt: string };

async function sent(as: Client = chw, workerId = chwId) {
  const { participantId, episodeId } = await admit(db, { workerId, actorId: directorId });
  const res = await as.post(`/api/participants/${participantId}/assessment-links`, { formId });
  expect(res.status).toBe(201);
  return { participantId, episodeId, ...(res.body as Sent) };
}

// A participant's browser: no staff session, its own cookie for the
// one path the passcode unlocks.
function participant(token: string) {
  let cookie: string | undefined;
  const call = async (method: "GET" | "POST" | "PATCH", path: string, payload?: unknown) => {
    const res = await app.inject({
      method,
      url: `/api/self-serve/${token}${path}`,
      payload: payload as never,
      headers: cookie ? { cookie } : {},
    });
    const set = [res.headers["set-cookie"]].flat().find((c) => c?.startsWith("nmbm_form="));
    if (set) cookie = set.split(";")[0];
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, setCookie: set };
  };
  return {
    unlock: (passcode: string) => call("POST", "/unlock", { passcode }),
    view: () => call("GET", ""),
    save: (answers: Record<string, unknown>) => call("PATCH", "/answers", { answers }),
    submit: () => call("POST", "/submit"),
    get cookie() {
      return cookie;
    },
    set cookie(value: string | undefined) {
      cookie = value;
    },
  };
}

const wrong = (passcode: string) => (passcode === "000000" ? "111111" : "000000");

describe("sending a form to a participant", () => {
  it("gives the case manager a link and passcode, and keeps neither", async () => {
    const s = await sent();
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.passcode).toMatch(/^\d{6}$/);

    const [row] = await db.select().from(assessmentLinks).where(eq(assessmentLinks.assessmentId, s.assessmentId));
    expect(JSON.stringify(row)).not.toContain(s.token);
    expect(JSON.stringify(row)).not.toContain(s.passcode);

    const list = (await chw.get(`/api/participants/${s.participantId}/assessments`)).body;
    expect(list[0]).toMatchObject({ mode: "self", status: "in_progress", link: { state: "live", openedAt: null } });
  });

  it("isn't for a participant outside the case manager's caseload", async () => {
    const other = await staff(db, "community_health_worker");
    const { participantId } = await admit(db, { workerId: other.id, actorId: directorId });
    expect((await chw.post(`/api/participants/${participantId}/assessment-links`, { formId })).status).toBe(404);
  });
});

describe("the participant's side", () => {
  it("shows nothing until the passcode is entered, then the form and nothing about the person", async () => {
    const s = await sent();
    const p = participant(s.token);
    expect((await p.view()).status).toBe(401);

    const bad = await p.unlock(wrong(s.passcode));
    expect(bad.status).toBe(401);
    expect(bad.body.message).toMatch(/4 tries left/);

    const ok = await p.unlock(s.passcode);
    expect(ok.status).toBe(200);
    expect(ok.setCookie).toMatch(new RegExp(`Path=/api/self-serve/${s.token}`));
    expect(ok.setCookie).toMatch(/HttpOnly/);
    expect(ok.setCookie).toMatch(/SameSite=Strict/);

    const view = await p.view();
    expect(view.status).toBe(200);
    expect(Object.keys(view.body).sort()).toEqual(["answers", "formName", "questions"]);
    expect(JSON.stringify(view.body)).not.toContain(s.participantId);
    expect(JSON.stringify(view.body)).not.toContain(s.episodeId);
  });

  it("doesn't let one link's cookie open another link", async () => {
    const a = await sent();
    const b = await sent();
    const pa = participant(a.token);
    await pa.unlock(a.passcode);
    // B is open in its owner's browser, so it's the cookie that has to
    // be refused here — not the link for never having been unlocked.
    await participant(b.token).unlock(b.passcode);
    const pb = participant(b.token);
    pb.cookie = pa.cookie;
    expect((await pb.view()).status).toBe(401);
    pb.cookie = "nmbm_form=made-up";
    expect((await pb.view()).status).toBe(401);
  });

  it("locks after five wrong passcodes, for good", async () => {
    const s = await sent();
    const p = participant(s.token);
    for (let i = 0; i < 4; i += 1) expect((await p.unlock(wrong(s.passcode))).status).toBe(401);
    expect((await p.unlock(wrong(s.passcode))).status).toBe(423);
    // Even the right one now.
    expect((await p.unlock(s.passcode)).status).toBe(404);

    const list = (await chw.get(`/api/participants/${s.participantId}/assessments`)).body;
    expect(list[0].link.state).toBe("locked");
    const [locked] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, s.participantId), eq(auditLog.action, "assessment.link_locked")));
    expect(locked.actorUserId).toBeNull();
  });

  it("files the participant's answers as theirs, and the link dies on submit", async () => {
    const s = await sent();
    const p = participant(s.token);
    await p.unlock(s.passcode);

    expect((await p.save({ [ids.housed]: "maybe" })).status).toBe(422);
    await p.save({ [ids.housed]: "no" });
    const blocked = await p.submit();
    expect(blocked.status).toBe(422);
    expect(blocked.body.message).toMatch(/Where are you staying/);
    await p.save({ [ids.where]: "With my aunt" });
    expect((await p.submit()).status).toBe(200);

    const done = (await chw.get(`/api/assessments/${s.assessmentId}`)).body;
    expect(done).toMatchObject({
      mode: "self",
      status: "completed",
      completedById: null,
      answers: { [ids.housed]: "no", [ids.where]: "With my aunt" },
      link: { state: "submitted" },
    });
    expect((await p.view()).status).toBe(404);
    expect((await p.unlock(s.passcode)).status).toBe(404);

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, s.participantId), eq(auditLog.action, "assessment.completed")));
    expect(entry.actorUserId).toBeNull();
    expect(entry.detail).toMatch(/submitted by the participant/);

    // The administrator's activity list still shows it.
    const recent = (await admin.get("/api/admin/audit")).body;
    expect(recent.some((e: { action: string; actorName: string | null }) => e.action === "assessment.completed" && e.actorName === null)).toBe(true);
  });

  it("asks for the passcode again after a spell of inactivity", async () => {
    const s = await sent();
    const p = participant(s.token);
    await p.unlock(s.passcode);
    await db
      .update(assessmentLinks)
      .set({ accessExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(assessmentLinks.assessmentId, s.assessmentId));
    expect((await p.view()).status).toBe(401);
  });

  it("stops working when it expires or the enrolment closes", async () => {
    const s = await sent();
    await db
      .update(assessmentLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(assessmentLinks.assessmentId, s.assessmentId));
    expect((await participant(s.token).unlock(s.passcode)).status).toBe(404);

    const t = await sent();
    expect((await director.post(`/api/episodes/${t.episodeId}/close`, { closureReason: "completed" })).status).toBe(200);
    expect((await participant(t.token).unlock(t.passcode)).status).toBe(404);
  });
});

describe("the case manager afterwards", () => {
  it("can't edit what the participant is filling in, but can void it", async () => {
    const s = await sent();
    const edit = await chw.patch(`/api/assessments/${s.assessmentId}/answers`, { answers: { [ids.housed]: "yes" } });
    expect(edit.status).toBe(409);
    expect((await chw.post(`/api/assessments/${s.assessmentId}/complete`)).status).toBe(409);
    expect((await chw.post(`/api/assessments/${s.assessmentId}/void`, { reason: "Sent the wrong form" })).status).toBe(200);
    expect((await participant(s.token).unlock(s.passcode)).status).toBe(404);
  });

  it("can issue a new link, which kills the old one and keeps the answers", async () => {
    const s = await sent();
    const old = participant(s.token);
    await old.unlock(s.passcode);
    await old.save({ [ids.housed]: "yes" });

    const fresh = await chw.post(`/api/assessments/${s.assessmentId}/link`);
    expect(fresh.status).toBe(201);
    expect((await old.view()).status).toBe(404);
    expect((await participant(s.token).unlock(s.passcode)).status).toBe(404);

    const p = participant(fresh.body.token);
    await p.unlock(fresh.body.passcode);
    expect((await p.view()).body.answers).toEqual({ [ids.housed]: "yes" });
  });

  it("can revoke a link", async () => {
    const s = await sent();
    expect((await chw.post(`/api/assessments/${s.assessmentId}/link/revoke`)).status).toBe(200);
    expect((await participant(s.token).unlock(s.passcode)).status).toBe(404);
    expect((await chw.get(`/api/assessments/${s.assessmentId}`)).body.link.state).toBe("revoked");
  });

  it("only takes link requests for a participant they can see", async () => {
    const other = await staff(db, "community_health_worker");
    const s = await sent(director, other.id);
    expect((await chw.post(`/api/assessments/${s.assessmentId}/link`)).status).toBe(404);
    expect((await chw.post(`/api/assessments/${s.assessmentId}/link/revoke`)).status).toBe(404);
  });
});

