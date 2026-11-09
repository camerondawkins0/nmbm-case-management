import type { Db } from "@nmbm/db";
import { permissions, rolePermissionOverrides, rolePermissions, roles, userRoles, users } from "@nmbm/db";
import { and, eq, sql } from "drizzle-orm";
import {
  DEFAULT_ROLE_PERMISSIONS,
  LOCKOUT_PERMISSIONS,
  PERMISSION_INFO,
  PERMISSIONS,
  ROLE_LABELS,
  ROLES,
  type Permission,
  type Role,
} from "@nmbm/shared";
import { conflict, notFound } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";

// The grid as it stands: what each role holds, what the code's default
// would be, and where NMBM chose differently and who did.
export async function getGrid(db: Db) {
  const grants = await db
    .select({ role: roles.code, permission: permissions.code })
    .from(rolePermissions)
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId));
  const overrides = await db
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

  return {
    roles: ROLES.map((code) => ({ code, label: ROLE_LABELS[code] })),
    permissions: PERMISSIONS.map((code) => ({ code, ...PERMISSION_INFO[code] })),
    grants: Object.fromEntries(
      ROLES.map((r) => [r, grants.filter((g) => g.role === r).map((g) => g.permission)]),
    ),
    defaults: DEFAULT_ROLE_PERMISSIONS,
    changes: overrides,
  };
}

// Active people who would hold a permission. Counted inside the change's
// own transaction, so it sees the change.
async function activeHolders(db: Db, code: Permission) {
  const [{ count }] = await db
    .select({ count: sql<number>`count(distinct ${users.id})::int` })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(users.active, true), eq(permissions.code, code)));
  return count;
}

export async function setGrant(db: Db, roleCode: string, permissionCode: string, granted: boolean, actorId: string) {
  if (!(ROLES as readonly string[]).includes(roleCode)) throw notFound("Role not found");
  if (!(PERMISSIONS as readonly string[]).includes(permissionCode)) throw notFound("Permission not found");
  const role = roleCode as Role;
  const permission = permissionCode as Permission;
  const [roleRow] = await db.select().from(roles).where(eq(roles.code, role));
  const [permissionRow] = await db.select().from(permissions).where(eq(permissions.code, permission));
  if (!roleRow || !permissionRow) throw notFound("Role or permission not found");
  const isDefault = DEFAULT_ROLE_PERMISSIONS[role].includes(permission) === granted;

  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const key = and(eq(rolePermissionOverrides.roleId, roleRow.id), eq(rolePermissionOverrides.permissionId, permissionRow.id));
    // Back to what the code says: no decision to remember, so the next
    // change to the defaults reaches this role like any other. The audit
    // line below is the history.
    if (isDefault) {
      await tx.delete(rolePermissionOverrides).where(key);
    } else {
      await tx
        .insert(rolePermissionOverrides)
        .values({ roleId: roleRow.id, permissionId: permissionRow.id, granted, changedById: actorId })
        .onConflictDoUpdate({
          target: [rolePermissionOverrides.roleId, rolePermissionOverrides.permissionId],
          set: { granted, changedById: actorId, changedAt: new Date() },
        });
    }
    if (granted) {
      await tx
        .insert(rolePermissions)
        .values({ roleId: roleRow.id, permissionId: permissionRow.id })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, roleRow.id), eq(rolePermissions.permissionId, permissionRow.id)));
    }

    // Nobody left who can manage staff or change permissions means
    // nobody can undo this from the app — only a developer can.
    for (const code of LOCKOUT_PERMISSIONS) {
      if ((await activeHolders(tx, code)) === 0) {
        throw conflict(
          `That would leave nobody active who can "${PERMISSION_INFO[code].label.toLowerCase()}". Give it to another role first.`,
        );
      }
    }

    await writeAudit(tx, {
      actorUserId: actorId,
      action: granted ? "role.permission_granted" : "role.permission_removed",
      entityType: "role",
      entityId: roleRow.id,
      detail: `${PERMISSION_INFO[permission].label} ${granted ? "given to" : "removed from"} ${ROLE_LABELS[role]}${isDefault ? " (back to the default)" : ""}`,
    });
  });
  return { role, permission, granted, isDefault };
}

