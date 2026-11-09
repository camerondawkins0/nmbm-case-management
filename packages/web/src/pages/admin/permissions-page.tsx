import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { permissionWarnings, PERMISSION_INFO, type Permission } from "@nmbm/shared";
import { api, ApiError } from "../../lib/api.js";
import type { GridRole, PermissionGrid } from "../../lib/types.js";
import { Pill } from "../../components/flags.js";

type GridPermission = PermissionGrid["permissions"][number];

// NMBM decide who can do what. The defaults in the code are a starting
// point; every box here is theirs to change, takes effect on the next
// click anyone makes, survives deploys, and is logged.
//
// One role at a time by default: nine roles by twenty-five permissions
// in one table was more than anyone could read. The full table is still
// there for comparing, narrowed to the roles and rows asked for.
export default function PermissionsPage() {
  const [grid, setGrid] = useState<PermissionGrid | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // View and role live in the address, so a link or a reload lands on
  // the same role.
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "compare" ? "compare" : "role";
  const setView = (v: "role" | "compare") =>
    setParams((p) => {
      p.set("view", v);
      return p;
    });
  const selectRole = (code: string) =>
    setParams((p) => {
      p.set("view", "role");
      p.set("role", code);
      return p;
    });

  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const [onlyHeld, setOnlyHeld] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [onlyDiffer, setOnlyDiffer] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    api<PermissionGrid>("/api/admin/permissions")
      .then(setGrid)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load permissions"));
  }, []);
  useEffect(load, [load]);

  const say = (ok: string | null, bad: string | null = null) => {
    setNotice(ok);
    setError(bad);
  };

  async function toggle(role: GridRole, permission: GridPermission, granted: boolean) {
    if (
      !granted &&
      permission.group === "Administration" &&
      !window.confirm(
        `Remove "${permission.label}" from ${role.label}? Anyone whose access depends on it loses it straight away.`,
      )
    )
      return;
    setSaving(`${role.code}:${permission.code}`);
    say(null);
    // Show the box as clicked straight away; a refusal puts it back when
    // the grid reloads from the server below.
    setGrid(
      (g) =>
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
      say(`${permission.label} ${granted ? "given to" : "removed from"} ${role.label}.`);
    } catch (e) {
      say(null, e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setSaving(null);
      load();
    }
  }

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (p: GridPermission) =>
      (!area || p.group === area) &&
      (!q || p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  }, [search, area]);

  if (error && !grid) return <p className="text-sm text-state-alert">{error}</p>;
  if (!grid) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  const groups = [...new Set(grid.permissions.map((p) => p.group))];
  const selected = grid.roles.find((r) => r.code === params.get("role")) ?? grid.roles[0];
  const changeOf = (role: string, permission: Permission) =>
    grid.changes.find((c) => c.role === role && c.permission === permission);
  const has = (role: string, permission: Permission) => grid.grants[role]?.includes(permission) ?? false;
  const filtersOn = Boolean(search || area || onlyHeld || onlyChanged || onlyDiffer);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-nmbm-ink">Permissions</h1>
          <p className="mt-1 max-w-3xl text-sm text-nmbm-ink/60">
            What each role can do. Changes apply straight away to everyone with that role, stay in place through updates
            to the system, and are recorded in the audit log.
          </p>
        </div>
        <button
          onClick={() => setCreating((c) => !c)}
          className="rounded bg-nmbm-ink px-4 py-2 text-sm font-medium text-nmbm-paper"
        >
          New role
        </button>
      </div>

      {creating && (
        <NewRoleForm
          roles={grid.roles}
          onCancel={() => setCreating(false)}
          onCreated={(role) => {
            setCreating(false);
            say(`${role.label} created. Choose what it can do below, then give it to people on the Staff page.`);
            load();
            selectRole(role.code);
          }}
        />
      )}

      {notice && (
        <p className="mt-4 rounded border border-state-ok/20 bg-state-ok-bg px-3 py-2 text-sm text-state-ok">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-end gap-3 border-b border-nmbm-ink/10 pb-4">
        <div className="inline-flex rounded border border-nmbm-ink/20 p-0.5 text-sm" role="tablist">
          {(["role", "compare"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded px-3 py-1 ${view === v ? "bg-nmbm-ink text-nmbm-paper" : "text-nmbm-ink/70"}`}
            >
              {v === "role" ? "By role" : "Compare roles"}
            </button>
          ))}
        </div>
        <label className="flex flex-col text-xs text-nmbm-ink/60">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. notes, export"
            className="mt-1 w-52 rounded border border-nmbm-ink/20 px-2 py-1 text-sm text-nmbm-ink"
          />
        </label>
        <label className="flex flex-col text-xs text-nmbm-ink/60">
          Area
          <select
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="mt-1 rounded border border-nmbm-ink/20 px-2 py-1 text-sm text-nmbm-ink"
          >
            <option value="">All areas</option>
            {groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1 text-sm text-nmbm-ink/70">
          {view === "role" && (
            <Check checked={onlyHeld} onChange={setOnlyHeld}>
              Only what it can do
            </Check>
          )}
          {view === "compare" && (
            <Check checked={onlyDiffer} onChange={setOnlyDiffer}>
              Only where they differ
            </Check>
          )}
          {/* A custom role has no starting setup to differ from. */}
          {(view === "compare" || selected?.builtin) && (
            <Check checked={onlyChanged} onChange={setOnlyChanged}>
              Only changes from the starting setup
            </Check>
          )}
        </div>
        {filtersOn && (
          <button
            onClick={() => {
              setSearch("");
              setArea("");
              setOnlyHeld(false);
              setOnlyChanged(false);
              setOnlyDiffer(false);
            }}
            className="pb-1 text-sm text-nmbm-ink/60 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {view === "role" && selected && (
        <div className="mt-4 grid gap-6 md:grid-cols-[15rem_1fr]">
          <RoleList grid={grid} selected={selected.code} onSelect={selectRole} />
          <RoleDetail
            key={selected.code}
            grid={grid}
            role={selected}
            groups={groups}
            rows={grid.permissions.filter(
              (p) =>
                matches(p) &&
                (!onlyHeld || has(selected.code, p.code)) &&
                (!onlyChanged || !selected.builtin || changeOf(selected.code, p.code)),
            )}
            saving={saving}
            onToggle={toggle}
            changeOf={changeOf}
            onChanged={(message) => {
              say(message);
              load();
            }}
            onRetired={(label) => {
              say(`${label} retired.`);
              setParams((p) => {
                p.delete("role");
                return p;
              });
              load();
            }}
            onError={(message) => say(null, message)}
          />
        </div>
      )}

      {view === "compare" && (
        <CompareView
          grid={grid}
          groups={groups}
          hidden={hidden}
          setHidden={setHidden}
          rows={(shown) =>
            grid.permissions.filter(
              (p) =>
                matches(p) &&
                (!onlyDiffer || new Set(shown.map((r) => has(r.code, p.code))).size > 1) &&
                (!onlyChanged || shown.some((r) => changeOf(r.code, p.code))),
            )
          }
          saving={saving}
          onToggle={toggle}
          changeOf={changeOf}
          onOpen={selectRole}
        />
      )}

      <p className="mt-6 max-w-3xl text-xs text-nmbm-ink/50">
        The system won't let a change leave nobody active who can manage staff or change permissions, because nobody
        could then undo it from here. Someone who can manage staff but not change permissions can only give out roles
        that do nothing they can't do themselves. A role's staff are assigned on the Staff page.
      </p>
    </div>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      {children}
    </label>
  );
}

function ChangedDot({ change }: { change: PermissionGrid["changes"][number] | undefined }) {
  if (!change) return null;
  return (
    <span
      title={`Changed from the starting setup by ${change.changedByName} on ${new Date(change.changedAt).toLocaleDateString()}`}
      className="inline-block h-2 w-2 shrink-0 rounded-full bg-nmbm-gold"
    >
      <span className="sr-only">Changed from the starting setup</span>
    </span>
  );
}

function RoleList({
  grid,
  selected,
  onSelect,
}: {
  grid: PermissionGrid;
  selected: string;
  onSelect: (code: string) => void;
}) {
  const builtin = grid.roles.filter((r) => r.builtin);
  const custom = grid.roles.filter((r) => !r.builtin);
  const item = (role: GridRole) => {
    const changed = grid.changes.some((c) => c.role === role.code);
    return (
      <li key={role.code}>
        <button
          onClick={() => onSelect(role.code)}
          aria-current={role.code === selected ? "true" : undefined}
          className={`w-full rounded px-3 py-2 text-left ${
            role.code === selected ? "bg-nmbm-ink text-nmbm-paper" : "text-nmbm-ink hover:bg-nmbm-ink/5"
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            {role.label}
            {changed && (
              <span className="h-1.5 w-1.5 rounded-full bg-nmbm-gold" title="Changed from the starting setup" />
            )}
          </span>
          <span className={`block text-xs ${role.code === selected ? "text-nmbm-paper/70" : "text-nmbm-ink/50"}`}>
            {role.people} {role.people === 1 ? "person" : "people"} · {grid.grants[role.code]?.length ?? 0} of{" "}
            {grid.permissions.length}
          </span>
        </button>
      </li>
    );
  };
  return (
    <>
      {/* On a phone the full list would push the permissions off screen. */}
      <label className="flex flex-col text-xs text-nmbm-ink/60 md:hidden">
        Role
        <select
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="mt-1 rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm text-nmbm-ink"
        >
          <optgroup label="Built-in roles">
            {builtin.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </optgroup>
          {custom.length > 0 && (
            <optgroup label="Added roles">
              {custom.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <nav aria-label="Roles" className="hidden flex-col gap-4 md:flex">
        <div>
          <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-nmbm-ink/50">Built-in roles</h2>
          <ul className="mt-1 flex flex-col gap-0.5">{builtin.map(item)}</ul>
        </div>
        <div>
          <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-nmbm-ink/50">Added roles</h2>
          {custom.length === 0 ? (
            <p className="mt-1 px-3 text-xs text-nmbm-ink/50">None yet. "New role" adds one.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">{custom.map(item)}</ul>
          )}
        </div>
      </nav>
    </>
  );
}

function RoleDetail({
  grid,
  role,
  groups,
  rows,
  saving,
  onToggle,
  changeOf,
  onChanged,
  onRetired,
  onError,
}: {
  grid: PermissionGrid;
  role: GridRole;
  groups: string[];
  rows: GridPermission[];
  saving: string | null;
  onToggle: (role: GridRole, permission: GridPermission, granted: boolean) => void;
  changeOf: (role: string, permission: Permission) => PermissionGrid["changes"][number] | undefined;
  onChanged: (message: string) => void;
  onRetired: (label: string) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const held = grid.grants[role.code] ?? [];
  const warnings = permissionWarnings(held);

  async function retire() {
    if (
      !window.confirm(
        `Retire ${role.label}? It can't be given to anyone afterward. Past records that mention it keep its name.`,
      )
    )
      return;
    try {
      await api(`/api/admin/roles/${role.code}/retire`, { method: "POST" });
      onRetired(role.label);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not retire the role");
    }
  }

  return (
    <section aria-label={role.label} className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-nmbm-ink">
            {role.label}
            <Pill tone="muted">{role.builtin ? "Built-in" : "Custom"}</Pill>
          </h2>
          {role.description && <p className="mt-0.5 text-sm text-nmbm-ink/70">{role.description}</p>}
          <p className="mt-0.5 text-xs text-nmbm-ink/50">
            {role.people} active {role.people === 1 ? "person has" : "people have"} this role · {held.length} of{" "}
            {grid.permissions.length} permissions
            {role.builtin && " · gold dots mark changes from the starting setup"}
          </p>
        </div>
        {!role.builtin && !editing && (
          <div className="flex gap-2">
            <button onClick={() => setEditing(true)} className="rounded border border-nmbm-ink/30 px-3 py-1 text-sm">
              Rename
            </button>
            <button
              onClick={retire}
              disabled={role.people > 0}
              title={role.people > 0 ? "Take this role from everyone on the Staff page first" : undefined}
              className="rounded border border-nmbm-ink/30 px-3 py-1 text-sm text-nmbm-ink/70 hover:border-state-alert hover:text-state-alert disabled:opacity-40 disabled:hover:border-nmbm-ink/30 disabled:hover:text-nmbm-ink/70"
            >
              Retire
            </button>
          </div>
        )}
      </div>

      {editing && (
        <RoleNameForm
          initial={{ label: role.label, description: role.description ?? "" }}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await api(`/api/admin/roles/${role.code}`, {
              method: "PATCH",
              body: JSON.stringify(body),
            });
            setEditing(false);
            onChanged(`${body.label} saved.`);
          }}
        />
      )}

      {warnings.length > 0 && (
        <div className="mt-4 rounded border border-state-warn/20 bg-state-warn-bg px-3 py-2 text-sm text-state-warn">
          <p className="font-medium">Some of what this role has won't work on its own:</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w.permission}>
                {PERMISSION_INFO[w.permission].label} also needs{" "}
                {w.needs.map((n) => `"${PERMISSION_INFO[n].label}"`).join(" or ")}, because {w.why}.
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-nmbm-ink/50">No permissions match these filters.</p>
      ) : (
        groups
          .filter((g) => rows.some((p) => p.group === g))
          .map((group) => (
            <fieldset key={group} className="mt-5">
              <legend className="text-xs font-semibold uppercase tracking-wide text-nmbm-ink/50">{group}</legend>
              <div className="mt-1 divide-y divide-nmbm-ink/5 rounded border border-nmbm-ink/10">
                {rows
                  .filter((p) => p.group === group)
                  .map((permission) => {
                    const granted = held.includes(permission.code);
                    const key = `${role.code}:${permission.code}`;
                    return (
                      <label
                        key={permission.code}
                        className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-nmbm-ink/[0.02]"
                      >
                        <input
                          type="checkbox"
                          checked={granted}
                          disabled={saving !== null}
                          onChange={(e) => onToggle(role, permission, e.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm font-medium text-nmbm-ink">
                            {permission.label}
                            <ChangedDot change={changeOf(role.code, permission.code)} />
                            {saving === key && <span className="text-xs font-normal text-nmbm-ink/50">Saving…</span>}
                          </span>
                          <span className="block text-xs text-nmbm-ink/50">{permission.description}</span>
                        </span>
                      </label>
                    );
                  })}
              </div>
            </fieldset>
          ))
      )}
    </section>
  );
}

function CompareView({
  grid,
  groups,
  hidden,
  setHidden,
  rows,
  saving,
  onToggle,
  changeOf,
  onOpen,
}: {
  grid: PermissionGrid;
  groups: string[];
  hidden: Set<string>;
  setHidden: (s: Set<string>) => void;
  rows: (shown: GridRole[]) => GridPermission[];
  saving: string | null;
  onToggle: (role: GridRole, permission: GridPermission, granted: boolean) => void;
  changeOf: (role: string, permission: Permission) => PermissionGrid["changes"][number] | undefined;
  onOpen: (code: string) => void;
}) {
  const shown = grid.roles.filter((r) => !hidden.has(r.code));
  const visible = rows(shown);
  const flip = (code: string) => {
    const next = new Set(hidden);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setHidden(next);
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-xs text-nmbm-ink/60">Roles shown:</span>
        {grid.roles.map((r) => (
          <button
            key={r.code}
            onClick={() => flip(r.code)}
            aria-pressed={!hidden.has(r.code)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              hidden.has(r.code) ? "border-nmbm-ink/20 text-nmbm-ink/50" : "border-nmbm-ink bg-nmbm-ink text-nmbm-paper"
            }`}
          >
            {r.label}
          </button>
        ))}
        {hidden.size > 0 && (
          <button onClick={() => setHidden(new Set())} className="ml-1 text-xs text-nmbm-ink/60 underline">
            Show all
          </button>
        )}
        {hidden.size === 0 && grid.roles.length > 2 && (
          <button
            onClick={() => setHidden(new Set(grid.roles.map((r) => r.code)))}
            className="ml-1 text-xs text-nmbm-ink/60 underline"
          >
            Hide all
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="mt-6 text-sm text-nmbm-ink/50">Pick the roles to compare.</p>
      ) : visible.length === 0 ? (
        <p className="mt-6 text-sm text-nmbm-ink/50">No permissions match these filters.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border border-nmbm-ink/10">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-nmbm-ink/10 align-bottom">
                <th className="sticky left-0 z-10 min-w-[14rem] bg-nmbm-paper px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-nmbm-ink/50">
                  Permission
                </th>
                {shown.map((role) => (
                  <th
                    key={role.code}
                    className="w-24 px-1 py-2 text-center text-xs font-medium leading-tight text-nmbm-ink/70"
                  >
                    <button onClick={() => onOpen(role.code)} className="hover:underline" title={`Open ${role.label}`}>
                      {role.label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            {groups
              .filter((g) => visible.some((p) => p.group === g))
              .map((group) => (
                <tbody key={group}>
                  <tr>
                    <th
                      colSpan={shown.length + 1}
                      className="bg-nmbm-ink/[0.03] px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-nmbm-ink/50"
                    >
                      {group}
                    </th>
                  </tr>
                  {visible
                    .filter((p) => p.group === group)
                    .map((permission) => (
                      <tr key={permission.code} className="border-t border-nmbm-ink/5">
                        <td className="sticky left-0 z-10 bg-nmbm-paper px-3 py-2" title={permission.description}>
                          <span className="font-medium text-nmbm-ink">{permission.label}</span>
                        </td>
                        {shown.map((role) => {
                          const granted = grid.grants[role.code]?.includes(permission.code) ?? false;
                          const change = changeOf(role.code, permission.code);
                          return (
                            <td key={role.code} className="px-1 py-2 text-center">
                              <label className="relative inline-flex cursor-pointer items-center justify-center p-1">
                                <input
                                  type="checkbox"
                                  aria-label={`${permission.label} — ${role.label}`}
                                  checked={granted}
                                  disabled={saving !== null}
                                  onChange={(e) => onToggle(role, permission, e.target.checked)}
                                  className="h-4 w-4"
                                />
                                {change && (
                                  <span className="absolute -right-0.5 -top-0.5">
                                    <ChangedDot change={change} />
                                  </span>
                                )}
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
      )}
    </div>
  );
}

function NewRoleForm({
  roles,
  onCancel,
  onCreated,
}: {
  roles: GridRole[];
  onCancel: () => void;
  onCreated: (role: { code: string; label: string }) => void;
}) {
  const [copyFrom, setCopyFrom] = useState("");
  return (
    <RoleNameForm
      initial={{ label: "", description: "" }}
      title="New role"
      submitLabel="Create role"
      onCancel={onCancel}
      extra={
        <label className="flex flex-col text-xs text-nmbm-ink/60">
          Start from
          <select
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
            className="mt-1 rounded border border-nmbm-ink/20 px-2 py-1 text-sm text-nmbm-ink"
          >
            <option value="">Nothing — I'll choose each permission</option>
            {roles.map((r) => (
              <option key={r.code} value={r.code}>
                A copy of {r.label}
              </option>
            ))}
          </select>
        </label>
      }
      onSubmit={async (body) => {
        const role = await api<{ code: string; label: string }>("/api/admin/roles", {
          method: "POST",
          body: JSON.stringify({ ...body, copyFrom: copyFrom || null }),
        });
        onCreated(role);
      }}
    />
  );
}

// Shared by making a role and renaming one: the same two fields, and
// the server's refusal (a name already taken) shown where it was typed.
function RoleNameForm({
  initial,
  title,
  submitLabel,
  extra,
  onCancel,
  onSubmit,
}: {
  initial: { label: string; description: string };
  title?: string;
  submitLabel: string;
  extra?: React.ReactNode;
  onCancel: () => void;
  onSubmit: (body: { label: string; description: string | null }) => Promise<void>;
}) {
  const [label, setLabel] = useState(initial.label);
  const [description, setDescription] = useState(initial.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        label: label.trim(),
        description: description.trim() || null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 rounded border border-nmbm-ink/15 bg-nmbm-ink/[0.02] p-4">
      {title && <h2 className="text-sm font-semibold text-nmbm-ink">{title}</h2>}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-nmbm-ink/60">
          Name
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            minLength={2}
            maxLength={80}
            autoFocus
            className="mt-1 w-56 rounded border border-nmbm-ink/20 px-2 py-1 text-sm text-nmbm-ink"
          />
        </label>
        <label className="flex min-w-[16rem] flex-1 flex-col text-xs text-nmbm-ink/60">
          What it's for (optional)
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            className="mt-1 rounded border border-nmbm-ink/20 px-2 py-1 text-sm text-nmbm-ink"
          />
        </label>
        {extra}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || label.trim().length < 2}
            className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-50"
          >
            {submitLabel}
          </button>
          <button type="button" onClick={onCancel} className="rounded border border-nmbm-ink/30 px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-state-alert">{error}</p>}
    </form>
  );
}
