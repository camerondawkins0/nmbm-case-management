import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { documents } from "@nmbm/db";
import { eq } from "drizzle-orm";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit, isoDaysAgo } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let chw: Client;
let chwId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  const w = await staff(db, "community_health_worker");
  chwId = w.id;
  chw = await signIn(app, w.email);
});
afterAll(async () => app?.close());

const PDF = Buffer.from("%PDF-1.4\n% a scanned consent form\n");

const request = (as: Client, participantId: string, extra: Record<string, unknown> = {}) =>
  as.post(`/api/participants/${participantId}/documents`, {
    filename: "release-signed.pdf",
    contentType: "application/pdf",
    sizeBytes: PDF.length,
    description: "Signed release of information",
    ...extra,
  });

// What the browser does with the upload instructions.
async function put(upload: { url: string; headers: Record<string, string> }, body: Buffer, headers = upload.headers) {
  return app.inject({ method: "PUT", url: upload.url, headers, payload: body });
}

async function uploaded(as: Client, participantId: string, extra: Record<string, unknown> = {}) {
  const req = await request(as, participantId, extra);
  expect(req.status).toBe(201);
  expect((await put(req.body.upload, PDF)).statusCode).toBe(200);
  const confirmed = await as.post(`/api/documents/${req.body.documentId}/confirm`);
  expect(confirmed.status).toBe(200);
  return req.body.documentId as string;
}

describe("uploading a document", () => {
  it("puts a file on the record only once storage has it", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const req = await request(chw, participantId);

    // Not on the record yet: the link exists, the file doesn't.
    expect((await chw.get(`/api/participants/${participantId}/documents`)).body).toEqual([]);
    expect((await chw.post(`/api/documents/${req.body.documentId}/confirm`)).status).toBe(409);

    expect((await put(req.body.upload, PDF)).statusCode).toBe(200);
    expect((await chw.post(`/api/documents/${req.body.documentId}/confirm`)).status).toBe(200);
    const list = (await chw.get(`/api/participants/${participantId}/documents`)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ description: "Signed release of information", status: "uploaded" });
  });

  it("opens the file through a signed link, and records that it was opened", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const id = await uploaded(chw, participantId);
    const { url } = (await chw.get(`/api/documents/${id}/download-url`)).body;
    const file = await app.inject({ method: "GET", url });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(PDF)).toBe(true);
    expect(file.headers["content-type"]).toBe("application/pdf");

    const admin = await signIn(app, (await staff(db, "system_administrator")).email);
    const audit = (await admin.get("/api/admin/audit?limit=20")).body as { action: string; entityId: string }[];
    expect(audit.some((e) => e.action === "document.viewed" && e.entityId === participantId)).toBe(true);
  });

  it("names the stored file with nothing that identifies the person", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const id = await uploaded(chw, participantId);
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row.storageKey).toMatch(/^documents\/[0-9a-f-]{36}$/);
    expect(row.storageKey).not.toContain(participantId);
  });

  it("attaches a scan to the consent it's a copy of — on the same person only", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const other = await admit(db, { workerId: chwId, actorId: chwId });
    const consent = await chw.post("/api/consents", {
      participantId: other.participantId,
      type: "release_of_information",
      formName: "Release",
      signedDate: isoDaysAgo(1),
    });
    expect((await request(chw, participantId, { consentId: consent.body.id })).status).toBe(422);
    const ownConsent = await chw.post("/api/consents", {
      participantId,
      type: "release_of_information",
      formName: "Release",
      signedDate: isoDaysAgo(1),
    });
    await uploaded(chw, participantId, { consentId: ownConsent.body.id });
    const [doc] = (await chw.get(`/api/participants/${participantId}/documents`)).body;
    expect(doc.consentFormName).toBe("Release");
  });
});

describe("what can be uploaded", () => {
  it.each([
    ["text/html", 1000],
    ["image/svg+xml", 1000],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1000],
    ["application/pdf", 11 * 1024 * 1024],
  ])("refuses %s of %d bytes", async (contentType, sizeBytes) => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    expect((await request(chw, participantId, { contentType, sizeBytes })).status).toBe(400);
  });

  // The signature carries the type and size, so the browser can't swap
  // in something else after the server agreed to a PDF.
  it("refuses an upload that doesn't match what was signed", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const { upload } = (await request(chw, participantId)).body;
    expect((await put(upload, PDF, { "content-type": "text/html" })).statusCode).toBe(403);
    expect((await put({ ...upload, url: upload.url.replace(/sig=[^&]+/, "sig=forged") }, PDF)).statusCode).toBe(403);
    expect((await put(upload, Buffer.alloc(11 * 1024 * 1024))).statusCode).toBe(413);
  });
});

describe("who can see documents", () => {
  it("keeps them to people who can see the participant", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const id = await uploaded(chw, participantId);
    const other = await signIn(app, (await staff(db, "community_health_worker")).email);
    expect((await other.get(`/api/participants/${participantId}/documents`)).status).toBe(404);
    expect((await other.get(`/api/documents/${id}/download-url`)).status).toBe(404);
    expect((await request(other, participantId)).status).toBe(404);
  });

  it("doesn't let a read-only role upload", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const qa = await signIn(app, (await staff(db, "quality_assurance_coordinator")).email);
    expect((await request(qa, participantId)).status).toBe(403);
  });
});

describe("voiding, not deleting", () => {
  it("keeps the row and the reason, and stops the file being opened", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: chwId });
    const id = await uploaded(chw, participantId);
    expect((await chw.post(`/api/documents/${id}/void`, {})).status).toBe(400);
    expect((await chw.post(`/api/documents/${id}/void`, { reason: "Filed on the wrong person" })).status).toBe(200);

    const [doc] = (await chw.get(`/api/participants/${participantId}/documents`)).body;
    expect(doc).toMatchObject({ status: "voided", voidReason: "Filed on the wrong person" });
    expect((await chw.get(`/api/documents/${id}/download-url`)).status).toBe(409);
  });
});
