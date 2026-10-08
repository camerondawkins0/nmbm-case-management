import type { Db } from "@nmbm/db";
import {
  assessmentForms,
  assessmentFormVersions,
  assessmentQuestions,
  assessments,
  episodes,
  users,
} from "@nmbm/db";
import { and, asc, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import {
  answerProblem,
  isAnswered,
  publishProblems,
  visibleQuestionIds,
  type Answers,
  type AssessmentMode,
  type FormQuestionInput,
} from "@nmbm/shared";
import { conflict, notFound, unprocessable } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";

/* ------------------------------------------------------------------ *
 * Forms and versions.
 * ------------------------------------------------------------------ */

export async function listForms(db: Db) {
  const forms = await db.select().from(assessmentForms).orderBy(asc(assessmentForms.name));
  const versions = await db
    .select({
      id: assessmentFormVersions.id,
      formId: assessmentFormVersions.formId,
      versionNumber: assessmentFormVersions.versionNumber,
      status: assessmentFormVersions.status,
    })
    .from(assessmentFormVersions);
  return forms.map((form) => {
    const own = versions.filter((v) => v.formId === form.id);
    const published = own
      .filter((v) => v.status === "published")
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
    const draft = own.find((v) => v.status === "draft");
    return {
      id: form.id,
      name: form.name,
      description: form.description,
      active: form.active,
      currentVersionId: published?.id ?? null,
      currentVersionNumber: published?.versionNumber ?? null,
      draftVersionId: draft?.id ?? null,
    };
  });
}

// The version new assessments are started on: the highest published
// one. Derived rather than flagged, so there's no "current" marker to
// forget to move when a new version goes live.
async function currentVersion(db: Db, formId: string) {
  const [row] = await db
    .select()
    .from(assessmentFormVersions)
    .where(and(eq(assessmentFormVersions.formId, formId), eq(assessmentFormVersions.status, "published")))
    .orderBy(desc(assessmentFormVersions.versionNumber))
    .limit(1);
  return row;
}

export async function createForm(
  db: Db,
  input: { name: string; description?: string | null },
  actorId: string,
) {
  return db.transaction(async (tx) => {
    const [form] = await tx
      .insert(assessmentForms)
      .values({ name: input.name, description: input.description ?? null, createdById: actorId })
      .returning();
    const [draft] = await tx
      .insert(assessmentFormVersions)
      .values({ formId: form.id, versionNumber: 1, createdById: actorId })
      .returning();
    await writeAudit(tx as unknown as Db, {
      actorUserId: actorId,
      action: "assessment_form.created",
      entityType: "assessment_form",
      entityId: form.id,
      detail: form.name,
    });
    return { ...form, draftVersionId: draft.id };
  });
}

export async function getForm(db: Db, formId: string) {
  const [form] = await db.select().from(assessmentForms).where(eq(assessmentForms.id, formId));
  if (!form) throw notFound("Form not found");
  const versions = await db
    .select({
      id: assessmentFormVersions.id,
      versionNumber: assessmentFormVersions.versionNumber,
      status: assessmentFormVersions.status,
      publishedAt: assessmentFormVersions.publishedAt,
      publishedByName: users.displayName,
    })
    .from(assessmentFormVersions)
    .leftJoin(users, eq(users.id, assessmentFormVersions.publishedById))
    .where(eq(assessmentFormVersions.formId, formId))
    .orderBy(desc(assessmentFormVersions.versionNumber));
  return { ...form, versions };
}

async function questionsFor(db: Db, versionId: string) {
  return db
    .select()
    .from(assessmentQuestions)
    .where(eq(assessmentQuestions.versionId, versionId))
    .orderBy(asc(assessmentQuestions.sortOrder));
}

export async function getVersion(db: Db, versionId: string) {
  const [version] = await db
    .select({
      id: assessmentFormVersions.id,
      formId: assessmentFormVersions.formId,
      formName: assessmentForms.name,
      versionNumber: assessmentFormVersions.versionNumber,
      status: assessmentFormVersions.status,
      publishedAt: assessmentFormVersions.publishedAt,
    })
    .from(assessmentFormVersions)
    .innerJoin(assessmentForms, eq(assessmentForms.id, assessmentFormVersions.formId))
    .where(eq(assessmentFormVersions.id, versionId));
  if (!version) throw notFound("Form version not found");
  return { ...version, questions: await questionsFor(db, versionId) };
}

async function requireDraft(db: Db, versionId: string) {
  const [version] = await db
    .select()
    .from(assessmentFormVersions)
    .where(eq(assessmentFormVersions.id, versionId));
  if (!version) throw notFound("Form version not found");
  // A published version is what somebody was asked. Changing it would
  // put different words next to answers already given.
  if (version.status !== "draft") {
    throw conflict("A published version can't be changed — start a new draft of the form instead");
  }
  return version;
}

// The builder saves the whole question list at once, in order. The
// draft's rows are replaced: a draft has never been shown to anybody,
// so its rows are authoring state, not a record of anything that
// happened — the nothing-is-deleted rule is about records, and a
// published version's rows are never touched.
export async function saveDraftQuestions(db: Db, versionId: string, questions: FormQuestionInput[]) {
  await requireDraft(db, versionId);
  const ids = questions.map((q) => q.stableId);
  if (new Set(ids).size !== ids.length) throw unprocessable("Two questions have the same id");
  await db.transaction(async (tx) => {
    await tx.delete(assessmentQuestions).where(eq(assessmentQuestions.versionId, versionId));
    if (questions.length === 0) return;
    await tx.insert(assessmentQuestions).values(
      questions.map((q, i) => ({
        versionId,
        stableId: q.stableId,
        sortOrder: i,
        type: q.type,
        prompt: q.prompt,
        helpText: q.helpText ?? null,
        section: q.section ?? null,
        required: q.required,
        // Yes/no carries its two options implicitly; storing a list
        // there would be a second, editable answer to what they are.
        options: q.type === "single_choice" || q.type === "multi_choice" ? q.options : [],
        showIf: q.showIf ?? null,
      })),
    );
  });
  return getVersion(db, versionId);
}

function asInput(row: typeof assessmentQuestions.$inferSelect): FormQuestionInput & { sortOrder: number } {
  return {
    stableId: row.stableId,
    sortOrder: row.sortOrder,
    type: row.type,
    prompt: row.prompt,
    helpText: row.helpText,
    section: row.section,
    required: row.required,
    options: row.options,
    showIf: (row.showIf as FormQuestionInput["showIf"]) ?? null,
  };
}

export async function publish(db: Db, versionId: string, actorId: string) {
  const version = await requireDraft(db, versionId);
  const questions = (await questionsFor(db, versionId)).map(asInput);
  const problems = publishProblems(questions);

  // Answers are keyed by stable id across versions. A question that was
  // a number on version 1 and a list of options on version 2 would mix
  // two kinds of answer under one key; a new kind of question needs to
  // be a new question.
  const earlier = await db
    .select({ stableId: assessmentQuestions.stableId, type: assessmentQuestions.type })
    .from(assessmentQuestions)
    .innerJoin(assessmentFormVersions, eq(assessmentFormVersions.id, assessmentQuestions.versionId))
    .where(and(eq(assessmentFormVersions.formId, version.formId), ne(assessmentFormVersions.id, versionId)));
  const earlierType = new Map(earlier.map((q) => [q.stableId, q.type]));
  for (const q of questions) {
    const was = earlierType.get(q.stableId);
    if (was && was !== q.type) {
      problems.push({
        stableId: q.stableId,
        message: `"${q.prompt.slice(0, 60)}" changed kind of answer since an earlier version — add it as a new question instead`,
      });
    }
  }
  if (problems.length > 0) {
    throw unprocessable(`This version can't be published yet: ${problems.map((p) => p.message).join("; ")}`);
  }

  const [published] = await db
    .update(assessmentFormVersions)
    .set({ status: "published", publishedAt: new Date(), publishedById: actorId })
    .where(and(eq(assessmentFormVersions.id, versionId), eq(assessmentFormVersions.status, "draft")))
    .returning();
  if (!published) throw conflict("This version was published by somebody else just now");
  await writeAudit(db, {
    actorUserId: actorId,
    action: "assessment_form.published",
    entityType: "assessment_form",
    entityId: version.formId,
    detail: `version ${version.versionNumber}, ${questions.length} questions`,
  });
  return published;
}

// Editing a published form: a new draft, copied from the current
// version with every stable id and option value kept.
export async function newDraft(db: Db, formId: string, actorId: string) {
  const [form] = await db.select().from(assessmentForms).where(eq(assessmentForms.id, formId));
  if (!form) throw notFound("Form not found");
  const [existing] = await db
    .select()
    .from(assessmentFormVersions)
    .where(and(eq(assessmentFormVersions.formId, formId), eq(assessmentFormVersions.status, "draft")));
  if (existing) throw conflict("This form already has a draft — edit that one");

  const source = await currentVersion(db, formId);
  const [{ highest }] = await db
    .select({ highest: max(assessmentFormVersions.versionNumber) })
    .from(assessmentFormVersions)
    .where(eq(assessmentFormVersions.formId, formId));
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .insert(assessmentFormVersions)
      .values({ formId, versionNumber: (highest ?? 0) + 1, createdById: actorId })
      .returning();
    if (source) {
      const rows = await questionsFor(tx as unknown as Db, source.id);
      if (rows.length > 0) {
        await tx
          .insert(assessmentQuestions)
          .values(rows.map(({ id: _id, versionId: _v, ...q }) => ({ ...q, versionId: draft.id })));
      }
    }
    return draft;
  });
}

