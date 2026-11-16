import type { Db } from "@nmbm/db";
import {
  csAuthorizations,
  episodes,
  housingDeposits,
  housingServices,
  housingStatuses,
  participants,
  tenancies,
  users,
} from "@nmbm/db";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  authorizationState,
  CS_SERVICE_LABELS,
  CS_TIME_SERVICES,
  HOUSING_ACTIVITY_LABELS,
  lastCoveredDay,
  PAYER_LABELS,
  SERVICE_CONTACT_METHOD_LABELS,
  todayInOrg,
  unitsUsed,
  type csAuthorizationCreateSchema,
  type csAuthorizationDecisionSchema,
  type csAuthorizationEndSchema,
  type depositCreateSchema,
  type depositDecisionSchema,
  type depositPaidSchema,
  type housingServiceCreateSchema,
  type housingStatusCreateSchema,
  type HousingSituation,
  type SubsidyType,
  type tenancyCreateSchema,
  type tenancyMoveOutSchema,
} from "@nmbm/shared";
import { conflict, notFound, unprocessable } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";
import { getSetting } from "../../lib/settings.js";
import { keepVisible } from "../../lib/caseload.js";
import { toCsv } from "../../lib/csv.js";

type In<T extends z.ZodTypeAny> = z.infer<T>;

/* ------------------------------------------------------------------ *
 * Finding things. Each "not found" is the words a route also uses when
 * the record is out of reach, so the two can't be told apart.
 * ------------------------------------------------------------------ */

export async function findAuthorization(db: Db, id: string) {
  const [row] = await db.select().from(csAuthorizations).where(eq(csAuthorizations.id, id));
  if (!row) throw notFound("Authorization not found");
  return row;
}
export async function findStatus(db: Db, id: string) {
  const [row] = await db.select().from(housingStatuses).where(eq(housingStatuses.id, id));
  if (!row) throw notFound("Housing status not found");
  return row;
}
export async function findService(db: Db, id: string) {
  const [row] = await db.select().from(housingServices).where(eq(housingServices.id, id));
  if (!row) throw notFound("Housing service not found");
  return row;
}
export async function findTenancy(db: Db, id: string) {
  const [row] = await db.select().from(tenancies).where(eq(tenancies.id, id));
  if (!row) throw notFound("Tenancy not found");
  return row;
}
export async function findDeposit(db: Db, id: string) {
  const [row] = await db.select().from(housingDeposits).where(eq(housingDeposits.id, id));
  if (!row) throw notFound("Deposit not found");
  return row;
}

async function openEpisode(db: Db, participantId: string) {
  const [row] = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.participantId, participantId), eq(episodes.status, "open")));
  if (!row) throw conflict("This client has no open stay — readmit them first");
  return row;
}

function notInFuture(day: string, what: string) {
  if (day > todayInOrg()) throw unprocessable(`${what} can't be in the future`);
}

