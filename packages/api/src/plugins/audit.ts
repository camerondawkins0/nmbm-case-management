import type { Db } from "@nmbm/db";
import { auditLog } from "@nmbm/db";

export async function writeAudit(
  db: Db,
  entry: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    detail?: string;
  },
) {
  await db.insert(auditLog).values(entry);
}
