import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { auditLog } from "@nmbm/db";
import { and, eq } from "drizzle-orm";
import { publishProblems, visibleQuestionIds, type FormQuestionInput } from "@nmbm/shared";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit } from "./support/fixtures.js";

/* ------------------------------------------------------------------ *
 * The branching engine, no database.
 * ------------------------------------------------------------------ */

const ids = { housed: randomUUID(), where: randomUUID(), how_long: randomUUID(), kids: randomUUID() };

const q = (stableId: string, sortOrder: number, extra: Partial<FormQuestionInput> = {}) =>
  ({
    stableId,
    sortOrder,
    type: "yes_no",
    prompt: `question ${sortOrder}`,
    required: false,
    options: [],
    ...extra,
  }) as FormQuestionInput & { sortOrder: number };

const housing = [
  q(ids.housed, 0),
  q(ids.where, 1, {
    type: "short_text",
    showIf: { mode: "all", conditions: [{ questionId: ids.housed, op: "eq", value: "no" }] },
  }),
  q(ids.how_long, 2, {
    type: "number",
    showIf: { mode: "all", conditions: [{ questionId: ids.where, op: "answered" }] },
  }),
];

describe("which questions apply", () => {
  it("shows a follow-up only when its condition holds", () => {
    expect(visibleQuestionIds(housing, { [ids.housed]: "yes" }).has(ids.where)).toBe(false);
    expect(visibleQuestionIds(housing, { [ids.housed]: "no" }).has(ids.where)).toBe(true);
  });

  it("hides a whole chain when the first link changes, whatever was typed further down", () => {
    const answers = { [ids.housed]: "yes", [ids.where]: "with a friend", [ids.how_long]: 3 };
    const visible = visibleQuestionIds(housing, answers);
    expect(visible.has(ids.where)).toBe(false);
    // Q3 depends on Q2 being answered. It was — but Q2 can't be seen,
    // so its answer doesn't count.
    expect(visible.has(ids.how_long)).toBe(false);
  });

  it("treats an unanswered question as satisfying nothing, not even 'is not'", () => {
    const rule = [
      q(ids.housed, 0),
      q(ids.where, 1, { showIf: { mode: "all", conditions: [{ questionId: ids.housed, op: "ne", value: "yes" }] } }),
    ];
    expect(visibleQuestionIds(rule, {}).has(ids.where)).toBe(false);
  });

  it("matches a multiple-choice answer by any option chosen", () => {
    const rule = [
      q(ids.kids, 0, { type: "multi_choice", options: [{ value: "food", label: "Food" }, { value: "rent", label: "Rent" }] }),
      q(ids.where, 1, { showIf: { mode: "all", conditions: [{ questionId: ids.kids, op: "eq", value: "rent" }] } }),
    ];
    expect(visibleQuestionIds(rule, { [ids.kids]: ["food", "rent"] }).has(ids.where)).toBe(true);
    expect(visibleQuestionIds(rule, { [ids.kids]: ["food"] }).has(ids.where)).toBe(false);
  });
});

