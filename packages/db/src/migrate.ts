import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectionOptions } from "./client.js";

// Resolved from this file rather than the working directory, so the
// same code finds the SQL whether it runs as src/migrate.ts under tsx or
// as dist/migrate.js in the production image — both sit one level below
// the package, next to src/migrations.
const migrationsFolder = fileURLToPath(new URL("../src/migrations", import.meta.url));

export async function runMigrations(connectionString: string) {
  // "already exists, skipping" notices on every re-run are noise in the
  // deploy log, not news.
  const sql = postgres(connectionString, connectionOptions({ max: 1, onnotice: () => {} }));
  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end();
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  await runMigrations(connectionString);
  console.log("Migrations applied.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
