import { pgTable, uuid, text, date, timestamp, boolean, integer, unique } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { users } from "./users.js";
import { cohortStatusEnum, cohortEnrollmentStatusEnum, attendanceStatusEnum } from "./enums.js";

// M14. The roster exists to answer a question asked from outside the
// organisation — "did this person attend?" — so every mark carries who
// recorded it and when.
export const programs = pgTable("programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programCohorts = pgTable("program_cohorts", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id").notNull().references(() => programs.id),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  facilitatorId: uuid("facilitator_id").references(() => users.id),
  // Nullable: NMBM hasn't said how many sessions completion takes, and
  // court-mandated programmes usually have a number. Until they give
  // it, the system counts without judging.
  requiredSessions: integer("required_sessions"),
  status: cohortStatusEnum("status").notNull().default("planned"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cohortSessions = pgTable("cohort_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  cohortId: uuid("cohort_id").notNull().references(() => programCohorts.id),
  sessionDate: date("session_date").notNull(),
  topic: text("topic"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cohortEnrollments = pgTable(
  "cohort_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cohortId: uuid("cohort_id").notNull().references(() => programCohorts.id),
    participantId: uuid("participant_id").notNull().references(() => participants.id),
    status: cohortEnrollmentStatusEnum("status").notNull().default("enrolled"),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnReason: text("withdrawn_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ oncePerCohort: unique().on(t.cohortId, t.participantId) }),
);

export const sessionAttendance = pgTable(
  "session_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => cohortSessions.id),
    // Keyed on the enrolment: you can only be marked for a class you
    // were on the roster for.
    enrollmentId: uuid("enrollment_id").notNull().references(() => cohortEnrollments.id),
    status: attendanceStatusEnum("status").notNull(),
    note: text("note"),
    recordedById: uuid("recorded_by_id").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ oncePerSession: unique().on(t.sessionId, t.enrollmentId) }),
);