export async function setFormActive(db: Db, formId: string, active: boolean, actorId: string) {
  const [form] = await db
    .update(assessmentForms)
    .set({ active })
    .where(eq(assessmentForms.id, formId))
    .returning();
  if (!form) throw notFound("Form not found");
  await writeAudit(db, {
    actorUserId: actorId,
    action: active ? "assessment_form.reactivated" : "assessment_form.retired",
    entityType: "assessment_form",
    entityId: formId,
    detail: form.name,
  });
  return form;
}

/* ------------------------------------------------------------------ *
 * Assessments on a participant's record.
 * ------------------------------------------------------------------ */

export async function listForParticipant(db: Db, participantId: string) {
  return db
    .select({
      id: assessments.id,
      formName: assessmentForms.name,
      versionNumber: assessmentFormVersions.versionNumber,
      mode: assessments.mode,
      status: assessments.status,
      startedAt: assessments.startedAt,
      startedByName: users.displayName,
      completedAt: assessments.completedAt,
      voidReason: assessments.voidReason,
    })
    .from(assessments)
    .innerJoin(assessmentFormVersions, eq(assessmentFormVersions.id, assessments.versionId))
    .innerJoin(assessmentForms, eq(assessmentForms.id, assessmentFormVersions.formId))
    .leftJoin(users, eq(users.id, assessments.startedById))
    .where(eq(assessments.participantId, participantId))
    .orderBy(desc(assessments.startedAt));
}

