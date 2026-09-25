import type { Db } from "@nmbm/db";
import {
  programs,
  programCohorts,
  cohortSessions,
  cohortEnrollments,
  sessionAttendance,
  participants,
  users,
  episodes,
} from "@nmbm/db";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";
import type {
  ProgramCreate,
  CohortCreate,
  SessionCreate,
  AttendanceMark,
  AttendanceStatus,
} from "@nmbm/shared";
import { ATTENDED_STATUSES } from "@nmbm/shared";
import { notFound, conflict, badRequest } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";

export async function listPrograms(db: Db) {
  const rows = await db
    .select({
      id: programs.id,
      name: programs.name,
      description: programs.description,
      active: programs.active,
      cohortId: programCohorts.id,
      cohortName: programCohorts.name,
      cohortStatus: programCohorts.status,
      startDate: programCohorts.startDate,
      endDate: programCohorts.endDate,
      requiredSessions: programCohorts.requiredSessions,
      facilitatorName: users.displayName,
    })
    .from(programs)
    .leftJoin(programCohorts, eq(programCohorts.programId, programs.id))
    .leftJoin(users, eq(users.id, programCohorts.facilitatorId))
    .orderBy(programs.name, desc(programCohorts.startDate));

  const byProgram = new Map<string, {
    id: string;
    name: string;
    description: string | null;
    active: boolean;
    cohorts: {
      id: string;
      name: string;
      status: string;
      startDate: string;
      endDate: string | null;
      requiredSessions: number | null;
      facilitatorName: string | null;
    }[];
  }>();

  for (const row of rows) {
    const program = byProgram.get(row.id) ?? {
      id: row.id,
      name: row.name,
      description: row.description,
      active: row.active,
      cohorts: [],
    };
    if (row.cohortId && row.cohortName && row.startDate) {
      program.cohorts.push({
        id: row.cohortId,
        name: row.cohortName,
        status: row.cohortStatus!,
        startDate: row.startDate,
        endDate: row.endDate,
        requiredSessions: row.requiredSessions,
        facilitatorName: row.facilitatorName,
      });
    }
    byProgram.set(row.id, program);
  }
  return [...byProgram.values()];
}

export async function createProgram(db: Db, input: ProgramCreate, actorId: string) {
  const [existing] = await db.select().from(programs).where(eq(programs.name, input.name));
  if (existing) throw conflict("A programme with that name already exists");

  const [row] = await db.insert(programs).values(input).returning();
  await writeAudit(db, {
    actorUserId: actorId,
    action: "program.created",
    entityType: "program",
    entityId: row.id,
    detail: input.name,
  });
  return row;
}

export async function createCohort(db: Db, input: CohortCreate, actorId: string) {
  const [program] = await db.select().from(programs).where(eq(programs.id, input.programId));
  if (!program) throw notFound("Programme not found");

  const [row] = await db
    .insert(programCohorts)
    .values({
      programId: input.programId,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      facilitatorId: input.facilitatorId ?? null,
      requiredSessions: input.requiredSessions ?? null,
      status: "running",
    })
    .returning();

  await writeAudit(db, {
    actorUserId: actorId,
    action: "cohort.created",
    entityType: "cohort",
    entityId: row.id,
    detail: `${program.name} — ${input.name}`,
  });
  return row;
}

export async function addSession(db: Db, cohortId: string, input: SessionCreate, actorId: string) {
  const cohort = await loadCohort(db, cohortId);
  const [row] = await db
    .insert(cohortSessions)
    .values({ cohortId: cohort.id, sessionDate: input.sessionDate, topic: input.topic ?? null })
    .returning();
  await writeAudit(db, {
    actorUserId: actorId,
    action: "cohort.session_added",
    entityType: "cohort",
    entityId: cohortId,
    detail: input.sessionDate,
  });
  return row;
}

async function loadCohort(db: Db, cohortId: string) {
  const [cohort] = await db
    .select()
    .from(programCohorts)
    .where(eq(programCohorts.id, cohortId));
  if (!cohort) throw notFound("Cohort not found");
  return cohort;
}

export async function enroll(db: Db, cohortId: string, participantId: string, actorId: string) {
  const cohort = await loadCohort(db, cohortId);
  if (cohort.status === "completed" || cohort.status === "cancelled") {
    throw conflict("That cohort is closed");
  }
  const [existing] = await db
    .select()
    .from(cohortEnrollments)
    .where(
      and(
        eq(cohortEnrollments.cohortId, cohortId),
        eq(cohortEnrollments.participantId, participantId),
      ),
    );
  if (existing) throw conflict("Already on this roster");

  const [row] = await db
    .insert(cohortEnrollments)
    .values({ cohortId, participantId })
    .returning();
  await writeAudit(db, {
    actorUserId: actorId,
    action: "cohort.enrolled",
    entityType: "cohort",
    entityId: cohortId,
    detail: `participant ${participantId}`,
  });
  return row;
}