async function namesFor(db: Db, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (wanted.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

const voidFields = (actorId: string, reason: string) => ({ voidedAt: new Date(), voidedById: actorId, voidReason: reason });

/* ------------------------------------------------------------------ *
 * The record's housing section.
 * ------------------------------------------------------------------ */

export async function housingFor(db: Db, participantId: string) {
  const today = todayInOrg();
  const warningDays = await getSetting(db, "cs_authorization_warning_days");
  const [statuses, auths, services, homes, deposits] = await Promise.all([
    db
      .select()
      .from(housingStatuses)
      .where(eq(housingStatuses.participantId, participantId))
      .orderBy(desc(housingStatuses.effectiveDate), desc(housingStatuses.createdAt)),
    db
      .select()
      .from(csAuthorizations)
      .where(eq(csAuthorizations.participantId, participantId))
      .orderBy(desc(csAuthorizations.requestedDate), desc(csAuthorizations.createdAt)),
    db
      .select()
      .from(housingServices)
      .where(eq(housingServices.participantId, participantId))
      .orderBy(desc(housingServices.serviceDate), desc(housingServices.createdAt)),
    db.select().from(tenancies).where(eq(tenancies.participantId, participantId)).orderBy(desc(tenancies.moveInDate)),
    db
      .select()
      .from(housingDeposits)
      .where(eq(housingDeposits.participantId, participantId))
      .orderBy(desc(housingDeposits.requestedAt)),
  ]);
  const money = await depositTotals(db, auths.map((a) => a.id));
  const names = await namesFor(db, [
    ...statuses.map((s) => s.recordedById),
    ...auths.flatMap((a) => [a.recordedById, a.decidedById]),
    ...services.map((s) => s.authorId),
    ...homes.map((t) => t.recordedById),
    ...deposits.flatMap((d) => [d.requestedById, d.decidedById]),
  ]);
  const live = <T extends { voidedAt: Date | null }>(rows: T[]) => rows.filter((r) => !r.voidedAt);

  return {
    current: live(statuses)[0] ?? null,
    statuses: statuses.map((s) => ({ ...s, recordedByName: names.get(s.recordedById) ?? null })),
    authorizations: auths.map((a) => {
      const theirs = live(services).filter((s) => s.authorizationId === a.id);
      const used = a.unitType ? unitsUsed(a.unitType, theirs) : null;
      return {
        ...a,
        state: a.voidedAt ? ("void" as const) : authorizationState(a, today, warningDays),
        lastCoveredDay: lastCoveredDay(a),
        minutesLogged: theirs.reduce((n, s) => n + s.minutes, 0),
        unitsUsed: used,
        overAuthorized: used !== null && a.unitsAuthorized !== null && used > a.unitsAuthorized,
        amountCommitted: money.get(a.id)?.committed ?? "0.00",
        amountPaid: money.get(a.id)?.paid ?? "0.00",
        recordedByName: names.get(a.recordedById) ?? null,
        decidedByName: a.decidedById ? names.get(a.decidedById) ?? null : null,
      };
    }),
    services: services.map((s) => ({ ...s, authorName: names.get(s.authorId) ?? null })),
    tenancies: homes.map((t) => ({ ...t, recordedByName: names.get(t.recordedById) ?? null })),
    deposits: deposits.map((d) => ({
      ...d,
      requestedByName: names.get(d.requestedById) ?? null,
      decidedByName: d.decidedById ? names.get(d.decidedById) ?? null : null,
    })),
  };
}

// Sums in the database, as numerics, returned as strings: money is never
// a float here (hard rule 5). "Committed" is everything asked for that
// hasn't been declined or voided — what's left to ask for is measured
// against it, so two requests can't each fit and together not.
async function depositTotals(db: Db, authorizationIds: string[]) {
  if (authorizationIds.length === 0) return new Map<string, { committed: string; paid: string }>();
  const rows = await db
    .select({
      authorizationId: housingDeposits.authorizationId,
      committed: sql<string>`coalesce(sum(${housingDeposits.amount}) filter (where ${housingDeposits.status} <> 'declined'), 0)::numeric(10,2)::text`,
      paid: sql<string>`coalesce(sum(${housingDeposits.amount}) filter (where ${housingDeposits.status} = 'paid'), 0)::numeric(10,2)::text`,
    })
    .from(housingDeposits)
    .where(and(inArray(housingDeposits.authorizationId, authorizationIds), isNull(housingDeposits.voidedAt)))
    .groupBy(housingDeposits.authorizationId);
  return new Map(rows.map((r) => [r.authorizationId, { committed: r.committed, paid: r.paid }]));
}

/* ------------------------------------------------------------------ *
 * Housing situation.
 * ------------------------------------------------------------------ */

export async function recordStatus(db: Db, participantId: string, input: In<typeof housingStatusCreateSchema>, actorId: string) {
  notInFuture(input.effectiveDate, "The date");
  const [row] = await db
    .insert(housingStatuses)
    .values({ participantId, situation: input.situation, effectiveDate: input.effectiveDate, note: input.note ?? null, recordedById: actorId })
    .returning();
  await writeAudit(db, { actorUserId: actorId, action: "housing.status_recorded", entityType: "participant", entityId: participantId, detail: `${input.situation} from ${input.effectiveDate}` });
  return row;
}

export async function voidStatus(db: Db, id: string, reason: string, actorId: string) {
  const row = await findStatus(db, id);
  if (row.voidedAt) throw conflict("Already voided");
  const [updated] = await db.update(housingStatuses).set(voidFields(actorId, reason)).where(eq(housingStatuses.id, id)).returning();
  await writeAudit(db, { actorUserId: actorId, action: "housing.status_voided", entityType: "participant", entityId: row.participantId, detail: reason });
  return updated;
}

/* ------------------------------------------------------------------ *
 * Authorizations: asked for, decided, sometimes ended early.
 * ------------------------------------------------------------------ */

export async function requestAuthorization(db: Db, participantId: string, input: In<typeof csAuthorizationCreateSchema>, actorId: string) {
  const episode = await openEpisode(db, participantId);
  notInFuture(input.requestedDate, "The request date");
  const [row] = await db
    .insert(csAuthorizations)
    .values({
      participantId,
      episodeId: episode.id,
      service: input.service,
      plan: input.plan ?? null,
      authorizationNumber: input.authorizationNumber ?? null,
      requestedDate: input.requestedDate,
      note: input.note ?? null,
      recordedById: actorId,
    })
    .returning();
  await writeAudit(db, { actorUserId: actorId, action: "cs_authorization.requested", entityType: "participant", entityId: participantId, detail: CS_SERVICE_LABELS[input.service] });
  return row;
}

export async function decideAuthorization(db: Db, id: string, input: In<typeof csAuthorizationDecisionSchema>, actorId: string) {
  const auth = await findAuthorization(db, id);
  if (auth.voidedAt) throw conflict("That authorization was voided");
  if (auth.status !== "requested") throw conflict("Already decided");
  notInFuture(input.decisionDate, "The decision date");
  if (input.decisionDate < auth.requestedDate) throw unprocessable("The decision can't come before the request");

  if (input.decision === "denied") {
    const [row] = await db
      .update(csAuthorizations)
      .set({ status: "denied", decisionDate: input.decisionDate, decidedById: actorId, note: input.note })
      .where(eq(csAuthorizations.id, id))
      .returning();
    await writeAudit(db, { actorUserId: actorId, action: "cs_authorization.denied", entityType: "participant", entityId: auth.participantId, detail: CS_SERVICE_LABELS[auth.service] });
    return row;
  }

  if (input.endDate < input.startDate) throw unprocessable("The end date can't come before the start date");
  // Deposits are authorized as money, the time services in units.
  if (auth.service === "housing_deposits") {
    if (!input.amountAuthorized) throw unprocessable("Say how much the plan authorized for deposits");
    if (input.unitType || input.unitsAuthorized) throw unprocessable("Housing Deposits are authorized as an amount, not units");
  } else {
    if (input.amountAuthorized) throw unprocessable("Only Housing Deposits are authorized as an amount");
    if (Boolean(input.unitType) !== Boolean(input.unitsAuthorized)) throw unprocessable("Give both the units and what they count, or neither");
  }
  const [row] = await db
    .update(csAuthorizations)
    .set({
      status: "approved",
      decisionDate: input.decisionDate,
      decidedById: actorId,
      authorizationNumber: input.authorizationNumber,
      startDate: input.startDate,
      endDate: input.endDate,
      unitType: input.unitType ?? null,
      unitsAuthorized: input.unitsAuthorized ?? null,
      amountAuthorized: input.amountAuthorized ?? null,
      ...(input.note ? { note: input.note } : {}),
    })
    .where(eq(csAuthorizations.id, id))
    .returning();
  await writeAudit(db, {
    actorUserId: actorId,
    action: "cs_authorization.approved",
    entityType: "participant",
    entityId: auth.participantId,
    detail: `${CS_SERVICE_LABELS[auth.service]} ${input.authorizationNumber}, ${input.startDate} to ${input.endDate}`,
  });
  return row;
}

export async function endAuthorization(db: Db, id: string, input: In<typeof csAuthorizationEndSchema>, actorId: string) {
  const auth = await findAuthorization(db, id);
  if (auth.voidedAt) throw conflict("That authorization was voided");
  if (auth.status !== "approved" || !auth.startDate || !auth.endDate) throw conflict("Only an approved authorization can be ended");
  if (auth.endedDate) throw conflict("Already ended");
  if (input.endedDate < auth.startDate || input.endedDate > auth.endDate) {
    throw unprocessable(`The last day covered has to fall within ${auth.startDate} to ${auth.endDate}`);
  }
  // Work already logged after that day would be left outside its own
  // authorization.
  const [{ later }] = await db
    .select({ later: sql<number>`count(*)::int` })
    .from(housingServices)
    .where(and(eq(housingServices.authorizationId, id), isNull(housingServices.voidedAt), sql`${housingServices.serviceDate} > ${input.endedDate}`));
  if (later > 0) throw conflict(`${later} service(s) are logged after ${input.endedDate}. Void them, or choose a later day`);
  const [row] = await db
    .update(csAuthorizations)
    .set({ endedDate: input.endedDate, endedReason: input.reason })
    .where(eq(csAuthorizations.id, id))
    .returning();
  await writeAudit(db, { actorUserId: actorId, action: "cs_authorization.ended", entityType: "participant", entityId: auth.participantId, detail: `${input.endedDate}: ${input.reason}` });
  return row;
}

export async function voidAuthorization(db: Db, id: string, reason: string, actorId: string) {
  const auth = await findAuthorization(db, id);
  if (auth.voidedAt) throw conflict("Already voided");
  const [{ services }] = await db
    .select({ services: sql<number>`count(*)::int` })
    .from(housingServices)
    .where(and(eq(housingServices.authorizationId, id), isNull(housingServices.voidedAt)));
  const [{ deposits }] = await db
    .select({ deposits: sql<number>`count(*)::int` })
    .from(housingDeposits)
    .where(and(eq(housingDeposits.authorizationId, id), isNull(housingDeposits.voidedAt)));
  if (services + deposits > 0) {
    throw conflict("Work or deposits are recorded against this authorization. Void those first, or end it instead");
  }
  const [row] = await db.update(csAuthorizations).set(voidFields(actorId, reason)).where(eq(csAuthorizations.id, id)).returning();
  await writeAudit(db, { actorUserId: actorId, action: "cs_authorization.voided", entityType: "participant", entityId: auth.participantId, detail: reason });
  return row;
}

// Work and money go only against an authorization that is this client's,
// for this stay, approved, for the right service, and covering the day.
async function usableAuthorization(db: Db, participantId: string, episodeId: string, authorizationId: string, day: string, service: "time" | "deposits") {
  const [auth] = await db
    .select()
    .from(csAuthorizations)
    .where(and(eq(csAuthorizations.id, authorizationId), eq(csAuthorizations.participantId, participantId)));
  if (!auth || auth.voidedAt) throw unprocessable("Choose one of this client's authorizations");
  if (auth.episodeId !== episodeId) throw unprocessable("That authorization was for an earlier stay");
  if (auth.status !== "approved") throw unprocessable("That authorization hasn't been approved");
  const isDeposits = auth.service === "housing_deposits";
  if (service === "deposits" && !isDeposits) throw unprocessable("Deposits go against a Housing Deposits authorization");
  if (service === "time" && !CS_TIME_SERVICES.includes(auth.service)) throw unprocessable("Housing Deposits are recorded as deposits, not time");
  const last = lastCoveredDay(auth)!;
  if (day < auth.startDate! || day > last) {
    throw unprocessable(`That authorization covers ${auth.startDate} to ${last}`);
  }
  return auth;
}

/* ------------------------------------------------------------------ *
 * Logging the work.
 * ------------------------------------------------------------------ */

export async function logService(db: Db, participantId: string, input: In<typeof housingServiceCreateSchema>, actorId: string) {
  const episode = await openEpisode(db, participantId);
  notInFuture(input.serviceDate, "The date of service");
  if (input.serviceDate < episode.startDate) throw unprocessable(`The date of service can't be before this stay began (${episode.startDate})`);
  const auth = await usableAuthorization(db, participantId, episode.id, input.authorizationId, input.serviceDate, "time");
  const [row] = await db
    .insert(housingServices)
    .values({
      participantId,
      episodeId: episode.id,
      authorizationId: auth.id,
      serviceDate: input.serviceDate,
      minutes: input.minutes,
      activity: input.activity,
      contactMethod: input.contactMethod,
      note: input.note,
      authorId: actorId,
    })
    .returning();
  await writeAudit(db, { actorUserId: actorId, action: "housing.service_logged", entityType: "participant", entityId: participantId, detail: `${CS_SERVICE_LABELS[auth.service]}, ${input.minutes} min on ${input.serviceDate}` });

  // Over the authorized units: still logged — the work happened — but
  // said, so somebody asks the plan for more before it's billed.
  let overAuthorized = false;
  if (auth.unitType && auth.unitsAuthorized) {
    const entries = await db
      .select({ serviceDate: housingServices.serviceDate, minutes: housingServices.minutes })
      .from(housingServices)
      .where(and(eq(housingServices.authorizationId, auth.id), isNull(housingServices.voidedAt)));
    overAuthorized = unitsUsed(auth.unitType, entries) > auth.unitsAuthorized;
  }
  return { service: row, overAuthorized };
}

export async function voidService(db: Db, id: string, reason: string, actorId: string) {
  const row = await findService(db, id);
  if (row.voidedAt) throw conflict("Already voided");
  const [updated] = await db.update(housingServices).set(voidFields(actorId, reason)).where(eq(housingServices.id, id)).returning();
  await writeAudit(db, { actorUserId: actorId, action: "housing.service_voided", entityType: "participant", entityId: row.participantId, detail: reason });
  return updated;
}

/* ------------------------------------------------------------------ *
 * Where they live.
 * ------------------------------------------------------------------ */

const SITUATION_FOR_SUBSIDY: Record<SubsidyType, HousingSituation> = {
  none: "permanent_rental",
  housing_choice_voucher: "permanent_subsidized",
  rapid_rehousing: "permanent_subsidized",
  other: "permanent_subsidized",
  permanent_supportive: "permanent_supportive_housing",
};

export async function recordTenancy(db: Db, participantId: string, input: In<typeof tenancyCreateSchema>, actorId: string) {
  notInFuture(input.moveInDate, "The move-in date");
  if (input.leaseStart && input.leaseEnd && input.leaseEnd < input.leaseStart) throw unprocessable("The lease can't end before it starts");
  try {
    return await db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const [row] = await tx
        .insert(tenancies)
        .values({
          participantId,
          moveInDate: input.moveInDate,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2 ?? null,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          landlordName: input.landlordName ?? null,
          landlordPhone: input.landlordPhone ?? null,
          subsidy: input.subsidy,
          monthlyRent: input.monthlyRent ?? null,
          tenantPortion: input.tenantPortion ?? null,
          leaseStart: input.leaseStart ?? null,
          leaseEnd: input.leaseEnd ?? null,
          recordedById: actorId,
        })
        .returning();
      // Moving in is a change of housing situation; recorded with it so
      // nobody has to enter it twice, and correctable like any other.
      await tx.insert(housingStatuses).values({
        participantId,
        situation: SITUATION_FOR_SUBSIDY[input.subsidy],
        effectiveDate: input.moveInDate,
        note: `Moved in to ${input.addressLine1}`,
        recordedById: actorId,
      });
      await writeAudit(tx, { actorUserId: actorId, action: "housing.moved_in", entityType: "participant", entityId: participantId, detail: input.moveInDate });
      return row;
    });
  } catch (e) {
    if ((e as { constraint_name?: string }).constraint_name === "tenancies_one_current") {
      throw conflict("They already have a current home on file. Record the move-out from it first");
    }
    throw e;
  }
}