export async function start(
  db: Db,
  participantId: string,
  input: { formId: string; mode: AssessmentMode },
  actorId: string,
) {
  const [form] = await db.select().from(assessmentForms).where(eq(assessmentForms.id, input.formId));
  if (!form) throw notFound("Form not found");
  if (!form.active) throw conflict("This form has been retired");
  const version = await currentVersion(db, form.id);
  if (!version) throw unprocessable("This form hasn't been published yet");

  // Filed against the enrolment it was taken in, so a needs assessment
  // from a previous stay reads as that, not as today's picture.
  const [episode] = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.participantId, participantId), eq(episodes.status, "open")));
  if (!episode) throw conflict("This participant has no open episode — readmit them first");

  const [row] = await db
    .insert(assessments)
    .values({ participantId, episodeId: episode.id, versionId: version.id, mode: input.mode, startedById: actorId })
    .returning();
  await writeAudit(db, {
    actorUserId: actorId,
    action: "assessment.started",
    entityType: "participant",
    entityId: participantId,
    detail: `${form.name} v${version.versionNumber}`,
  });
  return row;
}

export async function find(db: Db, id: string) {
  const [row] = await db.select().from(assessments).where(eq(assessments.id, id));
  if (!row) throw notFound("Assessment not found");
  return row;
}

export async function get(db: Db, id: string) {
  const [row] = await db
    .select({
      assessment: assessments,
      startedByName: users.displayName,
    })
    .from(assessments)
    .leftJoin(users, eq(users.id, assessments.startedById))
    .where(eq(assessments.id, id));
  if (!row) throw notFound("Assessment not found");
  const version = await getVersion(db, row.assessment.versionId);
  let completedByName: string | null = null;
  if (row.assessment.completedById) {
    const [u] = await db.select().from(users).where(eq(users.id, row.assessment.completedById));
    completedByName = u?.displayName ?? null;
  }
  return { ...row.assessment, startedByName: row.startedByName, completedByName, form: version };
}

// Answers go on an assessment only while it's open, and only while its
// enrolment is: the same rule notes follow, so nothing is added to a
// closed stay after the fact.
//
// actorId is the staff member, or null for the participant through
// their own link. Each side keeps to its own kind of assessment: staff
// editing a form the participant is filling in would put words in their
// mouth, and the record would still say they wrote it.
async function requireOpen(db: Db, id: string, actorId: string | null) {
  const row = await find(db, id);
  if (actorId !== null && row.mode === "self") {
    throw conflict(
      "The participant is filling this in from their own link. To fill it in yourself, void it and start a new one",
    );
  }
  if (actorId === null && row.mode !== "self") throw conflict("This form isn't the participant's to fill in");
  if (row.status !== "in_progress") {
    throw conflict(
      row.status === "completed"
        ? "This assessment is complete and can't be changed — void it and start a new one to correct it"
        : "This assessment was voided",
    );
  }
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, row.episodeId));
  if (episode?.status !== "open") throw conflict("The enrolment this assessment belongs to has closed");
  return row;
}

