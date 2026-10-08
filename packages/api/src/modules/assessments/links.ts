import crypto from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "@nmbm/db";
import { assessmentForms, assessmentFormVersions, assessmentLinks, assessments, episodes } from "@nmbm/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  SELF_SERVE_IDLE_MINUTES,
  SELF_SERVE_MAX_ATTEMPTS,
  SELF_SERVE_PASSCODE_LENGTH,
} from "@nmbm/shared";
import { AppError, conflict } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";
import { getSetting } from "../../lib/settings.js";
import * as service from "./service.js";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function sameHex(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Everything a participant can be told when a link doesn't work. Which
// of expired, revoked, used, locked or never-existed it was is for the
// case manager to see on the record, not for whoever holds the link.
const GONE = "This link isn't working any more. Ask your case manager for a new one.";
const gone = () => new AppError(404, "link_gone", GONE);
const needsPasscode = () =>
  new AppError(401, "passcode_required", "Enter your passcode to carry on.");

export type IssuedLink = { assessmentId: string; token: string; passcode: string; expiresAt: Date };

/* ------------------------------------------------------------------ *
 * Staff side.
 * ------------------------------------------------------------------ */

// The link's secret and the passcode exist in plain form only in this
// response. The case manager passes them on; the database keeps hashes,
// so neither can be read back out of it later — a lost passcode means a
// new link.
async function issue(db: Db, assessmentId: string, actorId: string): Promise<IssuedLink> {
  const token = crypto.randomBytes(32).toString("base64url");
  const passcode = String(crypto.randomInt(0, 10 ** SELF_SERVE_PASSCODE_LENGTH)).padStart(
    SELF_SERVE_PASSCODE_LENGTH,
    "0",
  );
  const salt = crypto.randomBytes(16).toString("hex");
  const days = await getSetting(db, "self_serve_link_days");
  const expiresAt = new Date(Date.now() + days * 86_400_000);

  await db
    .update(assessmentLinks)
    .set({ revokedAt: new Date(), revokedById: actorId, accessHash: null })
    .where(and(eq(assessmentLinks.assessmentId, assessmentId), isNull(assessmentLinks.revokedAt)));
  await db.insert(assessmentLinks).values({
    assessmentId,
    tokenHash: sha256(token),
    passcodeHash: (await scrypt(passcode, salt, 32)).toString("hex"),
    passcodeSalt: salt,
    createdById: actorId,
    expiresAt,
  });
  return { assessmentId, token, passcode, expiresAt };
}

export async function sendToParticipant(db: Db, participantId: string, formId: string, actorId: string) {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const row = await service.start(tx, participantId, { formId, mode: "self" }, actorId);
    const link = await issue(tx, row.id, actorId);
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "assessment.link_issued",
      entityType: "participant",
      entityId: participantId,
      detail: `expires ${link.expiresAt.toISOString().slice(0, 10)}`,
    });
    return link;
  });
}

// A new link and passcode for the same form — the participant lost the
// passcode, the link expired, or it locked. Answers given so far stay.
export async function reissue(db: Db, assessmentId: string, actorId: string) {
  const row = await service.find(db, assessmentId);
  if (row.mode !== "self") throw conflict("Only a form the participant fills in themselves has a link");
  if (row.status !== "in_progress") throw conflict("This form is no longer open");
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, row.episodeId));
  if (episode?.status !== "open") throw conflict("The enrolment this form belongs to has closed");
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const link = await issue(tx, assessmentId, actorId);
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "assessment.link_reissued",
      entityType: "participant",
      entityId: row.participantId,
      detail: `expires ${link.expiresAt.toISOString().slice(0, 10)}`,
    });
    return link;
  });
}

export async function revoke(db: Db, assessmentId: string, actorId: string) {
  const row = await service.find(db, assessmentId);
  const revoked = await db
    .update(assessmentLinks)
    .set({ revokedAt: new Date(), revokedById: actorId, accessHash: null })
    .where(
      and(
        eq(assessmentLinks.assessmentId, assessmentId),
        isNull(assessmentLinks.revokedAt),
        isNull(assessmentLinks.submittedAt),
      ),
    )
    .returning({ id: assessmentLinks.id });
  if (revoked.length === 0) throw conflict("There's no working link for this form");
  await writeAudit(db, {
    actorUserId: actorId,
    action: "assessment.link_revoked",
    entityType: "participant",
    entityId: row.participantId,
  });
  return { revoked: true };
}

export type LinkState = "live" | "locked" | "expired" | "revoked" | "submitted";

