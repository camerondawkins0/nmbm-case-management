import { eq } from "drizzle-orm";
import type { Db } from "@nmbm/db";
import { users, roles, userRoles, notes, assignments } from "@nmbm/db";
import type { Payer, Role, ContactResult } from "@nmbm/shared";
import { admitParticipant } from "../../src/modules/participants/intake.js";

// Every test builds the people it needs, with names nobody else uses, so
// tests don't depend on each other or on the demo seed.
let counter = 0;
export function unique(prefix = "t") {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function isoDaysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function staff(db: Db, role: Role | null, displayName?: string) {
  const handle = unique(role ?? "norole");
  const [user] = await db
    .insert(users)
    .values({ email: `${handle}@nmbm.example.org`, displayName: displayName ?? handle })
    .returning();
  if (role) {
    const [roleRow] = await db.select().from(roles).where(eq(roles.code, role));
    await db.insert(userRoles).values({ userId: user.id, roleId: roleRow.id });
  }
  return user;
}

// Through the real intake service: the record, the open episode and the
// assignment in one transaction, as the app creates them.
export async function admit(
  db: Db,
  opts: { workerId: string; actorId: string; payer?: Payer; startDate?: string },
) {
  const { participant, episode } = await admitParticipant(
    db,
    {
      firstName: "Test",
      lastName: unique("P"),
      dateOfBirth: "1980-01-01",
      payer: opts.payer ?? "medi_cal",
      assignedWorkerId: opts.workerId,
      startDate: opts.startDate ?? isoDaysAgo(10),
    },
    opts.actorId,
  );
  return { participantId: participant.id, episodeId: episode.id };
}

// Contact attempts in order, a minute apart, so "consecutive" is
// unambiguous. Inserted directly because the order is the point.
export async function contacts(
  db: Db,
  target: { participantId: string; episodeId: string; authorId: string },
  results: ContactResult[],
) {
  const base = Date.now() - results.length * 60_000 - 60_000;
  for (const [i, result] of results.entries()) {
    await db.insert(notes).values({
      participantId: target.participantId,
      episodeId: target.episodeId,
      authorId: target.authorId,
      contactResult: result,
      body: `attempt ${i + 1}`,
      createdAt: new Date(base + i * 60_000),
    });
  }
}

// Moves when an assignment ended, to put a closure N days in the past
// without waiting for it.
export async function backdateAssignmentEnd(db: Db, participantId: string, daysAgo: number) {
  await db
    .update(assignments)
    .set({ endedAt: new Date(Date.now() - daysAgo * 86_400_000) })
    .where(eq(assignments.participantId, participantId));
}
