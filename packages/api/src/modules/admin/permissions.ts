import crypto from "node:crypto";
import type { Db } from "@nmbm/db";
import { permissions, rolePermissionOverrides, rolePermissions, roles, userRoles, users } from "@nmbm/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  DEFAULT_ROLE_PERMISSIONS,
  LOCKOUT_PERMISSIONS,
  PERMISSION_INFO,
  PERMISSIONS,
  type Permission,
  type Role,
} from "@nmbm/shared";
import { conflict, forbidden, notFound } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";
import { getPermissions } from "../../plugins/authorize.js";

/* ------------------------------------------------------------------ *
 * Guardrails shared by everything that changes who can do what: this
 * page, giving or taking a role on the Staff page, deactivating and
 * reactivating an account.
 * ------------------------------------------------------------------ */

// Active people, holding an active role, that carries the permission.
async function activeHolders(db: Db, code: Permission) {
  const [{ count }] = await db
    .select({ count: sql<number>`count(distinct ${users.id})::int` })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(users.active, true), eq(roles.active, true), eq(permissions.code, code)));
  return count;
}

// Called inside a change's own transaction, after the change, so it
// counts the world as it would be. Nobody left who can manage staff or
// change permissions means nobody can undo the change from the app.
export async function assertNotLockedOut(tx: Db) {
  for (const code of LOCKOUT_PERMISSIONS) {
    if ((await activeHolders(tx, code)) === 0) {
      throw conflict(
        `That would leave nobody active who can "${PERMISSION_INFO[code].label.toLowerCase()}". Give it to another role or person first.`,
      );
    }
  }
}

async function permissionsOfRole(db: Db, roleId: string) {
  const rows = await db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.code as Permission);
}

// No giving access you don't have. Someone who can manage staff but not
// export records can't hand anybody — themselves included — a role that
// exports records. Without this, managing staff would be a route to
// every permission there is.
//
// Whoever can change permissions is exempt: they could give their own
// role whatever the other role has, in the open on the Permissions page,
// so refusing them here would stop nothing and only push them to do it
// that way, widening their role for everyone who holds it.
export async function assertActorHoldsRole(db: Db, actorId: string, roleId: string, roleLabel: string) {
  const held = await getPermissions(db, actorId);
  if (held.has("admin.roles.manage")) return;
  const missing = (await permissionsOfRole(db, roleId)).filter((p) => !held.has(p));
  if (missing.length > 0) {
    throw forbidden(
      `${roleLabel} can do things you can't (${missing.map((p) => PERMISSION_INFO[p].label).join(", ")}), so you can't give it to anyone. Ask someone who can.`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * The grid.
 * ------------------------------------------------------------------ */

async function loadRole(db: Db, code: string) {
  const [role] = await db.select().from(roles).where(eq(roles.code, code));
  if (!role) throw notFound("Role not found");
  return role;
}

export async function getGrid(db: Db) {
  const roleRows = await db
    .select({
      id: roles.id,
      code: roles.code,
      label: roles.label,
      description: roles.description,
      builtin: roles.builtin,
      people: sql<number>`(select count(*)::int from ${userRoles} ur join ${users} u on u.id = ur.user_id where ur.role_id = "roles"."id" and u.active)`,
    })
    .from(roles)
    .where(eq(roles.active, true))
    .orderBy(desc(roles.builtin), asc(roles.createdAt), asc(roles.label));
  const grants = await db
    .select({ role: roles.code, permission: permissions.code })
    .from(rolePermissions)
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId));
  const changes = await db
    .select({
      role: roles.code,
      permission: permissions.code,
      changedAt: rolePermissionOverrides.changedAt,
      changedByName: users.displayName,
    })
    .from(rolePermissionOverrides)
    .innerJoin(roles, eq(roles.id, rolePermissionOverrides.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissionOverrides.permissionId))
    .innerJoin(users, eq(users.id, rolePermissionOverrides.changedById));

  const builtinRoles = roleRows.filter((r) => r.builtin).map((r) => r.code as Role);
  return {
    roles: roleRows.map(({ id: _id, ...r }) => r),
    permissions: PERMISSIONS.map((code) => ({ code, ...PERMISSION_INFO[code] })),
    grants: Object.fromEntries(
      roleRows.map((r) => [r.code, grants.filter((g) => g.role === r.code).map((g) => g.permission)]),
    ),
    // Only the built-in roles have defaults; a custom role is exactly
    // what NMBM gave it.
    defaults: Object.fromEntries(builtinRoles.map((r) => [r, DEFAULT_ROLE_PERMISSIONS[r] ?? []])),
    changes,
  };
}

export async function setGrant(db: Db, roleCode: string, permissionCode: string, granted: boolean, actorId: string) {
  // Only the permissions the code defines exist. A role can't be given a
  // made-up one — there'd be nothing on the server checking for it.
  if (!(PERMISSIONS as readonly string[]).includes(permissionCode)) throw notFound("Permission not found");
  const permission = permissionCode as Permission;
  const role = await loadRole(db, roleCode);
  if (!role.active) throw conflict("That role has been retired");
  const [permissionRow] = await db.select().from(permissions).where(eq(permissions.code, permission));
  if (!permissionRow) throw notFound("Permission not found");
  const isDefault = role.builtin && DEFAULT_ROLE_PERMISSIONS[role.code as Role].includes(permission) === granted;

  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    // Built-in roles remember NMBM's choice as a difference from the
    // default, so the release job keeps it. A custom role has no default
    // to differ from: what it holds is the whole of it, and the release
    // job doesn't touch it.
    if (role.builtin) {
      const key = and(eq(rolePermissionOverrides.roleId, role.id), eq(rolePermissionOverrides.permissionId, permissionRow.id));
      if (isDefault) {
        await tx.delete(rolePermissionOverrides).where(key);
      } else {
        await tx
          .insert(rolePermissionOverrides)
          .values({ roleId: role.id, permissionId: permissionRow.id, granted, changedById: actorId })
          .onConflictDoUpdate({
            target: [rolePermissionOverrides.roleId, rolePermissionOverrides.permissionId],
            set: { granted, changedById: actorId, changedAt: new Date() },
          });
      }
    }
    if (granted) {
      await tx.insert(rolePermissions).values({ roleId: role.id, permissionId: permissionRow.id }).onConflictDoNothing();
    } else {
      await tx
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.permissionId, permissionRow.id)));
    }
    await assertNotLockedOut(tx);
    await writeAudit(tx, {
      actorUserId: actorId,
      action: granted ? "role.permission_granted" : "role.permission_removed",
      entityType: "role",
      entityId: role.id,
      detail: `${PERMISSION_INFO[permission].label} ${granted ? "given to" : "removed from"} ${role.label}${isDefault ? " (back to the default)" : ""}`,
    });
  });
  return { role: role.code, permission, granted, isDefault };
}

