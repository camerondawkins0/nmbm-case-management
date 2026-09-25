import { createDb, closeDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { seedReference, pruneStaleGrants } from "./seed/reference.js";

// What every deploy runs before the new version takes traffic: bring the
// schema forward, then bring roles and grants in line with the code. The
// grants step isn't optional — authorize() reads them from the database,
// so a new permission that isn't seeded is a feature nobody can use.
//
// Runs as a Cloud Run Job from the same image as the app (cloudbuild.yaml).
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  await runMigrations(url);
  console.log("Migrations applied.");

  const db = createDb(url);
  try {
    const counts = await seedReference(db);
    const removed = await pruneStaleGrants(db);
    console.log(
      `Reference data: ${counts.roles} roles, ${counts.permissions} permissions` +
        (removed ? `, ${removed} stale grant(s) revoked` : ""),
    );
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
