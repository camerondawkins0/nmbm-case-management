import { and, eq } from "drizzle-orm";
import { createDb, closeDb } from "./client.js";
import { users, roles, userRoles, auditLog } from "./schema/index.js";

// The first administrator. Everyone who signs in arrives with no role,
// and only a system administrator can assign one, so on day one nobody
// can. This gives one role to one person who has already signed in once,
// and writes it to the audit log like any other grant.
//
//   node packages/db/dist/grant-role.js <email> <role-code>
//
// In production it runs through the release job — docs/DEPLOY.md.
async function main() {
  const [email, roleCode] = process.argv.slice(2);
  if (!email || !roleCode) throw new Error("usage: grant-role <email> <role-code>");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const db = createDb(url);
  try {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) throw new Error(`No user ${email} — they need to sign in once first`);
    const [role] = await db.select().from(roles).where(eq(roles.code, roleCode));
    if (!role) throw new Error(`No role ${roleCode}`);

    const [existing] = await db
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, user.id), eq(userRoles.roleId, role.id)));
    if (existing) {
      console.log(`${email} already has ${roleCode}`);
      return;
    }
    await db.transaction(async (tx) => {
      await tx.insert(userRoles).values({ userId: user.id, roleId: role.id });
      await tx.insert(auditLog).values({
        actorUserId: user.id,
        action: "role.granted",
        entityType: "user",
        entityId: user.id,
        detail: `${roleCode} — granted from the command line (grant-role), not the Staff page`,
      });
    });
    console.log(`Granted ${roleCode} to ${email}`);
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
