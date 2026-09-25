import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

// Drizzle 0.33 doesn't expose the underlying connection, and an open
// pool keeps the process alive — a test run that never exits, or a
// server that can't shut down cleanly. Kept here so only this file
// knows about postgres-js.
const connections = new WeakMap<object, postgres.Sql>();

// On Cloud Run, Cloud SQL is reached through a unix socket mounted at
// /cloudsql/<project>:<region>:<instance>. postgres-js won't take that
// path from the URL: "postgres://u:p@/db?host=/cloudsql/..." is an
// invalid URL to it, and a ?host= parameter is sent to the server as a
// setting and refused. It does take it as the `host` option, so the
// socket directory travels separately and the URL keeps only the
// credentials and database name.
export function connectionOptions(extra: postgres.Options<Record<string, never>> = {}) {
  const socketDir = process.env.DATABASE_SOCKET_DIR;
  return socketDir ? { ...extra, host: socketDir } : extra;
}

export function createDb(connectionString: string) {
  const sql = postgres(connectionString, connectionOptions());
  const db = drizzle(sql, { schema });
  connections.set(db, sql);
  return db;
}

export type Db = ReturnType<typeof createDb>;

export async function closeDb(db: Db) {
  await connections.get(db)?.end({ timeout: 5 });
}