export async function withdraw(db: Db, enrollmentId: string, reason: string, actorId: string) {
  const [enrollment] = await db
    .select()
    .from(cohortEnrollments)
    .where(eq(cohortEnrollments.id, enrollmentId));
  if (!enrollment) throw notFound("Enrolment not found");
  if (enrollment.status === "withdrawn") throw conflict("Already withdrawn");

  // Withdrawn, not removed — the classes they did attend still happened
  // and still have to be provable.
  const [row] = await db
    .update(cohortEnrollments)
    .set({ status: "withdrawn", withdrawnAt: new Date(), withdrawnReason: reason })
    .where(eq(cohortEnrollments.id, enrollmentId))
    .returning();
  await writeAudit(db, {
    actorUserId: actorId,
    action: "cohort.withdrawn",
    entityType: "cohort",
    entityId: enrollment.cohortId,
    detail: reason,
  });
  return row;
}

// The roster with every session and every mark, which is what the grid
// renders and what the proof-of-participation view counts from.
export async function getCohort(db: Db, cohortId: string) {
  const cohort = await loadCohort(db, cohortId);
  const [program] = await db.select().from(programs).where(eq(programs.id, cohort.programId));

  const sessions = await db
    .select()
    .from(cohortSessions)
    .where(eq(cohortSessions.cohortId, cohortId))
    .orderBy(asc(cohortSessions.sessionDate));

  const roster = await db
    .select({
      enrollmentId: cohortEnrollments.id,
      status: cohortEnrollments.status,
      participantId: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
      withdrawnReason: cohortEnrollments.withdrawnReason,
      // R10/M14: NMBM chose to flag, not withdraw — disenrolment ends
      // services with NMBM, but a court-ordered class may carry on, and
      // the facilitator needs to know which people that applies to.
      servicesEndedOn: sql<string | null>`(
        select max(e.end_date)::text from ${episodes} e
         where e.participant_id = ${participants.id}
           and not exists (select 1 from ${episodes} o
                            where o.participant_id = ${participants.id} and o.status = 'open')
      )`,
    })
    .from(cohortEnrollments)
    .innerJoin(participants, eq(participants.id, cohortEnrollments.participantId))
    .where(eq(cohortEnrollments.cohortId, cohortId))
    .orderBy(participants.lastName);

  const enrollmentIds = roster.map((r) => r.enrollmentId);
  const marks = enrollmentIds.length
    ? await db
        .select({
          sessionId: sessionAttendance.sessionId,
          enrollmentId: sessionAttendance.enrollmentId,
          status: sessionAttendance.status,
          note: sessionAttendance.note,
          recordedAt: sessionAttendance.recordedAt,
          recordedByName: users.displayName,
        })
        .from(sessionAttendance)
        .innerJoin(users, eq(users.id, sessionAttendance.recordedById))
        .where(inArray(sessionAttendance.enrollmentId, enrollmentIds))
    : [];

  return {
    cohort: { ...cohort, programName: program?.name ?? "" },
    sessions,
    roster: roster.map((person) => {
      const theirs = marks.filter((m) => m.enrollmentId === person.enrollmentId);
      const attended = theirs.filter((m) =>
        ATTENDED_STATUSES.includes(m.status as AttendanceStatus),
      ).length;
      return {
        ...person,
        attended,
        excused: theirs.filter((m) => m.status === "excused").length,
        absent: theirs.filter((m) => m.status === "absent").length,
      };
    }),
    marks,
  };
}

