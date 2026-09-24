import type { Db } from "@nmbm/db";
import { notes, participants, users } from "@nmbm/db";
import { eq, desc, and, ne } from "drizzle-orm";
import { conflict, badRequest, notFound } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";

// U6's other half. Approval columns existed from the first migration,
// but nothing could reach them — notes.approve was granted to the
// Program Manager and Clinical Director and then never checked.

export async function listAwaitingReview(db: Db) {
  return db
    .select({
      id: notes.id,
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
    .where(eq(notes.status, "pending_review"))
    .orderBy(desc(notes.createdAt));
}

// What the author needs to see: their own work that bounced.
export async function listReturnedToAuthor(db: Db, authorId: string) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
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

async function load(db: Db, id: string) {
  const [note] = await db.select().from(notes).where(eq(notes.id, id));
  if (!note) throw notFound("Note not found");
  return note;
}

export async function approve(db: Db, id: string, reviewerId: string) {
  const note = await load(db, id);
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
) {
  const note = await load(db, id);
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
export async function reviseAndResubmit(db: Db, id: string, authorId: string, body: string) {
  const note = await load(db, id);
  if (note.authorId !== authorId) throw conflict("Only the author can revise this note");
  if (note.status === "approved") throw conflict("An approved note can't be edited");

  const [row] = await db
    .update(notes)
    .set({ body, status: "pending_review", reviewNote: null })
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

// Counts the reviewer's queue without pulling every row.
export async function pendingCount(db: Db, excludeAuthorId: string) {
  const rows = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.status, "pending_review"), ne(notes.authorId, excludeAuthorId)));
  return rows.length;
}
