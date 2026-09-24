import type { Db } from "@nmbm/db";
import { users, roles, userRoles, assignments, participants } from "@nmbm/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { conflict, notFound, badRequest } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";

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

export async function listRoles(db: Db) {
  return db.select({ id: roles.id, code: roles.code, label: roles.label }).from(roles);
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
    detail: `${role.code} granted to ${user.email}`,
  });
  return { granted: role.code };
}

export async function revokeRole(db: Db, userId: string, roleCode: string, actorId: string) {
  const user = await loadUser(db, userId);
  const [role] = await db.select().from(roles).where(eq(roles.code, roleCode));
  if (!role) throw notFound("Role not found");

  // Locking every administrator out of the admin screen is not a thing
  // a single click should be able to do.
  if (roleCode === "system_administrator") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userRoles)
      .where(eq(userRoles.roleId, role.id));
    if (count <= 1) throw conflict("That's the last system administrator — grant another first");
  }

  await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)));
  await writeAudit(db, {
    actorUserId: actorId,
    action: "user.role_revoked",
    entityType: "user",
    entityId: userId,
    detail: `${role.code} revoked from ${user.email}`,
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

  await db
    .update(users)
    .set({ active: false, deactivatedAt: new Date() })
    .where(eq(users.id, userId));
  await writeAudit(db, {
    actorUserId: actorId,
    action: "user.deactivated",
    entityType: "user",
    entityId: userId,
    detail: user.email,
  });
  return { deactivated: user.email };
}

export async function reactivateUser(db: Db, userId: string, actorId: string) {
  const user = await loadUser(db, userId);
  if (user.active) throw conflict("Already active");
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