// What the record shows about a self-serve form's link: whether the
// participant can still get in, and whether they have yet. Only the
// newest link counts — older ones were replaced.
export async function linkStates(db: Db, assessmentIds: string[]) {
  const result = new Map<string, { state: LinkState; expiresAt: Date; openedAt: Date | null }>();
  if (assessmentIds.length === 0) return result;
  const rows = await db
    .select()
    .from(assessmentLinks)
    .where(inArray(assessmentLinks.assessmentId, assessmentIds))
    .orderBy(desc(assessmentLinks.createdAt));
  const now = Date.now();
  for (const link of rows) {
    if (result.has(link.assessmentId)) continue;
    const state: LinkState = link.submittedAt
      ? "submitted"
      : link.revokedAt
        ? "revoked"
        : link.lockedAt
          ? "locked"
          : link.expiresAt.getTime() <= now
            ? "expired"
            : "live";
    result.set(link.assessmentId, { state, expiresAt: link.expiresAt, openedAt: link.firstOpenedAt });
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * The participant's side. Nothing here knows who is asking beyond the
 * link and the cookie the passcode earned, and nothing returns more
 * than the one form.
 * ------------------------------------------------------------------ */

// A link that can still be used: not replaced, revoked, locked, spent
// or expired, on a form that's still open in an enrolment that is.
async function usableLink(db: Db, token: string) {
  const [row] = await db
    .select({ link: assessmentLinks, assessment: assessments, episodeStatus: episodes.status })
    .from(assessmentLinks)
    .innerJoin(assessments, eq(assessments.id, assessmentLinks.assessmentId))
    .innerJoin(episodes, eq(episodes.id, assessments.episodeId))
    .where(eq(assessmentLinks.tokenHash, sha256(token)));
  if (
    !row ||
    row.link.revokedAt ||
    row.link.lockedAt ||
    row.link.submittedAt ||
    row.link.expiresAt.getTime() <= Date.now() ||
    row.assessment.status !== "in_progress" ||
    row.episodeStatus !== "open"
  ) {
    throw gone();
  }
  return row;
}

export async function unlock(db: Db, token: string, passcode: string) {
  const { link, assessment } = await usableLink(db, token);
  const given = (await scrypt(passcode, link.passcodeSalt, 32)).toString("hex");

  if (!sameHex(given, link.passcodeHash)) {
    // Counted in the database, not from the row read above, so a burst
    // of guesses in parallel can't each see the same low count.
    const [after] = await db
      .update(assessmentLinks)
      .set({
        failedAttempts: sql`${assessmentLinks.failedAttempts} + 1`,
        lockedAt: sql`case when ${assessmentLinks.failedAttempts} + 1 >= ${SELF_SERVE_MAX_ATTEMPTS} then now() else null end`,
      })
      .where(eq(assessmentLinks.id, link.id))
      .returning();
    if (after.lockedAt) {
      await writeAudit(db, {
        actorUserId: null,
        action: "assessment.link_locked",
        entityType: "participant",
        entityId: assessment.participantId,
        detail: `${SELF_SERVE_MAX_ATTEMPTS} wrong passcodes`,
      });
      throw new AppError(
        423,
        "link_locked",
        "That passcode was wrong too many times, so this link has been locked. Ask your case manager for a new one.",
      );
    }
    const left = SELF_SERVE_MAX_ATTEMPTS - after.failedAttempts;
    throw new AppError(
      401,
      "wrong_passcode",
      `That passcode isn't right. ${left} ${left === 1 ? "try" : "tries"} left before the link locks.`,
    );
  }

  // One browser at a time: entering the passcode somewhere new signs
  // the previous browser out of the form.
  const access = crypto.randomBytes(32).toString("base64url");
  await db
    .update(assessmentLinks)
    .set({
      failedAttempts: 0,
      accessHash: sha256(access),
      accessExpiresAt: new Date(Date.now() + SELF_SERVE_IDLE_MINUTES * 60_000),
      firstOpenedAt: link.firstOpenedAt ?? new Date(),
    })
    .where(eq(assessmentLinks.id, link.id));
  if (!link.firstOpenedAt) {
    await writeAudit(db, {
      actorUserId: null,
      action: "assessment.link_opened",
      entityType: "participant",
      entityId: assessment.participantId,
    });
  }
  return access;
}

// The link and the cookie together. The link alone gets the passcode
// screen; the cookie alone is for a different path and never sent.
async function withAccess(db: Db, token: string, access: string | undefined) {
  const row = await usableLink(db, token);
  const { link } = row;
  if (
    !access ||
    !link.accessHash ||
    !link.accessExpiresAt ||
    link.accessExpiresAt.getTime() <= Date.now() ||
    !sameHex(sha256(access), link.accessHash)
  ) {
    throw needsPasscode();
  }
  await db
    .update(assessmentLinks)
    .set({ accessExpiresAt: new Date(Date.now() + SELF_SERVE_IDLE_MINUTES * 60_000) })
    .where(eq(assessmentLinks.id, link.id));
  return row;
}

// The form and the answers so far — and deliberately nothing about the
// person, the case manager or the record. Whoever has the link and
// passcode learns only which form it is.
export async function participantView(db: Db, token: string, access: string | undefined) {
  const { assessment } = await withAccess(db, token, access);
  const [version] = await db
    .select({ formName: assessmentForms.name })
    .from(assessmentFormVersions)
    .innerJoin(assessmentForms, eq(assessmentForms.id, assessmentFormVersions.formId))
    .where(eq(assessmentFormVersions.id, assessment.versionId));
  const full = await service.getVersion(db, assessment.versionId);
  return {
    formName: version.formName,
    questions: full.questions.map((q) => ({
      stableId: q.stableId,
      sortOrder: q.sortOrder,
      type: q.type,
      prompt: q.prompt,
      helpText: q.helpText,
      section: q.section,
      required: q.required,
      options: q.options,
      showIf: q.showIf,
    })),
    answers: assessment.answers,
  };
}

export async function participantSave(
  db: Db,
  token: string,
  access: string | undefined,
  patch: Record<string, unknown>,
) {
  const { assessment } = await withAccess(db, token, access);
  const saved = await service.saveAnswers(db, assessment.id, patch, null);
  return { answers: saved.answers };
}

export async function participantSubmit(db: Db, token: string, access: string | undefined) {
  const { assessment, link } = await withAccess(db, token, access);
  await service.complete(db, assessment.id, null);
  // Spent: the link stops working the moment the form is in.
  await db
    .update(assessmentLinks)
    .set({ submittedAt: new Date(), accessHash: null })
    .where(eq(assessmentLinks.id, link.id));
  return { submitted: true };
}