export async function moveOut(db: Db, id: string, input: In<typeof tenancyMoveOutSchema>, actorId: string) {
  const row = await findTenancy(db, id);
  if (row.voidedAt) throw conflict("That tenancy was voided");
  if (row.moveOutDate) throw conflict("Already moved out");
  notInFuture(input.moveOutDate, "The move-out date");
  if (input.moveOutDate < row.moveInDate) throw unprocessable("The move-out can't come before the move-in");
  const [updated] = await db
    .update(tenancies)
    .set({ moveOutDate: input.moveOutDate, moveOutReason: input.reason })
    .where(eq(tenancies.id, id))
    .returning();
  await writeAudit(db, { actorUserId: actorId, action: "housing.moved_out", entityType: "participant", entityId: row.participantId, detail: `${input.moveOutDate}: ${input.reason}` });
  return updated;
}

export async function voidTenancy(db: Db, id: string, reason: string, actorId: string) {
  const row = await findTenancy(db, id);
  if (row.voidedAt) throw conflict("Already voided");
  const [updated] = await db.update(tenancies).set(voidFields(actorId, reason)).where(eq(tenancies.id, id)).returning();
  await writeAudit(db, { actorUserId: actorId, action: "housing.tenancy_voided", entityType: "participant", entityId: row.participantId, detail: reason });
  return updated;
}

