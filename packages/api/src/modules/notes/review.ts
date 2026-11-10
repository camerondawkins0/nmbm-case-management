import type { Db } from "@nmbm/db";
import { episodes, notes, participants, users } from "@nmbm/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import type { NoteRevise, Permission } from "@nmbm/shared";
import { assertServiceDate } from "./service.js";
import { keepVisible } from "../../lib/caseload.js";
import { conflict, badRequest, forbidden, notFound } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";

// U6's other half. Approval columns existed from the first migration,
// but nothing could reach them — notes.approve was granted to the
// Program Manager and Clinical Director and then never checked.

// U6 has two chains: a CHW supervisor signs off CHW notes, the Clinical
// Director signs off interns'. Which one a note is in was fixed when it
// was written (notes.clinical_review); which ones a reviewer may sign is
// what they hold. Each sees only the queue they can act on.
export function reviewableKinds(held: Set<Permission>) {
  const kinds: boolean[] = [];
  if (held.has("notes.approve")) kinds.push(false);
  if (held.has("notes.approve.clinical")) kinds.push(true);
  return kinds;
}

function assertMayReview(note: { clinicalReview: boolean }, held: Set<Permission>) {
  if (reviewableKinds(held).includes(note.clinicalReview)) return;
  throw forbidden(
    note.clinicalReview
      ? "This note goes to clinical review. Someone who can review clinical notes signs it off."
      : "This note is signed off by a CHW supervisor, not by clinical review.",
  );
}

export async function listAwaitingReview(db: Db, held: Set<Permission>, visible: Set<string> | "all") {
  const kinds = reviewableKinds(held);
  if (kinds.length === 0) return [];
  const rows = await db
    .select({
      id: notes.id,
      clinicalReview: notes.clinicalReview,
      serviceDate: notes.serviceDate,
      body: notes.body,
      contactResult: notes.contactResult,
      createdAt: notes.createdAt,
      authorName: users.displayName,
      participantId: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
    })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .innerJoin(participants, eq(participants.id, notes.participantId))
    .where(and(eq(notes.status, "pending_review"), inArray(notes.clinicalReview, kinds)))
    .orderBy(desc(notes.serviceDate), desc(notes.createdAt));
  // Reviewing a note is reading the record it's on.
  return keepVisible(rows, visible);
}

// What the author needs to see: their own work that bounced.
export async function listReturnedToAuthor(db: Db, authorId: string) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      serviceDate: notes.serviceDate,
      reviewNote: notes.reviewNote,
      createdAt: notes.createdAt,
      participantId: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
    })
    .from(notes)
    .innerJoin(participants, eq(participants.id, notes.participantId))
    .where(and(eq(notes.authorId, authorId), eq(notes.status, "needs_revision")))
    .orderBy(desc(notes.createdAt));
}

export async function findNote(db: Db, id: string) {
  return load(db, id);
}

async function load(db: Db, id: string) {
  const [note] = await db.select().from(notes).where(eq(notes.id, id));
  if (!note) throw notFound("Note not found");
  return note;
}

export async function approve(db: Db, id: string, reviewerId: string, held: Set<Permission>) {
  const note = await load(db, id);
  assertMayReview(note, held);
  if (note.status === "approved") throw conflict("Already approved");
  // A reviewer signing off their own note defeats the point of the
  // chain — U6 describes a supervisor reviewing someone else's work.
  if (note.authorId === reviewerId) {
    throw conflict("A note can't be approved by the person who wrote it");
  }

  const [row] = await db
    .update(notes)
    .set({ status: "approved", approvedById: reviewerId, approvedAt: new Date(), reviewNote: null })
    .where(eq(notes.id, id))
    .returning();

  await writeAudit(db, {
    actorUserId: reviewerId,
    action: "note.approved",
    entityType: "note",
    entityId: id,
  });
  return row;
}

export async function returnForRevision(
  db: Db,
  id: string,
  reviewerId: string,
  reviewNote: string | undefined,
  held: Set<Permission>,
) {
  const note = await load(db, id);
  assertMayReview(note, held);
  if (note.status === "needs_revision") throw conflict("Already returned");
  if (!reviewNote) throw badRequest("Say why the note is being returned");

  const [row] = await db
    .update(notes)
    .set({ status: "needs_revision", reviewNote, approvedById: null, approvedAt: null })
    .where(eq(notes.id, id))
    .returning();

  await writeAudit(db, {
    actorUserId: reviewerId,
    action: "note.returned",
    entityType: "note",
    entityId: id,
    detail: reviewNote,
  });
  return row;
}

// Editing a returned note resubmits it — the author shouldn't have to
// find a separate "submit" button after fixing what was asked for.
export async function reviseAndResubmit(db: Db, id: string, authorId: string, input: NoteRevise) {
  const note = await load(db, id);
  if (note.authorId !== authorId) throw conflict("Only the author can revise this note");
  if (note.status === "approved") throw conflict("An approved note can't be edited");
  if (input.serviceDate) {
    const [episode] = await db.select({ startDate: episodes.startDate }).from(episodes).where(eq(episodes.id, note.episodeId));
    assertServiceDate(input.serviceDate, episode.startDate);
  }

  const [row] = await db
    .update(notes)
    .set({ body: input.body, ...(input.serviceDate ? { serviceDate: input.serviceDate } : {}), status: "pending_review", reviewNote: null })
    .where(eq(notes.id, id))
    .returning();

  await writeAudit(db, {
    actorUserId: authorId,
    action: "note.revised",
    entityType: "note",
    entityId: id,
  });
  return row;
}
