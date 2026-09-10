import { createDb } from "../client.js";
import { roles, permissions, rolePermissions } from "../schema/index.js";
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
    .values(ROLES.map((code) => ({ code, label: ROLE_LABELS[code] })))
    .onConflictDoNothing();

  const roleRows = await db.select().from(roles);
  const permissionRows = await db.select().from(permissions);
  const roleId = new Map(roleRows.map((r) => [r.code, r.id]));
  const permissionId = new Map(permissionRows.map((p) => [p.code, p.id]));

  for (const role of ROLES) {
    const grants = DEFAULT_ROLE_PERMISSIONS[role];
    if (grants.length === 0) continue;
    await db
      .insert(rolePermissions)
      .values(
        grants.map((code) => ({
          roleId: roleId.get(role)!,
          permissionId: permissionId.get(code)!,
        })),
      )
      .onConflictDoNothing();
  }

  return { roles: ROLES.length, permissions: PERMISSIONS.length };
}

// Grants stay in sync with the code: a permission dropped from
// DEFAULT_ROLE_PERMISSIONS is revoked here too, or the grid in
// @nmbm/shared stops being the source of truth it claims to be.
export async function pruneStaleGrants(db: ReturnType<typeof createDb>) {
  const roleRows = await db.select().from(roles);
  const permissionRows = await db.select().from(permissions);
  const codeById = new Map(permissionRows.map((p) => [p.id, p.code]));

  let removed = 0;
  for (const role of roleRows) {
    const intended = new Set<string>(DEFAULT_ROLE_PERMISSIONS[role.code as (typeof ROLES)[number]] ?? []);
    const current = await db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, role.id));
    for (const grant of current) {
      const code = codeById.get(grant.permissionId);
      if (code && !intended.has(code)) {
        await db
          .delete(rolePermissions)
          .where(
            and(
              eq(rolePermissions.roleId, role.id),
              eq(rolePermissions.permissionId, grant.permissionId),
            ),
          );
        removed += 1;
      }
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
