import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { consents } from "@nmbm/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { startApp, signIn, client, type Client } from "./support/app.js";
import { staff, staffWith, admit, unique, isoDaysAgo, backdateEpisodeEnd } from "./support/fixtures.js";

// Every request here is what somebody could type into the address bar or
// send with curl: a real session, the permission the route asks for, and
// the id of a client who isn't theirs. The UI never offers these; the
// server has to refuse them anyway.

let app: FastifyInstance;
let db: Db;
let director: Client;
let directorId: string;
let owner: Client;
let ownerId: string;
let outsider: Client;
// Client X: on the owner's caseload, with something of everything.
const x = {} as {
  participantId: string;
  episodeId: string;
  noteId: string;
  carePlanId: string;
  consentId: string;
  referralId: string;
  cohortId: string;
  enrollmentId: string;
  formId: string;
  assessmentId: string;
  documentId: string;
};

beforeAll(async () => {
  ({ app, db } = await startApp());
  const d = await staff(db, "clinical_director");
  directorId = d.id;
  director = await signIn(app, d.email);
  const o = await staff(db, "community_health_worker");
  ownerId = o.id;
  owner = await signIn(app, o.email);
  outsider = await signIn(app, (await staff(db, "community_health_worker")).email);

  Object.assign(x, await admit(db, { workerId: ownerId, actorId: directorId }));
  const ids = { participantId: x.participantId, episodeId: x.episodeId };
  x.noteId = (await owner.post("/api/notes", { ...ids, contactResult: "contacted", body: "Visit." })).body.note.id;
  x.carePlanId = (await owner.post("/api/care-plans", { ...ids, goals: "Housing." })).body.id;
  await owner.post(`/api/care-plans/${x.carePlanId}/submit`);
  x.consentId = (
    await owner.post("/api/consents", { participantId: x.participantId, type: "release_of_information", formName: "ROI", signedDate: isoDaysAgo(5) })
  ).body.id;
  x.referralId = (await owner.post("/api/referrals", { participantId: x.participantId, partnerName: "Food bank", serviceType: "Food" })).body.id;
  const program = await director.post("/api/programs", { name: unique("Program ") });
  x.cohortId = (await director.post("/api/cohorts", { programId: program.body.id, name: unique("Cohort "), startDate: isoDaysAgo(3) })).body.id;
  x.enrollmentId = (await director.post(`/api/cohorts/${x.cohortId}/enrollments`, { participantId: x.participantId })).body.id;
  const form = await director.post("/api/assessment-forms", { name: unique("Form ") });
  const questions = [{ stableId: randomUUID(), type: "short_text", prompt: "How are you?", required: false, options: [] }];
  await director.put(`/api/assessment-versions/${form.body.draftVersionId}/questions`, { questions });
  await director.post(`/api/assessment-versions/${form.body.draftVersionId}/publish`);
  x.formId = form.body.id;
  x.assessmentId = (await owner.post(`/api/participants/${x.participantId}/assessments`, { formId: x.formId, mode: "with_staff" })).body.id;
  x.documentId = (
    await owner.post(`/api/participants/${x.participantId}/documents`, { filename: "id.pdf", contentType: "application/pdf", sizeBytes: 10, description: "ID" })
  ).body.documentId;
  for (const id of Object.values(x)) expect(id).toBeTruthy();
});
afterAll(async () => app?.close());

// Out of reach is answered as missing: always a 404.
const refused = (status: number) => expect(status).toBe(404);

