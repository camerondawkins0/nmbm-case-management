import { describe, it, expect, beforeAll, afterAll, inject } from "vitest";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { auditLog, rolePermissionOverrides } from "@nmbm/db";
import { eq } from "drizzle-orm";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, admit } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let admin: Client;
let director: Client;
let directorId: string;
let chw: Client;
let chwId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  admin = await signIn(app, (await staff(db, "system_administrator")).email);
  const d = await staff(db, "clinical_director");
  directorId = d.id;
  director = await signIn(app, d.email);
  const w = await staff(db, "community_health_worker");
  chwId = w.id;
  chw = await signIn(app, w.email);
});
afterAll(async () => app?.close());

const set = (role: string, permission: string, granted: boolean, as: Client = admin) =>
  as.put(`/api/admin/roles/${role}/permissions/${permission}`, { granted });

// Every test leaves the grid as it found it: the database is shared with
// every other test file. A restore that fails fails the test, rather
// than leaving the next file with somebody else's grid.
async function withGrant<T>(
  role: string,
  permission: string,
  granted: boolean,
  fn: () => Promise<T>,
  as: Client = admin,
) {
  const before = ((await as.get("/api/admin/permissions")).body.grants[role] as string[]).includes(permission);
  expect((await set(role, permission, granted, as)).status).toBe(200);
  try {
    return await fn();
  } finally {
    expect((await set(role, permission, before, as)).status).toBe(200);
  }
}

// What the release job runs on every deploy.
function runReleaseSeed() {
  execSync("npm run -s -w @nmbm/db seed:reference", {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    env: { ...process.env, DATABASE_URL: inject("databaseUrl") },
    stdio: "pipe",
  });
}

describe("NMBM change their own permission grid", () => {
  it("is for whoever holds 'change permissions', not every administrator-ish role", async () => {
    expect((await director.get("/api/admin/permissions")).status).toBe(403);
    expect((await director.put("/api/admin/roles/community_health_worker/permissions/records.export", { granted: true })).status).toBe(403);
    const grid = (await admin.get("/api/admin/permissions")).body;
    expect(grid.roles.filter((r: { builtin: boolean }) => r.builtin)).toHaveLength(9);
    expect(grid.permissions.find((p: { code: string }) => p.code === "records.export").label).toBe("Export whole records");
  });

  it("gives a role a permission, and it works on the next request", async () => {
    const { participantId } = await admit(db, { workerId: chwId, actorId: directorId });
    const exportIt = () => chw.post(`/api/participants/${participantId}/record-export`, { purpose: "participant_request" });
    expect((await exportIt()).status).toBe(403);
    await withGrant("community_health_worker", "records.export", true, async () => {
      expect((await exportIt()).status).toBe(200);
    });
    expect((await exportIt()).status).toBe(403);
  });

  it("takes one away, and putting it back returns to the default", async () => {
    const ids = await admit(db, { workerId: chwId, actorId: directorId });
    const note = () => chw.post("/api/notes", { ...ids, contactResult: "contacted", body: "Checked in." });
    await withGrant("community_health_worker", "notes.write", false, async () => {
      expect((await note()).status).toBe(403);
      const changes = (await admin.get("/api/admin/permissions")).body.changes as { role: string; permission: string }[];
      expect(changes).toContainEqual(expect.objectContaining({ role: "community_health_worker", permission: "notes.write" }));
    });
    expect((await note()).status).toBe(201);
    // Back to the default: no decision left to remember.
    expect(await db.select().from(rolePermissionOverrides)).toEqual([]);
  });

  it("survives a deploy: the release job keeps NMBM's choices", async () => {
    await withGrant("community_health_worker", "records.export", true, async () => {
      await withGrant("community_health_worker", "documents.write", false, async () => {
        runReleaseSeed();
        const grants = (await admin.get("/api/admin/permissions")).body.grants.community_health_worker as string[];
        expect(grants).toContain("records.export");
        expect(grants).not.toContain("documents.write");
      });
    });
  });

  it("won't leave nobody able to manage staff or permissions", async () => {
    const lockout = await set("system_administrator", "admin.roles.manage", false);
    expect(lockout.status).toBe(409);
    expect(lockout.body.message).toMatch(/change permissions/);
    expect((await set("system_administrator", "admin.users.manage", false)).status).toBe(409);
    // Refused means nothing changed.
    expect((await admin.get("/api/admin/permissions")).status).toBe(200);

    // Once another role holds it, the administrators' copy can go.
    await withGrant("clinical_director", "admin.roles.manage", true, async () => {
      // The Clinical Director makes and undoes this one: once it's done,
      // the administrators can't.
      await withGrant(
        "system_administrator",
        "admin.roles.manage",
        false,
        async () => {
          expect((await director.get("/api/admin/permissions")).status).toBe(200);
          expect((await admin.get("/api/admin/permissions")).status).toBe(403);
        },
        director,
      );
    });
  });

  it("doesn't count somebody deactivated as still able to fix things", async () => {
    // The only Billing Coordinator is given the permission, then leaves.
    const leaver = await staff(db, "billing_coordinator");
    await withGrant("billing_coordinator", "admin.roles.manage", true, async () => {
      expect((await admin.post(`/api/admin/users/${leaver.id}/deactivate`)).status).toBe(200);
      expect((await set("system_administrator", "admin.roles.manage", false)).status).toBe(409);
    });
  });

  it("refuses roles and permissions that don't exist, and audits what it does", async () => {
    expect((await set("janitor", "notes.write", true)).status).toBe(404);
    expect((await set("community_health_worker", "everything", true)).status).toBe(404);
    await withGrant("community_health_worker", "records.export", true, async () => {});
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, "role.permission_granted"));
    expect(rows.map((r) => r.detail)).toContain("Export whole records given to Community Health Worker");
  });
});

