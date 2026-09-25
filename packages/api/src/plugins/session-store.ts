import { createHash } from "node:crypto";
import type { SessionStore } from "@fastify/session";
import type { Session } from "fastify";
import type { Db } from "@nmbm/db";
import { sessions } from "@nmbm/db";
import { eq, lt, sql } from "drizzle-orm";

// Stored under a hash so the table can't be read back into working
// session ids — see migration 0009.
function key(sessionId: string) {
  return createHash("sha256").update(sessionId).digest("hex");
}

const PRUNE_EVERY_MS = 15 * 60_000;

// Sessions in Postgres, so every Cloud Run instance sees the same ones
// and a restart or deploy doesn't sign anyone out. At ten users the
// write on each request (the idle timer) costs nothing worth caching.
export class PostgresSessionStore implements SessionStore {
  private lastPrune = 0;

  constructor(
    private readonly db: Db,
    // Used only if a session somehow has no cookie expiry; every session
    // this app creates has one.
    private readonly fallbackTtlMs: number,
  ) {}

  set(sessionId: string, session: Session, callback: (err?: unknown) => void) {
    const expires = session.cookie?.expires
      ? new Date(session.cookie.expires)
      : new Date(Date.now() + this.fallbackTtlMs);
    // The Session object carries its store and request on symbols;
    // JSON keeps only the data and the cookie, which is what restoring
    // needs.
    const data = JSON.parse(JSON.stringify(session));
    this.db
      .insert(sessions)
      .values({ idHash: key(sessionId), data, expiresAt: expires })
      .onConflictDoUpdate({ target: sessions.idHash, set: { data, expiresAt: expires } })
      .then(() => this.pruneOccasionally())
      .then(() => callback(), callback);
  }

  get(sessionId: string, callback: (err: unknown, session?: Session | null) => void) {
    this.db
      .select({ data: sessions.data })
      .from(sessions)
      .where(sql`${sessions.idHash} = ${key(sessionId)} and ${sessions.expiresAt} > now()`)
      .then(([row]) => callback(null, (row?.data as Session | undefined) ?? null), (err) => callback(err));
  }

  destroy(sessionId: string, callback: (err?: unknown) => void) {
    this.db
      .delete(sessions)
      .where(eq(sessions.idHash, key(sessionId)))
      .then(() => callback(), callback);
  }

  // Expired rows are already ignored by get(); this only stops the table
  // growing. Piggybacks on writes rather than running a timer, so there's
  // no background job to keep alive on an instance that scales to zero.
  private async pruneOccasionally() {
    const now = Date.now();
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  }
}
