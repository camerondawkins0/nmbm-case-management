import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api.js";
import type { AdminUser, AuditEntry } from "../../lib/types.js";
import { Pill } from "../../components/flags.js";

type Role = { id: string; code: string; label: string };

// M31: "Dayna and myself until we get an IT." Until this screen, the
// only way to give someone a role was to run a seed script against the
// database — not something NMBM can do for themselves.
export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api<AdminUser[]>("/api/admin/users").then(setUsers).catch(() => setUsers([]));
    api<Role[]>("/api/admin/roles").then(setRoles).catch(() => setRoles([]));
    // Only an admin.settings.manage holder gets the trail; a user
    // manager without it simply sees no panel.
    api<AuditEntry[]>("/api/admin/audit?limit=12").then(setAudit).catch(() => setAudit([]));
  }, []);

  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    }
  }

  if (!users) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-nmbm-ink">Staff and roles</h1>
      <p className="mt-1 text-sm text-nmbm-ink/60">
        Accounts are created the first time someone signs in with Google. Roles decide what
        they can see and do.
      </p>

      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {users.map((user) => (
          <li key={user.id} className="rounded border border-nmbm-ink/10 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="font-medium text-nmbm-ink">{user.displayName}</span>
                <span className="ml-2 text-sm text-nmbm-ink/50">{user.email}</span>
              </div>
              {user.active ? (
                <Pill tone="ok">Active</Pill>
              ) : (
                <Pill tone="muted">Deactivated</Pill>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {user.roles.length === 0 && (
                <span className="text-sm text-nmbm-ink/50">
                  No role — this account can sign in but can't do anything yet.
                </span>
              )}
              {user.roles.map((role) => (
                <span
                  key={role.code}
                  className="inline-flex items-center gap-1 rounded bg-nmbm-ink/5 px-2 py-0.5 text-xs text-nmbm-ink"
                >
                  {role.label}
                  <button
                    title={`Remove ${role.label}`}
                    onClick={() =>
                      run(() =>
                        api(`/api/admin/users/${user.id}/roles/${role.code}`, {
                          method: "DELETE",
                        }),
                      )
                    }
                    className="text-nmbm-ink/40 hover:text-state-alert"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={adding[user.id] ?? ""}
                onChange={(e) => setAdding({ ...adding, [user.id]: e.target.value })}
                className="rounded border border-nmbm-ink/20 px-2 py-1 text-sm"
              >
                <option value="">Add a role…</option>
                {roles
                  .filter((r) => !user.roles.some((ur) => ur.code === r.code))
                  .map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
              </select>
              <button
                disabled={!adding[user.id]}
                onClick={() =>
                  run(() =>
                    api(`/api/admin/users/${user.id}/roles`, {
                      method: "POST",
                      body: JSON.stringify({ roleCode: adding[user.id] }),
                    }),
                  )
                }
                className="rounded border border-nmbm-ink/30 px-3 py-1 text-sm disabled:opacity-40"
              >
                Add
              </button>

              {user.active ? (
                <button
                  onClick={() =>
                    run(() => api(`/api/admin/users/${user.id}/deactivate`, { method: "POST" }))
                  }
                  className="ml-auto rounded border border-nmbm-ink/30 px-3 py-1 text-sm text-nmbm-ink/70 hover:border-state-alert hover:text-state-alert"
                >
                  Deactivate
                </button>
              ) : (
                <button
                  onClick={() =>
                    run(() => api(`/api/admin/users/${user.id}/reactivate`, { method: "POST" }))
                  }
                  className="ml-auto rounded border border-nmbm-ink/30 px-3 py-1 text-sm"
                >
                  Reactivate
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {audit.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
            Recent activity
          </h2>
          <p className="mt-1 text-xs text-nmbm-ink/50">
            Append-only. Entries are written by the action itself and can't be edited here.
          </p>
          <ul className="mt-2 divide-y divide-nmbm-ink/5 rounded border border-nmbm-ink/10 text-sm">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span className="text-nmbm-ink">
                  <span className="font-medium">{entry.actorName}</span>{" "}
                  <span className="text-nmbm-ink/60">{entry.action.replace(/[._]/g, " ")}</span>
                  {entry.detail && <span className="text-nmbm-ink/50"> — {entry.detail}</span>}
                </span>
                <span className="text-xs text-nmbm-ink/40">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
