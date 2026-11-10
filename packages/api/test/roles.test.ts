import { describe, it, expect, beforeAll, afterAll, inject } from "vitest";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Db } from "@nmbm/db";
import { permissions, roles, userRoles, users } from "@nmbm/db";
import { eq, inArray } from "drizzle-orm";
import { startApp, signIn, type Client } from "./support/app.js";
import { staff, staffWith, admit, unique } from "./support/fixtures.js";

let app: FastifyInstance;
let db: Db;
let admin: Client;
let director: Client;
let directorId: string;

beforeAll(async () => {
  ({ app, db } = await startApp());
  admin = await signIn(app, (await staff(db, "system_administrator")).email);
  const d = await staff(db, "clinical_director");
  directorId = d.id;
  director = await signIn(app, d.email);
});
afterAll(async () => app?.close());

type Role = { code: string; label: string; builtin: boolean };
const newRole = async (body: Record<string, unknown>, as: Client = admin) => as.post("/api/admin/roles", body);
const grant = (role: string, permission: string, granted: boolean, as: Client = admin) =>
  as.put(`/api/admin/roles/${role}/permissions/${permission}`, { granted });
const giveRole = (userId: string, roleCode: string, as: Client = admin) =>
  as.post(`/api/admin/users/${userId}/roles`, { roleCode });
const takeRole = (userId: string, roleCode: string, as: Client = admin) =>
  as.del(`/api/admin/users/${userId}/roles/${roleCode}`);
const grantsOf = async (code: string) => (await admin.get("/api/admin/permissions")).body.grants[code] as string[];

