import type { Db } from "@nmbm/db";
import {
  assessmentForms,
  assessmentFormVersions,
  assessmentQuestions,
  assessments,
  assignments,
  carePlans,
  cohortEnrollments,
  cohortSessions,
  followUpCalls,
  participants,
  sessionAttendance,
  users,
} from "@nmbm/db";
import { alias } from "drizzle-orm/pg-core";
import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  answerText,
  isAnswered,
  PARTICIPANT_DETAIL_FIELDS,
  visibleQuestionIds,
  type RecordExportPurpose,
} from "@nmbm/shared";
import { notFound } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";
import * as participantRepo from "../participants/repository.js";
import * as consentService from "../consents/service.js";
import * as referralService from "../referrals/service.js";
import * as incomingReferralService from "../incoming-referrals/service.js";
import * as programService from "../programs/service.js";
import * as documentService from "../documents/service.js";

const approver = alias(users, "approver");

async function assessmentsWithAnswers(db: Db, participantId: string) {
  const rows = await db
    .select({
      id: assessments.id,
      versionId: assessments.versionId,
      formName: assessmentForms.name,
      versionNumber: assessmentFormVersions.versionNumber,
      mode: assessments.mode,
      status: assessments.status,
      answers: assessments.answers,
      startedAt: assessments.startedAt,
      completedAt: assessments.completedAt,
      voidReason: assessments.voidReason,
    })
    .from(assessments)
    .innerJoin(assessmentFormVersions, eq(assessmentFormVersions.id, assessments.versionId))
    .innerJoin(assessmentForms, eq(assessmentForms.id, assessmentFormVersions.formId))
    .where(eq(assessments.participantId, participantId))
    .orderBy(desc(assessments.startedAt));
  if (rows.length === 0) return [];

  const questions = await db
    .select()
    .from(assessmentQuestions)
    .where(inArray(assessmentQuestions.versionId, [...new Set(rows.map((r) => r.versionId))]))
    .orderBy(asc(assessmentQuestions.sortOrder));

  // Each answer next to the question as it was worded on the version it
  // was given against, as words rather than stored option values — a
  // reader outside NMBM has no way to decode "o_3f2a".
  return rows.map(({ answers, versionId, ...a }) => {
    const own = questions.filter((q) => q.versionId === versionId);
    const visible = visibleQuestionIds(own, answers);
    return {
      ...a,
      answers: own
        .filter((q) => visible.has(q.stableId) && isAnswered(answers[q.stableId]))
        .map((q) => ({ section: q.section, question: q.prompt, answer: answerText(q, answers[q.stableId]) })),
    };
  });
}

// Everything held about one participant, as one document. What's here
// is what's on their record; what isn't is said in `omitted`, so whoever
// receives it isn't left to guess.
export async function buildExport(
  db: Db,
  participantId: string,
  purpose: { purpose: RecordExportPurpose; note?: string | null },
  actorId: string,
) {
  const [person] = await db.select().from(participants).where(eq(participants.id, participantId));
  if (!person) throw notFound("Participant not found");
  const [actor] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, actorId));

  const [
    episodes,
    notes,
    consents,
    referralsOut,
    referralsIn,
    enrollments,
    assessmentRows,
    documents,
  ] = await Promise.all([
    participantRepo.listEpisodes(db, participantId),
    participantRepo.listNotes(db, participantId),
    consentService.listForParticipant(db, participantId),
    referralService.listForParticipant(db, participantId),
    incomingReferralService.listForParticipant(db, participantId),
    programService.listEnrollmentsForParticipant(db, participantId),
    assessmentsWithAnswers(db, participantId),
    documentService.listForParticipant(db, participantId),
  ]);

  const caseManagers = await db
    .select({ name: users.displayName, startedAt: assignments.startedAt, endedAt: assignments.endedAt })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.workerId))
    .where(eq(assignments.participantId, participantId))
    .orderBy(asc(assignments.startedAt));

  const carePlanRows = await db
    .select({
      episodeId: carePlans.episodeId,
      status: carePlans.status,
      goals: carePlans.goals,
      createdAt: carePlans.createdAt,
      approvedAt: carePlans.approvedAt,
      approvedByName: approver.displayName,
    })
    .from(carePlans)
    .leftJoin(approver, eq(approver.id, carePlans.approvedById))
    .where(eq(carePlans.participantId, participantId))
    .orderBy(asc(carePlans.createdAt));

  const attendance = enrollments.length
    ? await db
        .select({
          enrollmentId: sessionAttendance.enrollmentId,
          date: cohortSessions.sessionDate,
          topic: cohortSessions.topic,
          status: sessionAttendance.status,
        })
        .from(sessionAttendance)
        .innerJoin(cohortSessions, eq(cohortSessions.id, sessionAttendance.sessionId))
        .innerJoin(cohortEnrollments, eq(cohortEnrollments.id, sessionAttendance.enrollmentId))
        .where(eq(cohortEnrollments.participantId, participantId))
        .orderBy(asc(cohortSessions.sessionDate))
    : [];

  const calls = await db
    .select({
      milestoneMonths: followUpCalls.milestoneMonths,
      outcome: followUpCalls.outcome,
      note: followUpCalls.note,
      servicesFeedback: followUpCalls.servicesFeedback,
      calledAt: followUpCalls.calledAt,
      calledByName: users.displayName,
    })
    .from(followUpCalls)
    .innerJoin(users, eq(users.id, followUpCalls.calledById))
    .where(eq(followUpCalls.participantId, participantId))
    .orderBy(asc(followUpCalls.calledAt));

  const generatedAt = new Date();
  // Written before anything is returned: an export that left the
  // building without a trail is the thing this is here to prevent.
  await writeAudit(db, {
    actorUserId: actorId,
    action: "record.exported",
    entityType: "participant",
    entityId: participantId,
    detail: purpose.note ? `${purpose.purpose}: ${purpose.note}` : purpose.purpose,
  });

  return {
    generatedAt,
    generatedByName: actor?.name ?? null,
    purpose: purpose.purpose,
    purposeNote: purpose.note ?? null,
    participant: {
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      dateOfBirth: person.dateOfBirth,
      payer: person.payer,
      recordCreatedAt: person.createdAt,
      details: Object.fromEntries(PARTICIPANT_DETAIL_FIELDS.map((k) => [k, person[k]])) as Record<
        (typeof PARTICIPANT_DETAIL_FIELDS)[number],
        string | null
      >,
    },
    episodes,
    caseManagers,
    referralsIn,
    notes: notes.map(({ authorId: _a, ...n }) => n),
    carePlans: carePlanRows,
    consents,
    referralsOut,
    programs: enrollments.map(({ enrollmentId, ...e }) => ({
      ...e,
      attendance: attendance.filter((x) => x.enrollmentId === enrollmentId).map(({ enrollmentId: _e, ...x }) => x),
    })),
    assessments: assessmentRows,
    followUpCalls: calls,
    documents: documents.map(({ id: _id, ...d }) => d),
    omitted: [
      "The files of uploaded documents. They are listed here; each is opened from the record, and every opening is logged.",
      "The audit log of who viewed or changed the record.",
    ],
  };
}
