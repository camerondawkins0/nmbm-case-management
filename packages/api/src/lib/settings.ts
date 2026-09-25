import type { Db } from "@nmbm/db";
import { appSettings, users } from "@nmbm/db";
import { eq } from "drizzle-orm";
import { APP_SETTINGS, APP_SETTING_KEYS, type AppSettingKey } from "@nmbm/shared";
import { notFound, unprocessable } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";

function isKey(key: string): key is AppSettingKey {
  return (APP_SETTING_KEYS as string[]).includes(key);
}

// The stored value, or the default declared in @nmbm/shared when nobody
// has changed it. Read on every use rather than cached, so a change an
// administrator makes applies to the very next request.
export async function getSetting(db: Db, key: AppSettingKey): Promise<number> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? APP_SETTINGS[key].default;
}

export async function listSettings(db: Db) {
  const rows = await db
    .select({
      key: appSettings.key,
      value: appSettings.value,
      updatedAt: appSettings.updatedAt,
      updatedByName: users.displayName,
    })
    .from(appSettings)
    .innerJoin(users, eq(users.id, appSettings.updatedById));
  return APP_SETTING_KEYS.map((key) => {
    const stored = rows.find((r) => r.key === key);
    return {
      key,
      ...APP_SETTINGS[key],
      value: stored?.value ?? APP_SETTINGS[key].default,
      updatedAt: stored?.updatedAt ?? null,
      updatedByName: stored?.updatedByName ?? null,
    };
  });
}

export async function updateSetting(db: Db, key: string, value: number, actorId: string) {
  if (!isKey(key)) throw notFound("No such setting");
  const spec = APP_SETTINGS[key];
  if (value < spec.min || value > spec.max) {
    throw unprocessable(`${spec.label} must be between ${spec.min} and ${spec.max}`);
  }
  const previous = await getSetting(db, key);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(appSettings)
      .values({ key, value, updatedById: actorId })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedById: actorId, updatedAt: new Date() },
      })
      .returning();
    // Changing who can see closed records is an access decision, so it
    // leaves the same trail as granting a role.
    await writeAudit(tx as unknown as Db, {
      actorUserId: actorId,
      action: "settings.changed",
      entityType: "setting",
      entityId: row.id,
      detail: `${key}: ${previous} → ${value}`,
    });
    return row;
  });
}
