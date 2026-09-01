import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

export function createDb(connectionString: string) {
  const sql = postgres(connectionString);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDb>;
