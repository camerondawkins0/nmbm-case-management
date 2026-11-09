import { useCallback, useEffect, useState } from "react";
import type { Permission } from "@nmbm/shared";
import { api, ApiError } from "../../lib/api.js";
import type { PermissionGrid } from "../../lib/types.js";

// NMBM decide who can do what. The defaults in the code are a starting
// point; every box here is theirs to change, takes effect on the next
// click anyone makes, survives deploys, and is logged.
export default function PermissionsPage() {
  const [grid, setGrid] = useState<PermissionGrid | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<PermissionGrid>("/api/admin/permissions")
      .then(setGrid)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load permissions"));
  }, []);
  useEffect(load, [load]);

  async function toggle(role: { code: string; label: string }, permission: PermissionGrid["permissions"][number], granted: boolean) {
    if (
      !granted &&
      permission.group === "Administration" &&
      !window.confirm(`Remove "${permission.label}" from ${role.label}? Anyone whose access depends on it loses it straight away.`)
    )
      return;
    const key = `${role.code}:${permission.code}`;
    setSaving(key);
    setError(null);
    setNotice(null);
    // Show the box as clicked straight away; a refusal puts it back when
    // the grid reloads from the server below.
    setGrid((g) =>
      g && {
        ...g,
        grants: {
          ...g.grants,
          [role.code]: granted
            ? [...(g.grants[role.code] ?? []), permission.code]
            : (g.grants[role.code] ?? []).filter((c) => c !== permission.code),
        },
      },
    );
    try {
      await api(`/api/admin/roles/${role.code}/permissions/${permission.code}`, {
        method: "PUT",
        body: JSON.stringify({ granted }),
      });
      setNotice(`${permission.label} ${granted ? "given to" : "removed from"} ${role.label}.`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
      load();
    } finally {
      setSaving(null);
    }
  }

  if (error && !grid) return <p className="text-sm text-state-alert">{error}</p>;
  if (!grid) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  const groups = [...new Set(grid.permissions.map((p) => p.group))];
  const changed = (role: string, permission: Permission) =>
    grid.changes.find((c) => c.role === role && c.permission === permission);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold text-nmbm-ink">Permissions</h1>
      <p className="mt-1 max-w-3xl text-sm text-nmbm-ink/60">
        What each role can do. Changes apply straight away to everyone with that role, stay in
        place through updates to the system, and are recorded in the audit log. Boxes marked{" "}
        <span className="inline-block h-2 w-2 rounded-full bg-nmbm-gold align-middle" /> differ from the
        starting setup.
      </p>

      {notice && (
        <p className="mt-4 rounded border border-state-ok/20 bg-state-ok-bg px-3 py-2 text-sm text-state-ok">{notice}</p>
      )}
      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded border border-nmbm-ink/10">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-nmbm-ink/10 align-bottom">
              <th className="sticky left-0 bg-nmbm-paper px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-nmbm-ink/50">
                Permission
              </th>
              {grid.roles.map((role) => (
                <th key={role.code} className="w-24 px-1 py-2 text-center text-xs font-medium leading-tight text-nmbm-ink/70">
                  {role.label}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group}>
              <tr>
                <th
                  colSpan={grid.roles.length + 1}
                  className="bg-nmbm-ink/[0.03] px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-nmbm-ink/50"
                >
                  {group}
                </th>
              </tr>
              {grid.permissions
                .filter((p) => p.group === group)
                .map((permission) => (
                  <tr key={permission.code} className="border-t border-nmbm-ink/5">
                    <td className="sticky left-0 bg-nmbm-paper px-3 py-2">
                      <span className="font-medium text-nmbm-ink">{permission.label}</span>
                      <span className="block text-xs text-nmbm-ink/50">{permission.description}</span>
                    </td>
                    {grid.roles.map((role) => {
                      const granted = grid.grants[role.code]?.includes(permission.code) ?? false;
                      const change = changed(role.code, permission.code);
                      const key = `${role.code}:${permission.code}`;
                      return (
                        <td key={role.code} className="px-1 py-2 text-center">
                          <label
                            className="relative inline-flex cursor-pointer items-center justify-center p-1"
                            title={
                              change
                                ? `Changed by ${change.changedByName} on ${new Date(change.changedAt).toLocaleDateString()}`
                                : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              aria-label={`${permission.label} — ${role.label}`}
                              checked={granted}
                              disabled={saving !== null}
                              onChange={(e) => toggle(role, permission, e.target.checked)}
                              className="h-4 w-4"
                            />
                            {change && (
                              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-nmbm-gold" />
                            )}
                            {saving === key && <span className="sr-only">Saving</span>}
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>

      <p className="mt-4 max-w-3xl text-xs text-nmbm-ink/50">
        The system won't let a change leave nobody active who can manage staff or change
        permissions, because nobody could then undo it from here. A role's staff are assigned on
        the Staff page.
      </p>
    </div>
  );
}
