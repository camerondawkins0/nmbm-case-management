import type { Db } from "@nmbm/db";
import { users, roles, userRoles, assignments, participants } from "@nmbm/db";
import { eq, and, isNull, sql, desc } from "drizzle-orm";
import { conflict, notFound, badRequest } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";
import { assertActorHoldsRole, assertNotLockedOut } from "./permissions.js";

// M31: "Dayna and myself until we get an IT." Until this existed, roles
// could only be granted by running the seed script against the database,
// which is not something NMBM can do for themselves.

export async function listUsers(db: Db) {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      active: users.active,
      deactivatedAt: users.deactivatedAt,
      roleCode: roles.code,
      roleLabel: roles.label,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .orderBy(users.displayName);

  // One row per user with their roles collected, rather than a row per
  // grant — the join fans out and the screen wants people, not grants.
  const byUser = new Map<string, {
    id: string;
    email: string;
    displayName: string;
    active: boolean;
    deactivatedAt: Date | null;
    roles: { code: string; label: string }[];
  }>();

  for (const row of rows) {
    const existing = byUser.get(row.id) ?? {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      active: row.active,
      deactivatedAt: row.deactivatedAt,
      roles: [],
    };
    if (row.roleCode && row.roleLabel) {
      existing.roles.push({ code: row.roleCode, label: row.roleLabel });
    }
    byUser.set(row.id, existing);
  }
  return [...byUser.values()];
}

// The roles that can be given to somebody: retired ones can't.
export async function listRoles(db: Db) {
  return db
    .select({ id: roles.id, code: roles.code, label: roles.label, builtin: roles.builtin })
    .from(roles)
    .where(eq(roles.active, true))
    .orderBy(desc(roles.builtin), roles.label);
}

async function loadUser(db: Db, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw notFound("User not found");
  return user;
}

export async function grantRole(db: Db, userId: string, roleCode: string, actorId: string) {
  const user = await loadUser(db, userId);
  const [role] = await db.select().from(roles).where(eq(roles.code, roleCode));
  if (!role) throw notFound("Role not found");
  if (!role.active) throw conflict("That role has been retired");
  await assertActorHoldsRole(db, actorId, role.id, role.label);

  const [existing] = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)));
  if (existing) throw conflict("User already has that role");

  await db.insert(userRoles).values({ userId, roleId: role.id });
  await writeAudit(db, {
    actorUserId: actorId,
    action: "user.role_granted",
    entityType: "user",
    entityId: userId,
    detail: `${role.label} given to ${user.email}`,
  });
  return { granted: role.code };
}

export async function revokeRole(db: Db, userId: string, roleCode: string, actorId: string) {
  const user = await loadUser(db, userId);
  const [role] = await db.select().from(roles).where(eq(roles.code, roleCode));
  if (!role) throw notFound("Role not found");

  // Taking the last way to manage staff or permissions away from
  // the last person who has it is not a thing one click should do —
  // whichever role carries it now that roles are NMBM's to change.
  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)));
    await assertNotLockedOut(tx);
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "user.role_revoked",
      entityType: "user",
      entityId: userId,
      detail: `${role.label} taken from ${user.email}`,
    });
  });
  return { revoked: role.code };
}

// U9: "you would archive them so we could still access notes; caseloads
// would be reassigned." Deactivation is not deletion — the account stays
// so past notes keep their author — and it refuses to strand a caseload.
export async function deactivateUser(db: Db, userId: string, actorId: string) {
  const user = await loadUser(db, userId);
  if (!user.active) throw conflict("Already deactivated");
  if (userId === actorId) throw badRequest("You can't deactivate your own account");

  const open = await db
    .select({ id: participants.id, firstName: participants.firstName, lastName: participants.lastName })
    .from(assignments)
    .innerJoin(participants, eq(participants.id, assignments.participantId))
    .where(and(eq(assignments.workerId, userId), isNull(assignments.endedAt)));

  if (open.length > 0) {
    throw conflict(
      `Reassign this worker's ${open.length} open case(s) first: ` +
        open.map((p) => `${p.firstName} ${p.lastName}`).join(", "),
    );
  }

  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await tx.update(users).set({ active: false, deactivatedAt: new Date() }).where(eq(users.id, userId));
    await assertNotLockedOut(tx);
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "user.deactivated",
      entityType: "user",
      entityId: userId,
      detail: user.email,
    });
  });
  return { deactivated: user.email };
}

export async function reactivateUser(db: Db, userId: string, actorId: string) {
  const user = await loadUser(db, userId);
  if (user.active) throw conflict("Already active");
  // Reactivating hands back whatever their roles carry, so it's held to
  // the same rule as giving a role: nothing you can't do yourself.
  const theirRoles = await db
    .select({ id: roles.id, label: roles.label })
    .from(userRoles)
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.active, true)))
    .where(eq(userRoles.userId, userId));
  for (const role of theirRoles) await assertActorHoldsRole(db, actorId, role.id, role.label);
  await db
    .update(users)
    .set({ active: true, deactivatedAt: null })
    .where(eq(users.id, userId));
  await writeAudit(db, {
    actorUserId: actorId,
    action: "user.reactivated",
    entityType: "user",
    entityId: userId,
    detail: user.email,
  });
  return { reactivated: user.email };
}
