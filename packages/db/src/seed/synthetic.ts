import { eq } from "drizzle-orm";
import { createDb } from "../client.js";
import {
  users,
  roles,
  userRoles,
  participants,
  assignments,
  episodes,
  notes,
  carePlans,
  consents,
  referrals,
  programs,
  programCohorts,
  cohortSessions,
  cohortEnrollments,
  sessionAttendance,
} from "../schema/index.js";
import type { Payer, Role, ContactResult, CarePlanStatus } from "@nmbm/shared";
import { CARE_PLAN_REVIEW_INTERVAL_DAYS, CONSENT_VALID_DAYS } from "@nmbm/shared";

// Invented staff and participants for local development and demos. No
// real person appears here — every name, email and note is made up, and
// the domain is example.org so nothing can accidentally reach a real
// inbox.
//
// The data is shaped on purpose: each participant below demonstrates one
// of the rules NMBM described (M6's no-contact ladder, M9's two care
// plan clocks, U6's sign-off chain), so the screens show the rules
// working rather than an empty table.

const STAFF: { email: string; name: string; role: Role }[] = [
  { email: "r.alvarez@nmbm.example.org", name: "Renee Alvarez", role: "clinical_director" },
  { email: "m.bell@nmbm.example.org", name: "Marcus Bell", role: "program_manager" },
  { email: "t.green@nmbm.example.org", name: "Tasha Green", role: "community_health_worker" },
  { email: "l.ortega@nmbm.example.org", name: "Luis Ortega", role: "community_health_worker" },
  { email: "p.nair@nmbm.example.org", name: "Priya Nair", role: "intake_specialist" },
  { email: "d.fowler@nmbm.example.org", name: "Denise Fowler", role: "quality_assurance_coordinator" },
  { email: "admin@nmbm.example.org", name: "Sam Okafor", role: "system_administrator" },
];

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

type Fixture = {
  first: string;
  last: string;
  dob: string;
  payer: Payer;
  worker: string;
  enrolledDaysAgo: number;
  // Trailing contact attempts, oldest first. The view counts the run of
  // no_contact entries since the last successful contact.
  contacts: ContactResult[];
  carePlan?: { status: CarePlanStatus; reviewDueDaysAgo: number; goals: string };
  // M15/M16: "release" is what authorises a referral. "expired" puts
  // one on file that no longer does, so the gate has something real to
  // refuse.
  release?: "valid" | "expired" | "none";
  referral?: { partner: string; service: string; outcome: boolean; daysAgo: number };
  demonstrates: string;
};

const FIXTURES: Fixture[] = [
  {
    first: "Andre",
    last: "Willis",
    dob: "1984-03-12",
    payer: "medi_cal",
    worker: "t.green@nmbm.example.org",
    enrolledDaysAgo: 60,
    contacts: ["contacted", "no_contact", "contacted"],
    carePlan: { status: "approved", reviewDueDaysAgo: -3, goals: "Stable housing application submitted; diabetes check-ins every two weeks." },
    release: "valid",
    referral: { partner: "Long Beach Housing Collaborative", service: "Housing navigation", outcome: true, daysAgo: 30 },
    demonstrates: "healthy case — plan approved, review not yet due",
  },
  {
    first: "Brenda",
    last: "Cole",
    dob: "1991-11-02",
    payer: "molina",
    worker: "t.green@nmbm.example.org",
    enrolledDaysAgo: 45,
    contacts: ["contacted", "no_contact", "no_contact", "no_contact"],
    carePlan: { status: "approved", reviewDueDaysAgo: 2, goals: "Re-establish contact; confirm asthma medication refill." },
    demonstrates: "M6 warning threshold + Molina letter required",
  },
  {
    first: "Curtis",
    last: "Ray",
    dob: "1978-07-25",
    payer: "kaiser",
    worker: "t.green@nmbm.example.org",
    enrolledDaysAgo: 80,
    contacts: ["contacted", "no_contact", "no_contact", "no_contact", "no_contact", "no_contact"],
    carePlan: { status: "approved", reviewDueDaysAgo: 21, goals: "Transportation to dialysis appointments." },
    release: "expired",
    demonstrates: "M6 disenrollment threshold reached; M15 expired release blocks a new referral",
  },
  {
    first: "Dana",
    last: "Simmons",
    dob: "1996-01-19",
    payer: "medi_cal",
    worker: "t.green@nmbm.example.org",
    enrolledDaysAgo: 25,
    contacts: ["contacted"],
    release: "none",
    demonstrates: "M9 30-day countdown; M15 no release on file at all",
  },
  {
    first: "Evelyn",
    last: "Tran",
    dob: "1959-09-08",
    payer: "medicare",
    worker: "t.green@nmbm.example.org",
    enrolledDaysAgo: 41,
    contacts: ["contacted", "contacted"],
    demonstrates: "M9 30-day care plan deadline missed",
  },
  {
    first: "Frank",
    last: "Mosley",
    dob: "1988-05-30",
    payer: "molina",
    worker: "t.green@nmbm.example.org",
    enrolledDaysAgo: 20,
    contacts: ["contacted"],
    carePlan: { status: "pending_review", reviewDueDaysAgo: -10, goals: "Food assistance enrollment; follow up on blood pressure readings." },
    release: "valid",
    referral: { partner: "Wilmington Food Bank", service: "Food assistance", outcome: false, daysAgo: 21 },
    demonstrates: "U6 sign-off chain; M17 referral with no outcome after 21 days",
  },
  {
    first: "Gloria",
    last: "Reyes",
    dob: "1972-12-14",
    payer: "blue_shield",
    worker: "l.ortega@nmbm.example.org",
    enrolledDaysAgo: 33,
    contacts: ["contacted", "no_contact"],
    carePlan: { status: "needs_revision", reviewDueDaysAgo: -6, goals: "Goals need measurable targets before approval." },
    demonstrates: "U6 returned for revision",
  },
  {
    first: "Hector",
    last: "Diaz",
    dob: "1965-02-21",
    payer: "la_health_net",
    worker: "l.ortega@nmbm.example.org",
    enrolledDaysAgo: 12,
    contacts: ["contacted"],
    carePlan: { status: "draft", reviewDueDaysAgo: -14, goals: "Initial goals drafted after intake visit." },
    demonstrates: "another worker's caseload — should be invisible to Tasha",
  },
];

