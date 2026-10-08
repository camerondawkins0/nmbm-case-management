import type { Db } from "@nmbm/db";
import { documents, consents, users } from "@nmbm/db";
import { and, desc, eq, ne } from "drizzle-orm";
import { DOCUMENT_MAX_BYTES, type DocumentUpload } from "@nmbm/shared";
import { conflict, notFound, unprocessable } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";
import { opaqueKey, type StorageProvider } from "../../lib/storage.js";

// What a record shows: uploaded and voided files, never pending ones —
// a pending row is an upload link that may never have been used.
export async function listForParticipant(db: Db, participantId: string) {
  return db
    .select({
      id: documents.id,
      description: documents.description,
      consentId: documents.consentId,
      consentFormName: consents.formName,
      originalFilename: documents.originalFilename,
      contentType: documents.contentType,
      sizeBytes: documents.sizeBytes,
      status: documents.status,
      uploadedAt: documents.uploadedAt,
      uploadedByName: users.displayName,
      voidedAt: documents.voidedAt,
      voidReason: documents.voidReason,
    })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.uploadedById))
    .leftJoin(consents, eq(consents.id, documents.consentId))
    .where(and(eq(documents.participantId, participantId), ne(documents.status, "pending")))
    .orderBy(desc(documents.uploadedAt));
}

export async function findDocument(db: Db, id: string) {
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  if (!row) throw notFound("Document not found");
  return row;
}

// Step one: a row and a signed link the browser uploads to directly, so
// the file never passes through this server. The link carries the type
// and size cap, so storage refuses anything else.
export async function requestUpload(
  db: Db,
  storage: StorageProvider,
  participantId: string,
  input: DocumentUpload,
  actorId: string,
) {
  if (input.consentId) {
    const [consent] = await db.select().from(consents).where(eq(consents.id, input.consentId));
    // A scan attached to somebody else's consent would put one person's
    // signature on another's record.
    if (!consent || consent.participantId !== participantId) {
      throw unprocessable("That consent form isn't on this participant's record");
    }
  }
  const storageKey = opaqueKey();
  const [row] = await db
    .insert(documents)
    .values({
      participantId,
      consentId: input.consentId ?? null,
      description: input.description,
      storageKey,
      originalFilename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      uploadedById: actorId,
    })
    .returning({ id: documents.id });
  const upload = await storage.createUploadUrl(storageKey, input.contentType, DOCUMENT_MAX_BYTES);
  return { documentId: row.id, upload };
}

// Step two: the browser says it's done, and the server checks storage
// rather than taking its word. Only then is the file on the record.
export async function confirmUpload(db: Db, storage: StorageProvider, id: string, actorId: string) {
  const doc = await findDocument(db, id);
  if (doc.status !== "pending") throw conflict("This upload has already been confirmed");
  if (doc.uploadedById !== actorId) throw conflict("Only the person who started an upload can confirm it");

  const stored = await storage.stat(doc.storageKey);
  if (!stored) throw conflict("The file hasn't arrived in storage — try the upload again");
  if (stored.size > DOCUMENT_MAX_BYTES) throw unprocessable("File is larger than allowed");

  const [row] = await db
    .update(documents)
    .set({ status: "uploaded", uploadedAt: new Date(), sizeBytes: stored.size })
    .where(eq(documents.id, id))
    .returning();
  await writeAudit(db, {
    actorUserId: actorId,
    action: "document.uploaded",
    entityType: "participant",
    entityId: doc.participantId,
    detail: `${doc.description} (${doc.contentType}, ${stored.size} bytes)`,
  });
  return row;
}

// Opening a client's document is a meaningful access event, so every
// link handed out is written to the audit log — who looked, at what,
// and when — not only changes.
export async function downloadUrl(db: Db, storage: StorageProvider, id: string, actorId: string) {
  const doc = await findDocument(db, id);
  if (doc.status === "pending") throw notFound("Document not found");
  // Voided usually means "filed against the wrong person". Keeping it
  // openable would keep one client's paperwork viewable on another's
  // record; the file is retained, but not handed out from here.
  if (doc.status === "voided") throw conflict("This document was voided and can't be opened");
  const url = await storage.createDownloadUrl(doc.storageKey, doc.originalFilename, doc.contentType);
  await writeAudit(db, {
    actorUserId: actorId,
    action: "document.viewed",
    entityType: "participant",
    entityId: doc.participantId,
    detail: doc.description,
  });
  return { url };
}

export async function voidDocument(db: Db, id: string, reason: string, actorId: string) {
  const doc = await findDocument(db, id);
  if (doc.status !== "uploaded") throw conflict("Only an uploaded document can be voided");
  const [row] = await db
    .update(documents)
    .set({ status: "voided", voidedAt: new Date(), voidedById: actorId, voidReason: reason })
    .where(eq(documents.id, id))
    .returning();
  await writeAudit(db, {
    actorUserId: actorId,
    action: "document.voided",
    entityType: "participant",
    entityId: doc.participantId,
    detail: `${doc.description}: ${reason}`,
  });
  return row;
}
