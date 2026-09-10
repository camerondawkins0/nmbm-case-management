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
} from "../schema/index.js";
import type { Payer, Role, ContactResult, CarePlanStatus } from "@nmbm/shared";
import { CARE_PLAN_REVIEW_INTERVAL_DAYS } from "@nmbm/shared";

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
    demonstrates: "M6 disenrollment threshold reached",
  },
  {
    first: "Dana",
    last: "Simmons",
    dob: "1996-01-19",
    payer: "medi_cal",
    worker: "t.green@nmbm.example.org",
    enrolledDaysAgo: 25,
    contacts: ["contacted"],
    demonstrates: "M9 30-day care plan countdown, 5 days left",
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
    demonstrates: "U6 sign-off chain — waiting on Clinical Director",
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