const NOTE_BODIES: Record<ContactResult, string[]> = {
  contacted: [
    "Home visit completed. Reviewed medication list and confirmed next clinic appointment.",
    "Spoke by phone. Client reports transportation is the main barrier this month.",
    "Met at the office. Updated contact details and went over care plan goals.",
  ],
  no_contact: [
    "Called twice, no answer. Left a voicemail with the office number.",
    "Knocked at the listed address, no response. Left a card.",
    "Text message sent, no reply after 48 hours.",
  ],
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = createDb(url);

  const existing = await db.select().from(participants);
  if (existing.length > 0) {
    console.log(`Skipped: ${existing.length} participant(s) already present. Use a fresh database.`);
    process.exit(0);
  }

  const roleRows = await db.select().from(roles);
  if (roleRows.length === 0) {
    throw new Error("No roles found — run seed:reference first");
  }
  const roleId = new Map(roleRows.map((r) => [r.code, r.id]));

  const staffByEmail = new Map<string, string>();
  for (const person of STAFF) {
    const [row] = await db
      .insert(users)
      .values({ email: person.email, displayName: person.name })
      .returning();
    await db.insert(userRoles).values({ userId: row.id, roleId: roleId.get(person.role)! });
    staffByEmail.set(person.email, row.id);
  }

  const supervisorId = staffByEmail.get("m.bell@nmbm.example.org")!;
  const clinicalDirectorId = staffByEmail.get("r.alvarez@nmbm.example.org")!;

  for (const fixture of FIXTURES) {
    const workerId = staffByEmail.get(fixture.worker)!;

    const [participant] = await db
      .insert(participants)
      .values({
        firstName: fixture.first,
        lastName: fixture.last,
        dateOfBirth: fixture.dob,
        payer: fixture.payer,
      })
      .returning();

    await db.insert(assignments).values({
      participantId: participant.id,
      workerId,
      assignedById: supervisorId,
      startedAt: daysAgo(fixture.enrolledDaysAgo),
    });

    const startDate = daysAgo(fixture.enrolledDaysAgo);
    const carePlanDue = new Date(startDate);
    carePlanDue.setDate(carePlanDue.getDate() + 30);

    const [episode] = await db
      .insert(episodes)
      .values({
        participantId: participant.id,
        startDate: isoDate(startDate),
        carePlanDueDate: isoDate(carePlanDue),
        createdAt: startDate,
      })
      .returning();

    // Spread the attempts across the episode, oldest first, so the run
    // of trailing no-contacts lands in the order the view counts.
    for (const [index, result] of fixture.contacts.entries()) {
      const when = daysAgo(Math.max(fixture.enrolledDaysAgo - index * 3, 0));
      const bodies = NOTE_BODIES[result];
      const supervisorApproved = result === "contacted" && index === 0;
      await db.insert(notes).values({
        participantId: participant.id,
        episodeId: episode.id,
        authorId: workerId,
        contactResult: result,
        body: bodies[index % bodies.length],
        createdAt: when,
        approvedById: supervisorApproved ? supervisorId : null,
        approvedAt: supervisorApproved ? when : null,
      });
    }

    if (fixture.release && fixture.release !== "none") {
      const signed = daysAgo(fixture.enrolledDaysAgo - 1);
      // M16 anchors expiry to enrolment. The "expired" fixture is
      // backdated so its window has already closed.
      const anchor =
        fixture.release === "expired" ? daysAgo(CONSENT_VALID_DAYS + 40) : startDate;
      const expires = new Date(anchor);
      expires.setDate(expires.getDate() + CONSENT_VALID_DAYS);

      const [consent] = await db
        .insert(consents)
        .values({
          participantId: participant.id,
          episodeId: episode.id,
          type: "release_of_information",
          formName: "Authorisation to release information",
          signedDate: isoDate(signed),
          expiresDate: isoDate(expires),
          recordedById: workerId,
        })
        .returning();

      if (fixture.referral) {
        const referredAt = daysAgo(fixture.referral.daysAgo);
        await db.insert(referrals).values({
          participantId: participant.id,
          episodeId: episode.id,
          partnerName: fixture.referral.partner,
          serviceType: fixture.referral.service,
          reason: "Requested at the last home visit.",
          consentId: consent.id,
          referredById: workerId,
          referredAt,
          status: fixture.referral.outcome ? "completed" : "sent",
          outcomeNote: fixture.referral.outcome
            ? "Partner confirmed the client was enrolled and attended intake."
            : null,
          outcomeRecordedById: fixture.referral.outcome ? supervisorId : null,
          outcomeRecordedAt: fixture.referral.outcome ? daysAgo(fixture.referral.daysAgo - 10) : null,
        });
      }
    }

    if (fixture.carePlan) {
      const reviewDue = new Date();
      reviewDue.setDate(reviewDue.getDate() - fixture.carePlan.reviewDueDaysAgo);
      await db.insert(carePlans).values({
        participantId: participant.id,
        episodeId: episode.id,
        status: fixture.carePlan.status,
        goals: fixture.carePlan.goals,
        nextReviewDue: isoDate(reviewDue),
        reviewNote:
          fixture.carePlan.status === "needs_revision"
            ? "Goals need measurable targets and a review date before I can approve."
            : null,
        approvedById: fixture.carePlan.status === "approved" ? clinicalDirectorId : null,
        approvedAt: fixture.carePlan.status === "approved" ? daysAgo(fixture.enrolledDaysAgo - 10) : null,
      });
    }
  }

  // M14: Anger Management is the programme NMBM said is running now.
  // Domestic Violence is seeded as planned-but-not-started, because
  // it's waiting on LA County approval.
  const [angerManagement] = await db
    .insert(programs)
    .values({
      name: "Anger Management",
      description: "Weekly group. Attendance is evidence for probation officers and the courts.",
    })
    .returning();
  const [domesticViolence] = await db
    .insert(programs)
    .values({
      name: "Domestic Violence",
      description: "Not yet running — awaiting LA County approval (discovery R5).",
    })
    .returning();

  const facilitatorId = staffByEmail.get("r.alvarez@nmbm.example.org")!;
  const [cohort] = await db
    .insert(programCohorts)
    .values({
      programId: angerManagement.id,
      name: "Anger Management — Autumn 2026",
      startDate: isoDate(daysAgo(42)),
      facilitatorId,
      // A real number here would come from NMBM; 12 is a placeholder so
      // the progress display has something to count against.
      requiredSessions: 12,
      status: "running",
    })
    .returning();

  await db.insert(programCohorts).values({
    programId: domesticViolence.id,
    name: "Domestic Violence — pending approval",
    startDate: isoDate(daysAgo(-30)),
    status: "planned",
  });

  // Six weekly classes so far.
  const sessionRows = [];
  for (let week = 6; week >= 1; week -= 1) {
    const [row] = await db
      .insert(cohortSessions)
      .values({
        cohortId: cohort.id,
        sessionDate: isoDate(daysAgo(week * 7)),
        topic: [
          "Ground rules and triggers",
          "Recognising escalation",
          "Time-outs and self-talk",
          "Communication under stress",
          "Repair after conflict",
          "Relapse planning",
        ][6 - week],
      })
      .returning();
    sessionRows.push(row);
  }

  // Three of the caseload attend the group, with deliberately different
  // records: near-perfect, patchy, and one who withdrew.
  const attendees: { last: string; pattern: ("present" | "late" | "excused" | "absent")[] }[] = [
    { last: "Willis", pattern: ["present", "present", "present", "late", "present", "present"] },
    { last: "Mosley", pattern: ["present", "absent", "present", "excused", "absent", "present"] },
    { last: "Reyes", pattern: ["present", "present", "absent", "absent", "absent", "absent"] },
  ];

  for (const attendee of attendees) {
    const [person] = await db
      .select()
      .from(participants)
      .where(eq(participants.lastName, attendee.last));
    if (!person) continue;

    const [enrollment] = await db
      .insert(cohortEnrollments)
      .values({
        cohortId: cohort.id,
        participantId: person.id,
        status: attendee.last === "Reyes" ? "withdrawn" : "enrolled",
        withdrawnAt: attendee.last === "Reyes" ? daysAgo(9) : null,
        withdrawnReason:
          attendee.last === "Reyes" ? "Stopped attending after the third week." : null,
      })
      .returning();

    for (const [index, status] of attendee.pattern.entries()) {
      await db.insert(sessionAttendance).values({
        sessionId: sessionRows[index].id,
        enrollmentId: enrollment.id,
        status,
        recordedById: facilitatorId,
        recordedAt: daysAgo((6 - index) * 7),
      });
    }
  }

  console.log(
    `Synthetic data seeded: ${STAFF.length} staff, ${FIXTURES.length} participants.\n` +
      `Dev login: /auth/dev-login?email=t.green@nmbm.example.org (CHW) or r.alvarez@nmbm.example.org (Clinical Director)`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