/* ------------------------------------------------------------------ *
 * Deposits: asked for, decided by somebody else, paid.
 * ------------------------------------------------------------------ */

export async function requestDeposit(db: Db, participantId: string, input: In<typeof depositCreateSchema>, actorId: string) {
  const episode = await openEpisode(db, participantId);
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const auth = await usableAuthorization(tx, participantId, episode.id, input.authorizationId, todayInOrg(), "deposits");
    // Held while this request is counted, so two at once can't both fit
    // in what's left.
    await tx.execute(sql`select 1 from ${csAuthorizations} where ${csAuthorizations.id} = ${auth.id} for update`);
    const [{ fits, remaining }] = await tx
      .select({
        remaining: sql<string>`(${auth.amountAuthorized}::numeric - coalesce(sum(${housingDeposits.amount}), 0))::numeric(10,2)::text`,
        fits: sql<boolean>`(${auth.amountAuthorized}::numeric - coalesce(sum(${housingDeposits.amount}), 0)) >= ${input.amount}::numeric`,
      })
      .from(housingDeposits)
      .where(and(eq(housingDeposits.authorizationId, auth.id), isNull(housingDeposits.voidedAt), sql`${housingDeposits.status} <> 'declined'`));
    if (!fits) throw unprocessable(`That's more than is left on this authorization ($${remaining})`);
    const [row] = await tx
      .insert(housingDeposits)
      .values({
        participantId,
        authorizationId: auth.id,
        purpose: input.purpose,
        payee: input.payee,
        amount: input.amount,
        note: input.note ?? null,
        requestedById: actorId,
      })
      .returning();
    await writeAudit(tx, { actorUserId: actorId, action: "housing.deposit_requested", entityType: "participant", entityId: participantId, detail: `$${input.amount} to ${input.payee}` });
    return row;
  });
}

