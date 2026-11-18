import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api.js";
import type { AppSetting } from "../../lib/types.js";

// M31: NMBM has no IT staff, so anything they'll want to tune is a
// field here rather than a request for a deploy. Every change is
// audited — some of these, like the former-worker window, decide who
// can read a client's record.
export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSetting[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AppSetting[]>("/api/admin/settings")
      .then((rows) => {
        setSettings(rows);
        setDrafts(Object.fromEntries(rows.map((r) => [r.key, String(r.value)])));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load settings"));
  }, []);

  useEffect(load, [load]);

  async function save(setting: AppSetting) {
    setNotice(null);
    setError(null);
    try {
      await api(`/api/admin/settings/${setting.key}`, {
        method: "PUT",
        body: JSON.stringify({ value: Number(drafts[setting.key]) }),
      });
      setNotice(`${setting.label} saved.`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    }
  }

  if (error && !settings) return <p className="text-sm text-state-alert">{error}</p>;
  if (!settings) return <p className="text-sm text-ds-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="ds-display">Settings</h1>
      <p className="mt-1 text-sm text-ds-muted">
        Changes apply immediately and are recorded in the audit log.
      </p>

      {notice && (
        <p className="nmbm-alert nmbm-alert--ok mt-4">
          {notice}
        </p>
      )}
      {error && (
        <p className="nmbm-alert nmbm-alert--alert mt-4">
          {error}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-4">
        {settings.map((setting) => {
          const draft = drafts[setting.key] ?? "";
          const changed = draft !== String(setting.value);
          return (
            <li key={setting.key} className="nmbm-card nmbm-card--dense">
              <label htmlFor={setting.key} className="text-sm font-semibold text-ds-ink">
                {setting.label}
              </label>
              <p className="mt-1 text-sm text-ds-muted">{setting.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  id={setting.key}
                  type="number"
                  min={setting.min}
                  max={setting.max}
                  step={1}
                  value={draft}
                  onChange={(e) => setDrafts({ ...drafts, [setting.key]: e.target.value })}
                  className="nmbm-control w-28"
                />
                <button
                  disabled={!changed || draft === ""}
                  onClick={() => save(setting)}
                  className="nmbm-btn nmbm-btn--dark nmbm-btn--md"
                >
                  Save
                </button>
                <span className="text-xs text-ds-muted">
                  {setting.min}–{setting.max} · default {setting.default}
                </span>
              </div>
              <p className="mt-2 text-xs text-ds-muted">
                {setting.updatedAt
                  ? `Last changed by ${setting.updatedByName} on ${new Date(setting.updatedAt).toLocaleDateString()}.`
                  : "Using the default."}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
