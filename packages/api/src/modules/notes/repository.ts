import type { Db } from "@nmbm/db";
import { notes, vNoContactCounts, participants, episodes } from "@nmbm/db";
import { eq, and } from "drizzle-orm";
import type { NoteCreate } from "@nmbm/shared";

export async function insert(db: Db, input: NoteCreate, authorId: string) {
  const [row] = await db
    .insert(notes)
    .values({
      participantId: input.participantId,
      episodeId: input.episodeId,
      authorId,
      contactResult: input.contactResult,
      body: input.body,
    })
    .returning();
  return row;
}

export async function consecutiveNoContacts(db: Db, participantId: string): Promise<number> {
  const [row] = await db
    .select({ count: vNoContactCounts.consecutiveNoContacts })
    .from(vNoContactCounts)
    .where(eq(vNoContactCounts.participantId, participantId));
  return row?.count ?? 0;
}

export async function participantPayer(db: Db, participantId: string) {
  const [row] = await db
    .select({ payer: participants.payer })
    .from(participants)
    .where(eq(participants.id, participantId));
  return row?.payer ?? null;
}

export async function openEpisodeFor(db: Db, participantId: string) {
  const [row] = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.participantId, participantId), eq(episodes.status, "open")));
  return row;
}