describe("another case manager, holding the same permissions", () => {
  it("can't read the record or anything on it", async () => {
    const p = x.participantId;
    for (const url of [
      `/api/participants/${p}`,
      `/api/participants/${p}/documents`,
      `/api/participants/${p}/assessments`,
      `/api/enrollments/${x.enrollmentId}/participation`,
    ]) {
      refused((await outsider.get(url)).status);
    }
    const search = (await outsider.get(`/api/participants/search?dob=1980-01-01`)).body as { id: string }[];
    expect(search.map((r) => r.id)).not.toContain(p);
  });

  it("can't write anything onto it", async () => {
    const p = x.participantId;
    const ids = { participantId: p, episodeId: x.episodeId };
    const attempts = [
      outsider.post("/api/notes", { ...ids, contactResult: "no_contact", body: "x" }),
      outsider.post("/api/care-plans", { ...ids, goals: "x" }),
      outsider.patch(`/api/care-plans/${x.carePlanId}`, { goals: "x" }),
      outsider.post(`/api/care-plans/${x.carePlanId}/submit`),
      outsider.post("/api/consents", { participantId: p, type: "general_services", formName: "x", signedDate: isoDaysAgo(1) }),
      outsider.post(`/api/consents/${x.consentId}/revoke`, { reason: "x" }),
      outsider.post("/api/referrals", { participantId: p, partnerName: "x", serviceType: "x" }),
      outsider.post(`/api/referrals/${x.referralId}/outcome`, { status: "declined" }),
      outsider.patch(`/api/participants/${p}/details`, { phone: "5625550100" }),
      outsider.post(`/api/participants/${p}/documents`, { filename: "x.pdf", contentType: "application/pdf", sizeBytes: 10, description: "x" }),
      outsider.post(`/api/participants/${p}/assessment-links`, { formId: p }),
    ];
    for (const res of await Promise.all(attempts)) refused(res.status);

    // And nothing changed.
    const [consent] = await db.select().from(consents).where(eq(consents.id, x.consentId));
    expect(consent.revokedAt).toBeNull();
    const record = (await owner.get(`/api/participants/${p}`)).body;
    expect(record.notes).toHaveLength(1);
    expect(record.details.phone).toBeNull();
    expect(record.carePlanStatus).toBe("pending_review");
  });
});

describe("a permission doesn't widen whose records it reaches", () => {
  // Each of these holds the permission a route asks for, but sees only
  // their own caseload — the shape of a role NMBM might add.
  const narrow = async (codes: Parameters<typeof staffWith>[1]) => {
    const user = await staffWith(db, [...codes, "participants.read.own"]);
    return signIn(app, user.email);
  };

  it("keeps note and care plan reviewers to the records they can see", async () => {
    const reviewer = await narrow(["notes.approve", "care_plans.approve"]);
    expect(((await reviewer.get("/api/notes/awaiting-review")).body as { id: string }[]).map((n) => n.id)).not.toContain(x.noteId);
    expect(((await reviewer.get("/api/care-plans/awaiting-review")).body as { id: string }[]).map((n) => n.id)).not.toContain(x.carePlanId);
    expect(((await reviewer.get("/api/dashboard")).body.awaitingReview as { id: string }[]).map((n) => n.id)).not.toContain(x.carePlanId);
    refused((await reviewer.post(`/api/notes/${x.noteId}/approve`)).status);
    refused((await reviewer.post(`/api/notes/${x.noteId}/return`, { reviewNote: "x" })).status);
    refused((await reviewer.post(`/api/care-plans/${x.carePlanId}/approve`)).status);
    refused((await reviewer.post(`/api/care-plans/${x.carePlanId}/return`, { reviewNote: "x" })).status);
    // The ones who can see it still can.
    expect(((await director.get("/api/notes/awaiting-review")).body as { id: string }[]).map((n) => n.id)).toContain(x.noteId);
  });

  it("can't reassign somebody else's client to themselves, close their case, withdraw them or export them", async () => {
    const assigner = await narrow(["participants.assign", "notes.write"]);
    refused((await assigner.post(`/api/participants/${x.participantId}/assignment`, { workerId: ownerId })).status);
    const closer = await narrow(["episodes.write"]);
    refused((await closer.post(`/api/episodes/${x.episodeId}/close`, { closureReason: "completed" })).status);
    const manager = await narrow(["programs.manage"]);
    refused((await manager.post(`/api/enrollments/${x.enrollmentId}/withdraw`, { reason: "x" })).status);
    const exporter = await narrow(["records.export"]);
    refused((await exporter.post(`/api/participants/${x.participantId}/record-export`, { purpose: "participant_request" })).status);
    expect((await owner.get(`/api/participants/${x.participantId}`)).body.episodeStatus).toBe("open");
  });

  it("shows a class roster in full only to people who run classes", async () => {
    // Can hold a caseload, but doesn't take attendance or set up classes.
    const readerUser = await staffWith(db, ["participants.read.own", "notes.write"]);
    const reader = await signIn(app, readerUser.email);
    const own = await admit(db, { workerId: readerUser.id, actorId: directorId });
    expect((await director.post(`/api/cohorts/${x.cohortId}/enrollments`, { participantId: own.participantId })).status).toBe(201);
    const roster = (await reader.get(`/api/cohorts/${x.cohortId}`)).body;
    expect(roster.roster.map((r: { participantId: string }) => r.participantId)).toEqual([own.participantId]);
    const ownEnrollment = roster.roster[0].enrollmentId;
    expect((roster.marks as { enrollmentId: string }[]).every((m) => m.enrollmentId === ownEnrollment)).toBe(true);
    const facilitator = await signIn(app, (await staff(db, "health_education_prevention_specialist")).email);
    const full = (await facilitator.get(`/api/cohorts/${x.cohortId}`)).body.roster as { participantId: string }[];
    expect(full.map((r) => r.participantId)).toContain(x.participantId);
  });

  it("keeps the follow-up queue to the closed records the caller can see", async () => {
    const z = await admit(db, { workerId: ownerId, actorId: directorId, startDate: isoDaysAgo(200) });
    expect((await director.post(`/api/episodes/${z.episodeId}/close`, { closureReason: "completed" })).status).toBe(200);
    await backdateEpisodeEnd(db, z.episodeId, isoDaysAgo(100));
    const caller = await narrow(["follow_ups.record"]);
    const queue = (await caller.get("/api/follow-ups")).body;
    const everyone = [...queue.overdue, ...queue.due, ...queue.upcoming] as { participantId: string }[];
    expect(everyone.map((r) => r.participantId)).not.toContain(z.participantId);
    refused((await caller.post("/api/follow-ups", { episodeId: z.episodeId, milestoneMonths: 3, outcome: "no_answer" })).status);
    // QA, who sees every record, has it.
    const qa = await signIn(app, (await staff(db, "quality_assurance_coordinator")).email);
    const qaQueue = (await qa.get("/api/follow-ups")).body;
    expect([...qaQueue.overdue, ...qaQueue.due].map((r: { participantId: string }) => r.participantId)).toContain(z.participantId);
  });
});