/* ------------------------------------------------------------------ *
 * Roles NMBM add themselves.
 * ------------------------------------------------------------------ */

async function assertLabelFree(db: Db, label: string, exceptId?: string) {
  const [taken] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.active, true), sql`lower(${roles.label}) = lower(${label})`));
  if (taken && taken.id !== exceptId) throw conflict(`There's already a role called "${label}"`);
}

export async function createRole(
  db: Db,
  input: { label: string; description?: string | null; copyFrom?: string | null },
  actorId: string,
) {
  await assertLabelFree(db, input.label);
  const source = input.copyFrom ? await loadRole(db, input.copyFrom) : null;
  if (source && !source.active) throw conflict("That role has been retired");
  // The code is never shown and never typed: generated, so a custom role
  // can't take a built-in role's code, or one the code may add later.
  const slug = input.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "role";
  const code = `custom_${slug}_${crypto.randomBytes(3).toString("hex")}`;

  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [role] = await tx
      .insert(roles)
      .values({ code, label: input.label, description: input.description ?? null, builtin: false, createdById: actorId })
      .returning();
    if (source) {
      const copied = await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, source.id));
      if (copied.length > 0) {
        await tx.insert(rolePermissions).values(copied.map((c) => ({ roleId: role.id, permissionId: c.permissionId })));
      }
    }
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "role.created",
      entityType: "role",
      entityId: role.id,
      detail: source ? `${role.label} (copied from ${source.label})` : role.label,
    });
    return role;
  });
}

export async function updateRole(
  db: Db,
  code: string,
  input: { label?: string; description?: string | null },
  actorId: string,
) {
  const role = await loadRole(db, code);
  // The nine built-in roles are named in NMBM's discovery answers and in
  // this system's documentation; renaming one would make both wrong.
  if (role.builtin) throw conflict("Built-in roles can't be renamed. Make a new role instead");
  if (!role.active) throw conflict("That role has been retired");
  if (input.label) await assertLabelFree(db, input.label, role.id);
  const [row] = await db
    .update(roles)
    .set({
      ...(input.label ? { label: input.label } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
    })
    .where(eq(roles.id, role.id))
    .returning();
  await writeAudit(db, {
    actorUserId: actorId,
    action: "role.updated",
    entityType: "role",
    entityId: role.id,
    detail: input.label && input.label !== role.label ? `renamed from ${role.label} to ${input.label}` : row.label,
  });
  return row;
}

// Retired, not deleted: past audit lines still name it. Only once nobody
// holds it, so retiring a role is never a way to take access away from
// people without anyone deciding about each of them on the Staff page —
// and so it can't leave the organization locked out, which is why there's
// no lockout check here.
export async function retireRole(db: Db, code: string, actorId: string) {
  const role = await loadRole(db, code);
  if (role.builtin) throw conflict("Built-in roles can't be retired");
  if (!role.active) throw conflict("That role has already been retired");
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userRoles)
    .where(eq(userRoles.roleId, role.id));
  if (count > 0) {
    throw conflict(`${count} ${count === 1 ? "person still has" : "people still have"} this role. Take it from them on the Staff page first`);
  }
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [row] = await tx.update(roles).set({ active: false }).where(eq(roles.id, role.id)).returning();
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "role.retired",
      entityType: "role",
      entityId: role.id,
      detail: role.label,
    });
    return row;
  });
}