export async function decideDeposit(db: Db, id: string, input: In<typeof depositDecisionSchema>, actorId: string) {
  const row = await findDeposit(db, id);
  if (row.voidedAt) throw conflict("That request was voided");
  if (row.status !== "requested") throw conflict("Already decided");
  if (row.requestedById === actorId) throw conflict("You asked for this deposit, so somebody else decides it");
  const [updated] = await db
    .update(housingDeposits)
    .set({ status: input.decision, decidedById: actorId, decidedAt: new Date(), decisionNote: input.note ?? null })
    .where(eq(housingDeposits.id, id))
    .returning();
  await writeAudit(db, { actorUserId: actorId, action: `housing.deposit_${input.decision}`, entityType: "participant", entityId: row.participantId, detail: `$${row.amount} to ${row.payee}` });
  return updated;
}

export async function markPaid(db: Db, id: string, input: In<typeof depositPaidSchema>, actorId: string) {
  const row = await findDeposit(db, id);
  if (row.voidedAt) throw conflict("That request was voided");
  if (row.status !== "approved") throw conflict(row.status === "paid" ? "Already paid" : "Only an approved deposit can be paid");
  notInFuture(input.paidDate, "The payment date");
  if (row.decidedAt && input.paidDate < todayInOrg(row.decidedAt)) throw unprocessable("It can't have been paid before it was approved");
  const [updated] = await db
    .update(housingDeposits)
    .set({ status: "paid", paidDate: input.paidDate, paymentReference: input.paymentReference, paidRecordedById: actorId })
    .where(eq(housingDeposits.id, id))
    .returning();
  await writeAudit(db, { actorUserId: actorId, action: "housing.deposit_paid", entityType: "participant", entityId: row.participantId, detail: `$${row.amount}, ${input.paymentReference}` });
  return updated;
}