describe("requests that don't come from the app", () => {
  it("refuses a change sent from another site's page, and allows the app's own", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/notes/${x.noteId}/approve`,
      headers: { cookie: director.cookie!, origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(403);
    expect((await db.select().from(consents).where(eq(consents.id, x.consentId)))[0].revokedAt).toBeNull();
    const nullOrigin = await app.inject({
      method: "POST",
      url: `/api/consents/${x.consentId}/revoke`,
      payload: { reason: "x" },
      headers: { cookie: owner.cookie!, origin: "null" },
    });
    expect(nullOrigin.statusCode).toBe(403);
    const sameSite = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: { category: "question", subject: "x", description: "x" },
      headers: { cookie: owner.cookie!, origin: "http://localhost", host: "localhost" },
    });
    expect(sameSite.statusCode).toBe(201);
    // Reads aren't affected: a link from elsewhere still opens the app.
    const read = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: owner.cookie!, origin: "https://evil.example" } });
    expect(read.statusCode).toBe(200);
  });

  it("answers a malformed parameter with a 400 or 404, never a server error", async () => {
    const admin = await signIn(app, (await staff(db, "system_administrator")).email);
    expect((await admin.get("/api/admin/audit?limit=abc")).status).toBe(400);
    expect((await admin.get("/api/admin/audit?limit=-1")).status).toBe(400);
    expect((await director.get("/api/incoming-referrals?view=everything")).status).toBe(400);
    expect((await director.get("/api/participants?status=deleted")).status).toBe(400);
    expect((await director.get("/api/assessments/1%20or%201=1")).status).toBe(404);
  });

  it("refuses everything to somebody not signed in", async () => {
    const anon = client(app);
    for (const url of [`/api/participants/${x.participantId}`, "/api/participants", "/api/notes/awaiting-review", `/api/cohorts/${x.cohortId}`]) {
      expect((await anon.get(url)).status).toBe(401);
    }
    expect((await anon.post(`/api/consents/${x.consentId}/revoke`, { reason: "x" })).status).toBe(401);
  });
});

describe("an id out of reach answers exactly as an id that doesn't exist", () => {
  // Each request is sent twice by somebody holding the permission it
  // needs: once with the real id of a record that isn't theirs, once with
  // an id that names nothing. If the two answers differed in any way —
  // status, words — the difference would say the record exists.
  type Probe = { as: () => Promise<Client>; method: "get" | "post" | "patch"; url: (id: string) => string; body?: (id: string) => unknown };
  const asOutsider = async () => outsider;
  const narrow = (codes: Parameters<typeof staffWith>[1]) => async () =>
    signIn(app, (await staffWith(db, [...codes, "participants.read.own"])).email);

  const probes: Record<string, Probe & { id: () => string }> = {
    "open a record": { as: asOutsider, method: "get", id: () => x.participantId, url: (id) => `/api/participants/${id}` },
    "list its documents": { as: asOutsider, method: "get", id: () => x.participantId, url: (id) => `/api/participants/${id}/documents` },
    "list its forms": { as: asOutsider, method: "get", id: () => x.participantId, url: (id) => `/api/participants/${id}/assessments` },
    "change its details": { as: asOutsider, method: "patch", id: () => x.participantId, url: (id) => `/api/participants/${id}/details`, body: () => ({ city: "x" }) },
    "upload to it": {
      as: asOutsider, method: "post", id: () => x.participantId, url: (id) => `/api/participants/${id}/documents`,
      body: () => ({ filename: "x.pdf", contentType: "application/pdf", sizeBytes: 10, description: "x" }),
    },
    "start a form on it": {
      as: asOutsider, method: "post", id: () => x.participantId, url: (id) => `/api/participants/${id}/assessments`,
      body: () => ({ formId: x.formId, mode: "with_staff" }),
    },
    "send it a form": { as: asOutsider, method: "post", id: () => x.participantId, url: (id) => `/api/participants/${id}/assessment-links`, body: () => ({ formId: x.formId }) },
    "write a note": {
      as: asOutsider, method: "post", id: () => x.participantId, url: () => "/api/notes",
      body: (id) => ({ participantId: id, episodeId: x.episodeId, contactResult: "contacted", body: "x" }),
    },
    "write a care plan": { as: asOutsider, method: "post", id: () => x.participantId, url: () => "/api/care-plans", body: (id) => ({ participantId: id, episodeId: x.episodeId, goals: "x" }) },
    "record a consent": {
      as: asOutsider, method: "post", id: () => x.participantId, url: () => "/api/consents",
      body: (id) => ({ participantId: id, type: "general_services", formName: "x", signedDate: isoDaysAgo(1) }),
    },
    "refer out": { as: asOutsider, method: "post", id: () => x.participantId, url: () => "/api/referrals", body: (id) => ({ participantId: id, partnerName: "x", serviceType: "x" }) },
    "revise a note": { as: asOutsider, method: "patch", id: () => x.noteId, url: (id) => `/api/notes/${id}`, body: () => ({ body: "x" }) },
    "edit a care plan": { as: asOutsider, method: "patch", id: () => x.carePlanId, url: (id) => `/api/care-plans/${id}`, body: () => ({ goals: "x" }) },
    "submit a care plan": { as: asOutsider, method: "post", id: () => x.carePlanId, url: (id) => `/api/care-plans/${id}/submit` },
    "revoke a consent": { as: asOutsider, method: "post", id: () => x.consentId, url: (id) => `/api/consents/${id}/revoke`, body: () => ({ reason: "x" }) },
    "record a referral outcome": { as: asOutsider, method: "post", id: () => x.referralId, url: (id) => `/api/referrals/${id}/outcome`, body: () => ({ status: "declined" }) },
    "read a participation record": { as: asOutsider, method: "get", id: () => x.enrollmentId, url: (id) => `/api/enrollments/${id}/participation` },
    "open a form": { as: asOutsider, method: "get", id: () => x.assessmentId, url: (id) => `/api/assessments/${id}` },
    "answer a form": { as: asOutsider, method: "patch", id: () => x.assessmentId, url: (id) => `/api/assessments/${id}/answers`, body: () => ({ answers: {} }) },
    "complete a form": { as: asOutsider, method: "post", id: () => x.assessmentId, url: (id) => `/api/assessments/${id}/complete` },
    "void a form": { as: asOutsider, method: "post", id: () => x.assessmentId, url: (id) => `/api/assessments/${id}/void`, body: () => ({ reason: "x" }) },
    "replace a form's link": { as: asOutsider, method: "post", id: () => x.assessmentId, url: (id) => `/api/assessments/${id}/link` },
    "withdraw a form's link": { as: asOutsider, method: "post", id: () => x.assessmentId, url: (id) => `/api/assessments/${id}/link/revoke` },
    "confirm an upload": { as: asOutsider, method: "post", id: () => x.documentId, url: (id) => `/api/documents/${id}/confirm` },
    "download a document": { as: asOutsider, method: "get", id: () => x.documentId, url: (id) => `/api/documents/${id}/download-url` },
    "void a document": { as: asOutsider, method: "post", id: () => x.documentId, url: (id) => `/api/documents/${id}/void`, body: () => ({ reason: "x" }) },
    "approve a note": { as: narrow(["notes.approve"]), method: "post", id: () => x.noteId, url: (id) => `/api/notes/${id}/approve` },
    "return a note": { as: narrow(["notes.approve"]), method: "post", id: () => x.noteId, url: (id) => `/api/notes/${id}/return`, body: () => ({ reviewNote: "x" }) },
    "approve a care plan": { as: narrow(["care_plans.approve"]), method: "post", id: () => x.carePlanId, url: (id) => `/api/care-plans/${id}/approve` },
    "return a care plan": {
      as: narrow(["care_plans.approve"]), method: "post", id: () => x.carePlanId, url: (id) => `/api/care-plans/${id}/return`, body: () => ({ reviewNote: "x" }),
    },
    "reassign a client": {
      as: narrow(["participants.assign", "notes.write"]), method: "post", id: () => x.participantId,
      url: (id) => `/api/participants/${id}/assignment`, body: () => ({ workerId: ownerId }),
    },
    "close a stay": { as: narrow(["episodes.write"]), method: "post", id: () => x.episodeId, url: (id) => `/api/episodes/${id}/close`, body: () => ({ closureReason: "completed" }) },
    "record a Molina letter": { as: narrow(["episodes.write"]), method: "post", id: () => x.episodeId, url: (id) => `/api/episodes/${id}/disenrollment-letter` },
    "readmit": {
      as: narrow(["episodes.write", "notes.write"]), method: "post", id: () => x.participantId, url: () => "/api/episodes",
      body: (id) => ({ participantId: id, startDate: isoDaysAgo(0), assignedWorkerId: ownerId }),
    },
    "enroll in a class": {
      as: narrow(["programs.manage"]), method: "post", id: () => x.participantId, url: () => `/api/cohorts/${x.cohortId}/enrollments`,
      body: (id) => ({ participantId: id }),
    },
    "withdraw from a class": { as: narrow(["programs.manage"]), method: "post", id: () => x.enrollmentId, url: (id) => `/api/enrollments/${id}/withdraw`, body: () => ({ reason: "x" }) },
    "export a record": {
      as: narrow(["records.export"]), method: "post", id: () => x.participantId, url: (id) => `/api/participants/${id}/record-export`,
      body: () => ({ purpose: "participant_request" }),
    },
    "record a follow-up call": {
      as: narrow(["follow_ups.record"]), method: "post", id: () => x.episodeId, url: () => "/api/follow-ups",
      body: (id) => ({ episodeId: id, milestoneMonths: 3, outcome: "no_answer" }),
    },
    "link a referral in": {
      as: narrow(["incoming_referrals.manage"]), method: "post", id: () => x.participantId, url: () => `/api/incoming-referrals/${randomUUID()}/link`,
      body: (id) => ({ participantId: id }),
    },
  };

  for (const [name, probe] of Object.entries(probes)) {
    it(`for "${name}"`, async () => {
      const as = await probe.as();
      const send = (id: string) =>
        probe.method === "get" ? as.get(probe.url(id)) : as[probe.method](probe.url(id), probe.body?.(id) ?? {});
      const theirs = await send(probe.id());
      const nothing = await send(randomUUID());
      expect(theirs.status).toBe(404);
      expect({ status: theirs.status, body: theirs.body }).toEqual({ status: nothing.status, body: nothing.body });
    });
  }

  it("left everything as it was", async () => {
    const record = (await owner.get(`/api/participants/${x.participantId}`)).body;
    expect(record.episodeStatus).toBe("open");
    expect(record.workerName).toBeTruthy();
    expect(record.notes).toHaveLength(1);
    expect(record.carePlanStatus).toBe("pending_review");
    const [consent] = await db.select().from(consents).where(eq(consents.id, x.consentId));
    expect(consent.revokedAt).toBeNull();
  });
});