describe("NMBM add roles of their own", () => {
  it("is for whoever can change permissions", async () => {
    expect((await newRole({ label: unique("Mine ") }, director)).status).toBe(403);
  });

  it("makes a role that holds nothing until given it, and can start from a copy", async () => {
    const empty = await newRole({ label: unique("Housing navigator ") });
    expect(empty.status).toBe(201);
    expect(await grantsOf(empty.body.code)).toEqual([]);

    const copy = await newRole({ label: unique("Senior CHW "), copyFrom: "community_health_worker" });
    expect((await grantsOf(copy.body.code)).sort()).toEqual((await grantsOf("community_health_worker")).sort());

    const grid = (await admin.get("/api/admin/permissions")).body;
    expect(grid.roles.find((r: Role) => r.code === copy.body.code)).toMatchObject({ builtin: false });
  });

  it("won't take a name already in use, in any capitals", async () => {
    const label = unique("Peer Advocate ");
    expect((await newRole({ label })).status).toBe(201);
    expect((await newRole({ label: label.toUpperCase() })).status).toBe(409);
    expect((await newRole({ label: "Clinical Director" })).status).toBe(409);
  });

  it("works the moment it's given to somebody, and only with permissions that exist", async () => {
    const role = (await newRole({ label: unique("Records clerk ") })).body;
    expect((await grant(role.code, "participants.read.all", true)).status).toBe(200);
    expect((await grant(role.code, "records.export", true)).status).toBe(200);
    expect((await grant(role.code, "delete.everything", true)).status).toBe(404);
    // Not even one that's in the database: only the code checks for a
    // permission, so one the code doesn't define would guard nothing.
    await db.insert(permissions).values({ code: "made.up" }).onConflictDoNothing();
    expect((await grant(role.code, "made.up", true)).status).toBe(404);

    const clerk = await staff(db, null);
    // The administrator can't export records themselves but can still give
    // the role: whoever can change permissions could give it to their own
    // role anyway.
    expect((await giveRole(clerk.id, role.code)).status).toBe(200);
    const asClerk = await signIn(app, clerk.email);
    const worker = await staff(db, "community_health_worker");
    const { participantId } = await admit(db, { workerId: worker.id, actorId: directorId });
    expect((await asClerk.post(`/api/participants/${participantId}/record-export`, { purpose: "funder_audit" })).status).toBe(200);
    expect((await asClerk.post("/api/notes", { participantId, episodeId: participantId, contactResult: "contacted", body: "x" })).status).toBe(403);
  });

  it("renames and describes a custom role, never a built-in one", async () => {
    const role = (await newRole({ label: unique("Outreach ") })).body;
    const renamed = await admin.patch(`/api/admin/roles/${role.code}`, { label: unique("Street outreach "), description: "Evenings" });
    expect(renamed.status).toBe(200);
    const rename = await admin.patch("/api/admin/roles/community_health_worker", { label: "Health Worker" });
    expect(rename.status).toBe(409);
    expect(rename.body.message).toMatch(/Built-in roles can't be renamed/);
    // Checked by message: one that somebody holds is refused for that too.
    const retire = await admin.post("/api/admin/roles/billing_coordinator/retire");
    expect(retire.status).toBe(409);
    expect(retire.body.message).toMatch(/Built-in roles can't be retired/);
  });

  it("retires a role only once nobody has it, and a retired role can't be used", async () => {
    const role = (await newRole({ label: unique("Seasonal ") })).body;
    await grant(role.code, "participants.read.own", true);
    const person = await staff(db, null);
    await giveRole(person.id, role.code);
    const refused = await admin.post(`/api/admin/roles/${role.code}/retire`);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/1 person still has this role/);

    await takeRole(person.id, role.code);
    expect((await admin.post(`/api/admin/roles/${role.code}/retire`)).status).toBe(200);
    expect(((await admin.get("/api/admin/roles")).body as Role[]).map((r) => r.code)).not.toContain(role.code);
    expect((await giveRole(person.id, role.code)).status).toBe(409);
    expect((await grant(role.code, "notes.write", true)).status).toBe(409);
  });

  it("grants nothing once retired, even to somebody the database still says holds it", async () => {
    const role = (await newRole({ label: unique("Temp ") })).body;
    await grant(role.code, "participants.read.all", true);
    const person = await staff(db, null);
    await giveRole(person.id, role.code);
    const asPerson = await signIn(app, person.email);
    expect((await asPerson.get("/api/participants")).status).toBe(200);

    // Retired behind the app's back, with the assignment left in place.
    await db.update(roles).set({ active: false }).where(eq(roles.code, role.code));
    expect((await asPerson.get("/api/participants")).status).toBe(403);
  });

  it("is left alone by a deploy", async () => {
    const role = (await newRole({ label: unique("Kept ") })).body;
    await grant(role.code, "attendance.record", true);
    execSync("npm run -s -w @nmbm/db seed:reference", {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      env: { ...process.env, DATABASE_URL: inject("databaseUrl") },
      stdio: "pipe",
    });
    expect(await grantsOf(role.code)).toEqual(["attendance.record"]);
  });
});

describe("nobody gives access they don't have", () => {
  // Can manage staff and see clients — nothing else. Deactivated once
  // these tests are done: left active, each would count as somebody who
  // can still manage staff, and the lockout tests after this one depend
  // on knowing exactly who can.
  const managers: string[] = [];
  async function staffManager() {
    const user = await staffWith(db, ["admin.users.manage", "participants.read.all"]);
    managers.push(user.id);
    return { user, as: await signIn(app, user.email) };
  }
  afterAll(async () => {
    if (managers.length > 0) await db.update(users).set({ active: false }).where(inArray(users.id, managers));
  });

  it("can't hand out a role that does more than they can", async () => {
    const { as } = await staffManager();
    const person = await staff(db, null);
    const refused = await giveRole(person.id, "system_administrator", as);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/can do things you can't/);

    const narrow = (await newRole({ label: unique("Viewer ") })).body;
    await grant(narrow.code, "participants.read.all", true);
    expect((await giveRole(person.id, narrow.code, as)).status).toBe(200);
  });

  it("can give a role whose only extra is a check on its holder", async () => {
    const { as } = await staffManager();
    const role = (await newRole({ label: unique("Associate ") })).body;
    await grant(role.code, "participants.read.all", true);
    await grant(role.code, "notes.reviewed_clinically", true);
    expect((await giveRole((await staff(db, null)).id, role.code, as)).status).toBe(200);
  });

  it("can't promote themselves", async () => {
    const { user, as } = await staffManager();
    expect((await giveRole(user.id, "clinical_director", as)).status).toBe(403);
  });

  it("can't reactivate somebody whose roles do more than they can", async () => {
    const { as } = await staffManager();
    const director2 = await staff(db, "clinical_director");
    expect((await admin.post(`/api/admin/users/${director2.id}/deactivate`)).status).toBe(200);
    expect((await as.post(`/api/admin/users/${director2.id}/reactivate`)).status).toBe(403);
    expect((await admin.post(`/api/admin/users/${director2.id}/reactivate`)).status).toBe(200);
  });
});

describe("nobody locks the organization out", () => {
  it("refuses taking the last administrator's role or deactivating them, whatever the role is called", async () => {
    // Hand both administrative permissions to a custom role held by one
    // person, and take them off System Administrator, so that person is
    // the only one left who can administer.
    const keeper = (await newRole({ label: unique("Keeper ") })).body;
    await grant(keeper.code, "admin.roles.manage", true);
    await grant(keeper.code, "admin.users.manage", true);
    await grant(keeper.code, "participants.read.all", true);
    const only = await staff(db, null);
    await giveRole(only.id, keeper.code);
    const asOnly = await signIn(app, only.email);
    expect((await grant("system_administrator", "admin.roles.manage", false, asOnly)).status).toBe(200);
    expect((await grant("system_administrator", "admin.users.manage", false, asOnly)).status).toBe(200);
    try {
      expect((await takeRole(only.id, keeper.code, asOnly)).status).toBe(409);
      expect((await grant(keeper.code, "admin.users.manage", false, asOnly)).status).toBe(409);
      const deactivate = await admin.post(`/api/admin/users/${only.id}/deactivate`);
      // The administrators can't manage staff right now, so they're refused
      // at the door; the one person left can't deactivate themselves.
      expect(deactivate.status).toBe(403);
      expect((await asOnly.post(`/api/admin/users/${only.id}/deactivate`)).status).toBe(400);
      expect((await asOnly.post(`/api/admin/roles/${keeper.code}/retire`)).status).toBe(409);
    } finally {
      // Every later test file shares this database, so all of this runs
      // whatever failed above, and only then is any of it checked.
      const restored = [
        (await grant("system_administrator", "admin.users.manage", true, asOnly)).status,
        (await grant("system_administrator", "admin.roles.manage", true, asOnly)).status,
        // With the administrators back, the keeper role can be emptied and retired.
        (await takeRole(only.id, keeper.code)).status,
        (await admin.post(`/api/admin/roles/${keeper.code}/retire`)).status,
      ];
      expect(restored).toEqual([200, 200, 200, 200]);
    }
    expect(await db.select().from(userRoles).where(eq(userRoles.userId, only.id))).toEqual([]);
  });

  it("refuses deactivating the last person who can change permissions", async () => {
    const keeper = (await newRole({ label: unique("Keeper ") })).body;
    await grant(keeper.code, "admin.roles.manage", true);
    const holder = await staff(db, null);
    await giveRole(holder.id, keeper.code);
    const asHolder = await signIn(app, holder.email);
    expect((await grant("system_administrator", "admin.roles.manage", false, asHolder)).status).toBe(200);
    try {
      // The administrators can still manage staff, so it's the lockout
      // that stops them, not the door.
      const refused = await admin.post(`/api/admin/users/${holder.id}/deactivate`);
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/change permissions/);
    } finally {
      const restored = [
        (await grant("system_administrator", "admin.roles.manage", true, asHolder)).status,
        (await takeRole(holder.id, keeper.code)).status,
        (await admin.post(`/api/admin/roles/${keeper.code}/retire`)).status,
      ];
      expect(restored).toEqual([200, 200, 200]);
    }
  });

  it("doesn't count somebody whose only way in is a retired role", async () => {
    const ghost = (await newRole({ label: unique("Ghost ") })).body;
    await grant(ghost.code, "admin.roles.manage", true);
    const person = await staff(db, null);
    await giveRole(person.id, ghost.code);
    // Retired behind the app's back, with the assignment left in place:
    // it grants nothing, so it mustn't count as somebody who could fix things.
    await db.update(roles).set({ active: false }).where(eq(roles.code, ghost.code));
    const removed = await grant("system_administrator", "admin.roles.manage", false);
    try {
      expect(removed.status).toBe(409);
    } finally {
      if (removed.status === 200) {
        await db.update(roles).set({ active: true }).where(eq(roles.code, ghost.code));
        await grant("system_administrator", "admin.roles.manage", true, await signIn(app, person.email));
        await db.update(roles).set({ active: false }).where(eq(roles.code, ghost.code));
      }
    }
  });
});