// Money that went out stays on the record; anything short of that can
// be voided — by whoever asked while it's still only asked for, or by
// somebody who approves deposits.
export async function voidDeposit(db: Db, id: string, reason: string, actorId: string, canApprove: boolean) {
  const row = await findDeposit(db, id);
  if (row.voidedAt) throw conflict("Already voided");
  if (row.status === "paid") throw conflict("A paid deposit stays on the record");
  if (!canApprove && !(row.status === "requested" && row.requestedById === actorId)) {
    throw conflict("Only somebody who approves deposits can void this one");
  }
  const [updated] = await db.update(housingDeposits).set(voidFields(actorId, reason)).where(eq(housingDeposits.id, id)).returning();
  await writeAudit(db, { actorUserId: actorId, action: "housing.deposit_voided", entityType: "participant", entityId: row.participantId, detail: reason });
  return updated;
}

/* ------------------------------------------------------------------ *
 * Across the caseload.
 * ------------------------------------------------------------------ */

const who = { participantId: participants.id, firstName: participants.firstName, lastName: participants.lastName };

export async function overview(db: Db, visible: Set<string> | "all") {
  const today = todayInOrg();
  const warningDays = await getSetting(db, "cs_authorization_warning_days");
  const auths = keepVisible(
    await db
      .select({ ...who, id: csAuthorizations.id, service: csAuthorizations.service, status: csAuthorizations.status, requestedDate: csAuthorizations.requestedDate, startDate: csAuthorizations.startDate, endDate: csAuthorizations.endDate, endedDate: csAuthorizations.endedDate, authorizationNumber: csAuthorizations.authorizationNumber })
      .from(csAuthorizations)
      .innerJoin(participants, eq(participants.id, csAuthorizations.participantId))
      // Only the open stay's: a closed case's authorizations aren't
      // anybody's to renew.
      .innerJoin(episodes, and(eq(episodes.id, csAuthorizations.episodeId), eq(episodes.status, "open")))
      .where(isNull(csAuthorizations.voidedAt))
      .orderBy(asc(csAuthorizations.endDate)),
    visible,
  ).map((a) => ({ ...a, state: authorizationState(a, today, warningDays), lastCoveredDay: lastCoveredDay(a) }));

  const deposits = keepVisible(
    await db
      .select({ ...who, id: housingDeposits.id, amount: housingDeposits.amount, payee: housingDeposits.payee, purpose: housingDeposits.purpose, status: housingDeposits.status, requestedAt: housingDeposits.requestedAt, requestedById: housingDeposits.requestedById })
      .from(housingDeposits)
      .innerJoin(participants, eq(participants.id, housingDeposits.participantId))
      .where(and(isNull(housingDeposits.voidedAt), inArray(housingDeposits.status, ["requested", "approved"])))
      .orderBy(asc(housingDeposits.requestedAt)),
    visible,
  );

  // Somebody with a housing authorization on their open stay and no
  // housing situation on file: the first thing a plan will ask.
  const withAuth = new Set(auths.map((a) => a.participantId));
  const statusRows = withAuth.size
    ? await db
        .selectDistinct({ participantId: housingStatuses.participantId })
        .from(housingStatuses)
        .where(and(inArray(housingStatuses.participantId, [...withAuth]), isNull(housingStatuses.voidedAt)))
    : [];
  const hasStatus = new Set(statusRows.map((r) => r.participantId));
  const seen = new Set<string>();
  const noSituation = auths
    .filter((a) => !hasStatus.has(a.participantId) && !seen.has(a.participantId) && seen.add(a.participantId))
    .map(({ participantId, firstName, lastName }) => ({ participantId, firstName, lastName }));

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const movedIn = keepVisible(
    await db
      .select({ ...who, id: tenancies.id, moveInDate: tenancies.moveInDate })
      .from(tenancies)
      .innerJoin(participants, eq(participants.id, tenancies.participantId))
      .where(and(isNull(tenancies.voidedAt), gte(tenancies.moveInDate, todayInOrg(since))))
      .orderBy(desc(tenancies.moveInDate)),
    visible,
  );

  return {
    awaitingDecision: auths.filter((a) => a.state === "requested"),
    expiring: auths.filter((a) => a.state === "expiring"),
    active: auths.filter((a) => a.state === "active" || a.state === "expiring"),
    depositsAwaitingDecision: deposits.filter((d) => d.status === "requested"),
    depositsAwaitingPayment: deposits.filter((d) => d.status === "approved"),
    noSituation,
    movedIn,
    warningDays,
  };
}