// M14's actual requirement: "the PO's or whomever will need proof the
// person participated in the class." Dates and who marked them, not a
// summary number someone could have typed.
export async function participationRecord(db: Db, enrollmentId: string) {
  const [enrollment] = await db
    .select({
      id: cohortEnrollments.id,
      status: cohortEnrollments.status,
      enrolledAt: cohortEnrollments.enrolledAt,
      withdrawnReason: cohortEnrollments.withdrawnReason,
      participantId: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
      dateOfBirth: participants.dateOfBirth,
      cohortId: programCohorts.id,
      cohortName: programCohorts.name,
      requiredSessions: programCohorts.requiredSessions,
      programName: programs.name,
    })
    .from(cohortEnrollments)
    .innerJoin(participants, eq(participants.id, cohortEnrollments.participantId))
    .innerJoin(programCohorts, eq(programCohorts.id, cohortEnrollments.cohortId))
    .innerJoin(programs, eq(programs.id, programCohorts.programId))
    .where(eq(cohortEnrollments.id, enrollmentId));

  if (!enrollment) throw notFound("Enrolment not found");

  const rows = await db
    .select({
      sessionDate: cohortSessions.sessionDate,
      topic: cohortSessions.topic,
      status: sessionAttendance.status,
      recordedAt: sessionAttendance.recordedAt,
      recordedByName: users.displayName,
    })
    .from(sessionAttendance)
    .innerJoin(cohortSessions, eq(cohortSessions.id, sessionAttendance.sessionId))
    .innerJoin(users, eq(users.id, sessionAttendance.recordedById))
    .where(eq(sessionAttendance.enrollmentId, enrollmentId))
    .orderBy(asc(cohortSessions.sessionDate));

  const attended = rows.filter((r) =>
    ATTENDED_STATUSES.includes(r.status as AttendanceStatus),
  ).length;

  const sessionsHeld = await db
    .select({ id: cohortSessions.id })
    .from(cohortSessions)
    .where(eq(cohortSessions.cohortId, enrollment.cohortId));

  return {
    enrollment,
    sessions: rows,
    attended,
    excused: rows.filter((r) => r.status === "excused").length,
    absent: rows.filter((r) => r.status === "absent").length,
    sessionsHeld: sessionsHeld.length,
    // A plain pass/fail reads wrong mid-course: someone with perfect
    // attendance at week 7 of 12 has not failed anything. Four states,
    // so a probation officer isn't handed "does not meet requirement"
    // about a person who hasn't missed a class.
    outcome: participationOutcome({
      requiredSessions: enrollment.requiredSessions,
      attended,
      sessionsHeld: sessionsHeld.length,
    }),
  };
}

// M14's "a grid where you mark a whole roster in one pass". One request
// for the class, not one per person, and re-marking corrects rather
// than duplicates.
export type ParticipationOutcome = "no_requirement" | "met" | "in_progress" | "short";

export function participationOutcome(input: {
  requiredSessions: number | null;
  attended: number;
  sessionsHeld: number;
}): ParticipationOutcome {
  // NMBM hasn't given a completion threshold, so a cohort without one
  // reports what happened and leaves the judgement to the reader.
  if (input.requiredSessions === null) return "no_requirement";
  if (input.attended >= input.requiredSessions) return "met";
  // Not enough classes have been held yet for anyone to have met it.
  if (input.sessionsHeld < input.requiredSessions) return "in_progress";
  return "short";
}

export async function markAttendance(
  db: Db,
  sessionId: string,
  input: AttendanceMark,
  actorId: string,
) {
  const [session] = await db
    .select()
    .from(cohortSessions)
    .where(eq(cohortSessions.id, sessionId));
  if (!session) throw notFound("Session not found");

  const rosterIds = (
    await db
      .select({ id: cohortEnrollments.id })
      .from(cohortEnrollments)
      .where(eq(cohortEnrollments.cohortId, session.cohortId))
  ).map((r) => r.id);

  // Marking somebody who isn't on this roster would put a class in
  // their record that they were never enrolled in.
  const stray = input.marks.filter((m) => !rosterIds.includes(m.enrollmentId));
  if (stray.length > 0) {
    throw badRequest(`${stray.length} mark(s) are for people not on this roster`);
  }

  await db.transaction(async (tx) => {
    for (const mark of input.marks) {
      await tx
        .insert(sessionAttendance)
        .values({
          sessionId,
          enrollmentId: mark.enrollmentId,
          status: mark.status,
          note: mark.note ?? null,
          recordedById: actorId,
        })
        .onConflictDoUpdate({
          target: [sessionAttendance.sessionId, sessionAttendance.enrollmentId],
          set: {
            status: mark.status,
            note: mark.note ?? null,
            recordedById: actorId,
            recordedAt: new Date(),
          },
        });
    }
  });

  await writeAudit(db, {
    actorUserId: actorId,
    action: "attendance.recorded",
    entityType: "session",
    entityId: sessionId,
    detail: `${input.marks.length} mark(s) for ${session.sessionDate}`,
  });

  return { sessionId, marked: input.marks.length };
}

export async function listEnrollmentsForParticipant(db: Db, participantId: string) {
  return db
    .select({
      enrollmentId: cohortEnrollments.id,
      status: cohortEnrollments.status,
      cohortId: programCohorts.id,
      cohortName: programCohorts.name,
      programName: programs.name,
      startDate: programCohorts.startDate,
    })
    .from(cohortEnrollments)
    .innerJoin(programCohorts, eq(programCohorts.id, cohortEnrollments.cohortId))
    .innerJoin(programs, eq(programs.id, programCohorts.programId))
    .where(eq(cohortEnrollments.participantId, participantId))
    .orderBy(desc(programCohorts.startDate));
}
