import { createDb } from "../client.js";
import { roles, permissions, rolePermissions, rolePermissionOverrides } from "../schema/index.js";
import { ROLES, ROLE_LABELS, PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from "@nmbm/shared";
import { eq, and } from "drizzle-orm";

// Without this, authorize() finds no grants for anybody and every route
// 403s — the app is unusable until reference data exists. Idempotent, so
// it can be re-run after a role or permission is added to @nmbm/shared.
export async function seedReference(db: ReturnType<typeof createDb>) {
  await db
    .insert(permissions)
    .values(PERMISSIONS.map((code) => ({ code })))
    .onConflictDoNothing();

  await db
    .insert(roles)
    .values(ROLES.map((code) => ({ code, label: ROLE_LABELS[code], builtin: true })))
    .onConflictDoUpdate({ target: roles.code, set: { builtin: true } });

  const intended = await intendedGrants(db);
  for (const [roleId, codes] of intended) {
    if (codes.size === 0) continue;
    await db
      .insert(rolePermissions)
      .values([...codes].map((permissionId) => ({ roleId, permissionId })))
      .onConflictDoNothing();
  }

  return { roles: ROLES.length, permissions: PERMISSIONS.length };
}

// What each of NMBM's roles should hold: the defaults in
// DEFAULT_ROLE_PERMISSIONS, with any choice NMBM made on the
// permissions screen laid over them. Their choices win, so a deploy
// never undoes one; a permission new to the code still reaches the
// roles it's meant for, because there's no choice about it yet.
//
// Only the nine known roles. Anything else in the table isn't the
// code's to manage (the test suite makes roles of its own).
export async function intendedGrants(db: ReturnType<typeof createDb>) {
  const roleRows = await db.select().from(roles);
  const permissionRows = await db.select().from(permissions);
  const permissionId = new Map(permissionRows.map((p) => [p.code, p.id]));
  const overrides = await db.select().from(rolePermissionOverrides);

  const intended = new Map<string, Set<string>>();
  for (const role of roleRows) {
    if (!(ROLES as readonly string[]).includes(role.code)) continue;
    const grants = new Set(
      DEFAULT_ROLE_PERMISSIONS[role.code as (typeof ROLES)[number]].map((code) => permissionId.get(code)!),
    );
    for (const o of overrides.filter((o) => o.roleId === role.id)) {
      if (o.granted) grants.add(o.permissionId);
      else grants.delete(o.permissionId);
    }
    intended.set(role.id, grants);
  }
  return intended;
}

// Grants stay in sync with what's intended: a permission dropped from
// the defaults (and not kept by NMBM) is revoked here too.
export async function pruneStaleGrants(db: ReturnType<typeof createDb>) {
  const intended = await intendedGrants(db);
  let removed = 0;
  for (const [roleId, keep] of intended) {
    const current = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    for (const grant of current) {
      if (keep.has(grant.permissionId)) continue;
      await db
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, grant.permissionId)));
      removed += 1;
    }
  }
  return removed;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = createDb(url);
  const counts = await seedReference(db);
  const removed = await pruneStaleGrants(db);
  console.log(
    `Reference data seeded: ${counts.roles} roles, ${counts.permissions} permissions` +
      (removed ? `, ${removed} stale grant(s) revoked` : ""),
  );
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