const EXPORT_COLUMNS = [
  "Date of service", "Last name", "First name", "Date of birth", "Medi-Cal CIN", "Plan",
  "Authorization number", "Service", "Activity", "Contact method", "Minutes", "Staff",
];

// The service log for a period, for reporting to ILS and, once the
// formats are known (M23), billing. Only the people the caller can see;
// what was done, not the free-text note (minimum necessary). A
// disclosure, so it's audited with the period and the count.
export async function exportServices(db: Db, range: { from: string; to: string }, visible: Set<string> | "all", actorId: string) {
  const rows = keepVisible(
    await db
      .select({
        participantId: participants.id,
        serviceDate: housingServices.serviceDate,
        lastName: participants.lastName,
        firstName: participants.firstName,
        dateOfBirth: participants.dateOfBirth,
        mediCalCin: participants.mediCalCin,
        plan: csAuthorizations.plan,
        authorizationNumber: csAuthorizations.authorizationNumber,
        service: csAuthorizations.service,
        activity: housingServices.activity,
        contactMethod: housingServices.contactMethod,
        minutes: housingServices.minutes,
        staff: users.displayName,
      })
      .from(housingServices)
      .innerJoin(participants, eq(participants.id, housingServices.participantId))
      .innerJoin(csAuthorizations, eq(csAuthorizations.id, housingServices.authorizationId))
      .innerJoin(users, eq(users.id, housingServices.authorId))
      .where(and(isNull(housingServices.voidedAt), gte(housingServices.serviceDate, range.from), lte(housingServices.serviceDate, range.to)))
      .orderBy(asc(housingServices.serviceDate), asc(participants.lastName)),
    visible,
  );
  const mapped = rows.map((r) => ({
      "Date of service": r.serviceDate,
      "Last name": r.lastName,
      "First name": r.firstName,
      "Date of birth": r.dateOfBirth,
      "Medi-Cal CIN": r.mediCalCin ?? "",
      Plan: r.plan ? PAYER_LABELS[r.plan] : "",
      "Authorization number": r.authorizationNumber ?? "",
      Service: CS_SERVICE_LABELS[r.service],
      Activity: HOUSING_ACTIVITY_LABELS[r.activity],
      "Contact method": SERVICE_CONTACT_METHOD_LABELS[r.contactMethod],
      Minutes: r.minutes,
      Staff: r.staff,
    }));
  // A period with nothing in it is still a file with its columns.
  const csv = mapped.length > 0 ? toCsv(mapped) : EXPORT_COLUMNS.join(",");
  // On the person who took it out, since the file spans many records.
  await writeAudit(db, { actorUserId: actorId, action: "housing.services_exported", entityType: "user", entityId: actorId, detail: `${range.from} to ${range.to}, ${rows.length} rows` });
  return { csv, rows: rows.length };
}
