import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

// Drizzle 0.33 doesn't expose the underlying connection, and an open
// pool keeps the process alive — a test run that never exits, or a
// server that can't shut down cleanly. Kept here so only this file
// knows about postgres-js.
const connections = new WeakMap<object, postgres.Sql>();

export function createDb(connectionString: string) {
  const sql = postgres(connectionString);
  const db = drizzle(sql, { schema });
  connections.set(db, sql);
  return db;
}

export type Db = ReturnType<typeof createDb>;

export async function closeDb(db: Db) {
  await connections.get(db)?.end({ timeout: 5 });
}