export async function saveAnswers(db: Db, id: string, patch: Record<string, unknown>, actorId: string | null) {
  const row = await requireOpen(db, id, actorId);
  const questions = await questionsFor(db, row.versionId);
  const byId = new Map(questions.map((q) => [q.stableId, q]));

  const set: Answers = {};
  const cleared: string[] = [];
  for (const [stableId, value] of Object.entries(patch)) {
    const q = byId.get(stableId);
    if (!q) throw unprocessable("An answer was sent for a question that isn't on this form");
    if (value === null) {
      cleared.push(stableId);
      continue;
    }
    const problem = answerProblem(q, value as Answers[string]);
    if (problem) throw unprocessable(`"${q.prompt.slice(0, 60)}" ${problem}`);
    set[stableId] = value as Answers[string];
  }

  // Merged in the database rather than read-modify-write here, so two
  // people saving different questions at once both keep their answers.
  // Answers to questions an earlier answer now hides are kept while the
  // form is open: changing Yes to No and back shouldn't lose the
  // explanation typed in between. Completing drops them.
  const [updated] = await db
    .update(assessments)
    .set({
      // Keys to clear go over as one JSON parameter: a JS array here
      // would be spread into a parameter list, and an empty one into "()".
      answers: sql`(${assessments.answers} || ${JSON.stringify(set)}::jsonb)
        - array(select jsonb_array_elements_text(${JSON.stringify(cleared)}::jsonb))`,
      updatedAt: new Date(),
    })
    .where(and(eq(assessments.id, id), eq(assessments.status, "in_progress")))
    .returning();
  if (!updated) throw conflict("This assessment was completed or voided while you were working on it");
  return updated;
}

export async function complete(db: Db, id: string, actorId: string | null) {
  const row = await requireOpen(db, id, actorId);
  const questions = await questionsFor(db, row.versionId);
  const visible = visibleQuestionIds(questions, row.answers);

  // Required means required when asked. A follow-up hidden by an earlier
  // answer was never asked, so it can't hold the form open.
  const missing = questions.filter((q) => visible.has(q.stableId) && q.required && !isAnswered(row.answers[q.stableId]));
  if (missing.length > 0) {
    const named = missing.slice(0, 5).map((q) => `"${q.prompt.slice(0, 60)}"`);
    throw unprocessable(
      `Still to answer: ${named.join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}`,
    );
  }

  // What's kept is what was asked and answered. An answer left behind
  // on a question that ended up hidden would read, later, as something
  // the participant said about a situation they told us isn't theirs.
  const kept: Answers = {};
  for (const q of questions) {
    const value = row.answers[q.stableId];
    if (visible.has(q.stableId) && isAnswered(value)) kept[q.stableId] = value;
  }

  const [done] = await db
    .update(assessments)
    .set({ status: "completed", answers: kept, completedAt: new Date(), completedById: actorId, updatedAt: new Date() })
    .where(and(eq(assessments.id, id), eq(assessments.status, "in_progress")))
    .returning();
  if (!done) throw conflict("This assessment was completed or voided while you were working on it");
  const [version] = await db
    .select({ name: assessmentForms.name, n: assessmentFormVersions.versionNumber })
    .from(assessmentFormVersions)
    .innerJoin(assessmentForms, eq(assessmentForms.id, assessmentFormVersions.formId))
    .where(eq(assessmentFormVersions.id, row.versionId));
  await writeAudit(db, {
    actorUserId: actorId,
    action: "assessment.completed",
    entityType: "participant",
    entityId: row.participantId,
    detail: `${version.name} v${version.n}${actorId === null ? ", submitted by the participant" : ""}`,
  });
  return done;
}

// A wrong answer on a completed form is corrected by voiding it and
// filling in a new one, so the record shows both and who did what —
// not by editing what the participant was recorded as saying.
export async function voidAssessment(db: Db, id: string, reason: string, actorId: string) {
  const row = await find(db, id);
  if (row.status === "voided") throw conflict("This assessment was already voided");
  const [voided] = await db
    .update(assessments)
    .set({ status: "voided", voidedAt: new Date(), voidedById: actorId, voidReason: reason, updatedAt: new Date() })
    .where(and(eq(assessments.id, id), inArray(assessments.status, ["in_progress", "completed"])))
    .returning();
  if (!voided) throw conflict("This assessment was already voided");
  await writeAudit(db, {
    actorUserId: actorId,
    action: "assessment.voided",
    entityType: "participant",
    entityId: row.participantId,
    detail: reason,
  });
  return voided;
}