describe("what publishing refuses", () => {
  it("a rule that looks forward", () => {
    const forward = [
      q(ids.where, 0, { showIf: { mode: "all", conditions: [{ questionId: ids.housed, op: "eq", value: "no" }] } }),
      q(ids.housed, 1),
    ];
    expect(publishProblems(forward).map((p) => p.message).join()).toMatch(/doesn't come before it/);
    expect(publishProblems(housing)).toEqual([]);
  });

  it("a rule naming an option the earlier question no longer has", () => {
    const stale = [
      q(ids.kids, 0, { type: "single_choice", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }),
      q(ids.where, 1, { showIf: { mode: "all", conditions: [{ questionId: ids.kids, op: "eq", value: "gone" }] } }),
    ];
    expect(publishProblems(stale).map((p) => p.message).join()).toMatch(/no longer has/);
  });

  it("a choice question with fewer than two options, and an empty form", () => {
    expect(publishProblems([q(ids.kids, 0, { type: "single_choice", options: [{ value: "a", label: "A" }] })])).toHaveLength(1);
    expect(publishProblems([])).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Over HTTP.
 * ------------------------------------------------------------------ */

let app: FastifyInstance;
let db: Db;
let director: Client;
let directorId: string;
let chw: Client;
let chwId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const d = await staff(db, "clinical_director");
  directorId = d.id;
  director = await signIn(app, d.email);
  const w = await staff(db, "community_health_worker");
  chwId = w.id;
  chw = await signIn(app, w.email);
});
afterAll(async () => app?.close());

// A short needs assessment: housing, with a follow-up only for somebody
// who isn't housed, which is required when asked.
function needsAssessment() {
  const s = { housed: randomUUID(), where: randomUUID(), notes: randomUUID() };
  const questions: FormQuestionInput[] = [
    { stableId: s.housed, type: "yes_no", prompt: "Do you have stable housing?", required: true, options: [], section: "Housing" },
    {
      stableId: s.where,
      type: "short_text",
      prompt: "Where are you staying?",
      required: true,
      options: [],
      section: "Housing",
      showIf: { mode: "all", conditions: [{ questionId: s.housed, op: "eq", value: "no" }] },
    },
    { stableId: s.notes, type: "long_text", prompt: "Anything else?", required: false, options: [] },
  ];
  return { s, questions };
}

async function publishedForm(questions = needsAssessment().questions) {
  const form = await director.post("/api/assessment-forms", { name: `Needs ${randomUUID().slice(0, 6)}` });
  expect(form.status).toBe(201);
  expect((await director.put(`/api/assessment-versions/${form.body.draftVersionId}/questions`, { questions })).status).toBe(200);
  expect((await director.post(`/api/assessment-versions/${form.body.draftVersionId}/publish`)).status).toBe(200);
  return { formId: form.body.id as string, versionId: form.body.draftVersionId as string };
}

describe("building a form", () => {
  it("is for the people who decide what's collected, not every worker", async () => {
    expect((await chw.post("/api/assessment-forms", { name: "Mine" })).status).toBe(403);
    // But a worker can read a form, to fill one in.
    const { formId } = await publishedForm();
    expect((await chw.get(`/api/assessment-forms/${formId}`)).status).toBe(200);
  });

  it("never changes a published version; edits go into a new draft that keeps question ids", async () => {
    const { s, questions } = needsAssessment();
    const { formId, versionId } = await publishedForm(questions);

    const edit = await director.put(`/api/assessment-versions/${versionId}/questions`, { questions: [] });
    expect(edit.status).toBe(409);

    const draft = await director.post(`/api/assessment-forms/${formId}/drafts`);
    expect(draft.status).toBe(201);
    expect(draft.body.versionNumber).toBe(2);
    const copied = (await director.get(`/api/assessment-versions/${draft.body.id}`)).body.questions;
    expect(copied.map((x: { stableId: string }) => x.stableId)).toEqual([s.housed, s.where, s.notes]);

    // One draft at a time.
    expect((await director.post(`/api/assessment-forms/${formId}/drafts`)).status).toBe(409);
  });

  it("refuses to publish a question that changed kind of answer since an earlier version", async () => {
    const { s, questions } = needsAssessment();
    const { formId } = await publishedForm(questions);
    const draft = (await director.post(`/api/assessment-forms/${formId}/drafts`)).body;
    const changed = questions.map((x) => (x.stableId === s.notes ? { ...x, type: "number" as const } : x));
    await director.put(`/api/assessment-versions/${draft.id}/questions`, { questions: changed });
    const res = await director.post(`/api/assessment-versions/${draft.id}/publish`);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/changed kind of answer/);
  });

  it("refuses to publish broken show-if rules", async () => {
    const { s, questions } = needsAssessment();
    const form = (await director.post("/api/assessment-forms", { name: "Broken" })).body;
    // The follow-up moved above the question it depends on.
    await director.put(`/api/assessment-versions/${form.draftVersionId}/questions`, {
      questions: [questions[1], questions[0]],
    });
    const res = await director.post(`/api/assessment-versions/${form.draftVersionId}/publish`);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/doesn't come before it/);
    void s;
  });
});

describe("filling one in", () => {
  it("starts on the current version, and stays on it when a newer one is published", async () => {
    const { questions } = needsAssessment();
    const { formId, versionId } = await publishedForm(questions);
    const { participantId } = await admit(db, { workerId: chwId, actorId: directorId });

    const started = await chw.post(`/api/participants/${participantId}/assessments`, { formId, mode: "from_paper" });
    expect(started.status).toBe(201);
    expect(started.body.versionId).toBe(versionId);

    const draft = (await director.post(`/api/assessment-forms/${formId}/drafts`)).body;
    await director.put(`/api/assessment-versions/${draft.id}/questions`, { questions });
    await director.post(`/api/assessment-versions/${draft.id}/publish`);

    expect((await chw.get(`/api/assessments/${started.body.id}`)).body.versionId).toBe(versionId);
    const next = await chw.post(`/api/participants/${participantId}/assessments`, { formId, mode: "with_staff" });
    expect(next.body.versionId).toBe(draft.id);
  });

  it("refuses an answer that doesn't fit its question", async () => {
    const { s, questions } = needsAssessment();
    const { formId } = await publishedForm(questions);
    const { participantId } = await admit(db, { workerId: chwId, actorId: directorId });
    const a = (await chw.post(`/api/participants/${participantId}/assessments`, { formId, mode: "with_staff" })).body;

    expect((await chw.patch(`/api/assessments/${a.id}/answers`, { answers: { [s.housed]: "maybe" } })).status).toBe(422);
    expect((await chw.patch(`/api/assessments/${a.id}/answers`, { answers: { [randomUUID()]: "x" } })).status).toBe(422);
    expect((await chw.patch(`/api/assessments/${a.id}/answers`, { answers: { [s.housed]: "no" } })).status).toBe(200);

    // null clears an answer and leaves the others alone.
    await chw.patch(`/api/assessments/${a.id}/answers`, { answers: { [s.notes]: "Needs a bus pass" } });
    const cleared = await chw.patch(`/api/assessments/${a.id}/answers`, { answers: { [s.notes]: null } });
    expect(cleared.body.answers).toEqual({ [s.housed]: "no" });
  });

  it("requires a follow-up only when it's asked, and drops answers to questions that ended up hidden", async () => {
    const { s, questions } = needsAssessment();
    const { formId } = await publishedForm(questions);
    const { participantId } = await admit(db, { workerId: chwId, actorId: directorId });
    const a = (await chw.post(`/api/participants/${participantId}/assessments`, { formId, mode: "with_staff" })).body;
    const save = (answers: Record<string, unknown>) => chw.patch(`/api/assessments/${a.id}/answers`, { answers });

    await save({ [s.housed]: "no" });
    const blocked = await chw.post(`/api/assessments/${a.id}/complete`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.message).toMatch(/Where are you staying/);

    // They answer, then it turns out they are housed after all.
    await save({ [s.where]: "With my sister" });
    await save({ [s.housed]: "yes" });
    // Kept while the form is open — changing back shouldn't lose it.
    expect((await chw.get(`/api/assessments/${a.id}`)).body.answers[s.where]).toBe("With my sister");

    const done = await chw.post(`/api/assessments/${a.id}/complete`);
    expect(done.status).toBe(200);
    expect(done.body.answers).toEqual({ [s.housed]: "yes" });

    const audited = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, participantId), eq(auditLog.action, "assessment.completed")));
    expect(audited).toHaveLength(1);
  });

  it("can't be changed once complete; a correction is a void and a new one", async () => {
    const { s, questions } = needsAssessment();
    const { formId } = await publishedForm(questions);
    const { participantId } = await admit(db, { workerId: chwId, actorId: directorId });
    const a = (await chw.post(`/api/participants/${participantId}/assessments`, { formId, mode: "with_staff" })).body;
    await chw.patch(`/api/assessments/${a.id}/answers`, { answers: { [s.housed]: "yes" } });
    await chw.post(`/api/assessments/${a.id}/complete`);

    expect((await chw.patch(`/api/assessments/${a.id}/answers`, { answers: { [s.housed]: "no" } })).status).toBe(409);

    const voided = await chw.post(`/api/assessments/${a.id}/void`, { reason: "Entered on the wrong day" });
    expect(voided.status).toBe(200);
    const list = (await chw.get(`/api/participants/${participantId}/assessments`)).body;
    expect(list[0]).toMatchObject({ status: "voided", voidReason: "Entered on the wrong day" });
    // Still readable — voided, not gone.
    expect((await chw.get(`/api/assessments/${a.id}`)).body.answers).toEqual({ [s.housed]: "yes" });
  });

  it("follows the record's scoping: another worker's client isn't there", async () => {
    const { formId } = await publishedForm();
    const other = await staff(db, "community_health_worker");
    const { participantId } = await admit(db, { workerId: other.id, actorId: directorId });

    expect((await chw.post(`/api/participants/${participantId}/assessments`, { formId, mode: "with_staff" })).status).toBe(404);
    const theirs = (await director.post(`/api/participants/${participantId}/assessments`, { formId, mode: "with_staff" })).body;
    expect((await chw.get(`/api/assessments/${theirs.id}`)).status).toBe(404);
    expect((await chw.post(`/api/assessments/${theirs.id}/complete`)).status).toBe(404);
  });

  it("isn't started on a retired form, or for somebody with no open episode", async () => {
    const { formId } = await publishedForm();
    const { participantId, episodeId } = await admit(db, { workerId: chwId, actorId: directorId });

    await director.post(`/api/assessment-forms/${formId}/active`, { active: false });
    expect((await chw.post(`/api/participants/${participantId}/assessments`, { formId, mode: "with_staff" })).status).toBe(409);
    await director.post(`/api/assessment-forms/${formId}/active`, { active: true });

    const closed = await director.post(`/api/episodes/${episodeId}/close`, { closureReason: "completed" });
    expect(closed.status).toBe(200);
    expect((await director.post(`/api/participants/${participantId}/assessments`, { formId, mode: "with_staff" })).status).toBe(409);
  });
});
