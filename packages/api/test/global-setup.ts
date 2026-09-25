import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDb, closeDb } from "@nmbm/db";
import type { GlobalSetupContext } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

// Every run gets its own database, created here and dropped afterwards,
// so a test can never touch a development or demo database — only the
// server named in the URL is shared. The schema comes from the real
// migrations and the grants from the real reference seed: a test that
// passes against a hand-built schema proves nothing about production.
export default async function setup({ provide }: GlobalSetupContext) {
  const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      "Set TEST_DATABASE_URL (or DATABASE_URL) to a Postgres server. A fresh database is created on it for each run.",
    );
  }
  const name = `nmbm_test_${Date.now()}_${process.pid}`;
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const testUrl = url.toString();

  const admin = createDb(baseUrl);
  await admin.execute(sql.raw(`CREATE DATABASE "${name}"`));
  await closeDb(admin);

  const env = { ...process.env, DATABASE_URL: testUrl };
  execSync("npm run -s -w @nmbm/db migrate", { cwd: repoRoot, env, stdio: "pipe" });
  execSync("npm run -s -w @nmbm/db seed:reference", { cwd: repoRoot, env, stdio: "pipe" });

  provide("databaseUrl", testUrl);

  return async () => {
    const cleanup = createDb(baseUrl);
    await cleanup.execute(sql.raw(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    await closeDb(cleanup);
  };
}
