import type { Db } from "@nmbm/db";
import { auditLog, users } from "@nmbm/db";
import { eq, desc } from "drizzle-orm";

// Read side of the append-only log. There is deliberately no write
// endpoint: entries come from the services that perform the action, so
// the trail can't be edited to disagree with what happened.
export async function listRecent(db: Db, limit = 100) {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
      actorName: users.displayName,
      actorEmail: users.email,
    })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.actorUserId))
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}
