import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api.js";
import type { AppSetting } from "../../lib/types.js";
import { formatDay } from "../../components/dates.js";

// M31: NMBM has no IT staff, so anything they'll want to tune is a
// field here rather than a request for a deploy. Every change is
// audited — some of these, like the former-worker window, decide who
// can read a client's record.
//
// Each setting is locked until someone chooses to change it, and a change
// is confirmed before it is sent. A box that was always editable made it
// unclear whether a number typed into it had been saved, and these numbers
// change who can see what the moment they are.
export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return api<AppSetting[]>("/api/admin/settings")
      .then(setSettings)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load settings"));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !settings) return <p className="nmbm-alert nmbm-alert--alert">{error}</p>;
  if (!settings) return <p className="text-sm text-ds-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="ds-display">Settings</h1>
      <p className="mt-1 text-sm text-ds-muted">
        A change applies to everyone as soon as it is saved, and is recorded in the audit log.
      </p>
      <ul className="mt-6 flex flex-col gap-4">
        {settings.map((setting) => (
          <SettingCard key={setting.key} setting={setting} onSaved={load} />
        ))}
      </ul>
    </div>
  );
}

// "Former case manager access (days)" → "days", so a value reads "30 days".
const unitOf = (label: string) => /\(([^)]+)\)\s*$/.exec(label)?.[1] ?? "";
const nameOf = (label: string) => label.replace(/\s*\([^)]+\)\s*$/, "");
const withUnit = (n: number | string, unit: string) => (unit ? `${n} ${Number(n) === 1 ? unit.replace(/s$/, "") : unit}` : String(n));

type Mode = "locked" | "editing" | "confirming" | "saving";

function SettingCard({ setting, onSaved }: { setting: AppSetting; onSaved: () => Promise<unknown> }) {
  const [mode, setMode] = useState<Mode>("locked");
  const [draft, setDraft] = useState(String(setting.value));
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const unit = unitOf(setting.label);
  const name = nameOf(setting.label);
  const id = `setting-${setting.key}`;

  // Focus follows the step: into the box on Edit, onto the confirm button
  // when asked, back to Edit once it's locked again, so a keyboard user is
  // never left on a control that has just gone away.
  useEffect(() => {
    if (mode === "editing") input.current?.select();
    if (mode === "confirming") confirmButton.current?.focus();
  }, [mode]);

  function startEditing() {
    setDraft(String(setting.value));
    setProblem(null);
    setSaved(null);
    setMode("editing");
  }

  function cancel() {
    setDraft(String(setting.value));
    setProblem(null);
    setMode("locked");
    requestAnimationFrame(() => editButton.current?.focus());
  }

  // Checked here first so the confirmation never offers a value the server
  // would refuse; the server checks again.
  function review(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n)) return setProblem("Enter a whole number.");
    if (n < setting.min || n > setting.max)
      return setProblem(`Choose between ${setting.min} and ${withUnit(setting.max, unit)}.`);
    if (n === setting.value) return setProblem(`That is already the setting. Change it, or cancel.`);
    setProblem(null);
    setMode("confirming");
  }

  async function confirm() {
    setMode("saving");
    try {
      await api(`/api/admin/settings/${setting.key}`, { method: "PUT", body: JSON.stringify({ value: Number(draft) }) });
      await onSaved();
      setSaved(`Saved. ${name} is now ${withUnit(draft, unit)}.`);
      setMode("locked");
      requestAnimationFrame(() => editButton.current?.focus());
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : "Could not save. Nothing was changed.");
      setMode("editing");
    }
  }

  const unlocked = mode === "editing";

  return (
    <li className="nmbm-card nmbm-card--dense">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="ds-section-heading">
            {name}
          </label>
          <p className="mt-1 text-sm text-ds-muted">{setting.description}</p>
        </div>
        {mode === "locked" && (
          <button ref={editButton} type="button" onClick={startEditing} className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm">
            Edit<span className="nmbm-sr"> {name}</span>
          </button>
        )}
      </div>

      {/* noValidate: the browser's own bubble would stop the submit before the
          range message below, which says what is allowed, could show. */}
      <form onSubmit={review} noValidate className="mt-3 flex flex-wrap items-center gap-3">
        <span className={`ds-lockable${unlocked ? "" : " is-locked"}`}>
          {!unlocked && <LockIcon />}
          <input
            ref={input}
            id={id}
            type="number"
            inputMode="numeric"
            min={setting.min}
            max={setting.max}
            step={1}
            value={mode === "locked" ? String(setting.value) : draft}
            onChange={(e) => setDraft(e.target.value)}
            readOnly={!unlocked}
            aria-readonly={!unlocked}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-range${problem ? ` ${id}-problem` : ""}`}
            className={`nmbm-control ds-num w-28${problem ? " is-invalid" : ""}`}
          />
        </span>
        {unit && <span className="text-sm text-ds-secondary">{unit}</span>}
        {unlocked && (
          <>
            <button type="submit" className="nmbm-btn nmbm-btn--dark nmbm-btn--md">
              Save
            </button>
            <button type="button" onClick={cancel} className="nmbm-btn nmbm-btn--quiet nmbm-btn--md">
              Cancel
            </button>
          </>
        )}
        <span id={`${id}-range`} className="text-xs text-ds-muted">
          {setting.min}–{withUnit(setting.max, unit)} · default {setting.default}
        </span>
      </form>

      {problem && (
        <p id={`${id}-problem`} className="mt-2 text-sm text-state-alert" role="alert">
          {problem}
        </p>
      )}

      {(mode === "confirming" || mode === "saving") && (
        <div className="nmbm-alert nmbm-alert--warn mt-3 flex-col !items-stretch !gap-3" role="alertdialog" aria-labelledby={`${id}-confirm`}>
          <p id={`${id}-confirm`}>
            Change <strong>{name.toLowerCase()}</strong> from{" "}
            <Amount n={setting.value} unit={unit} /> to <Amount n={draft} unit={unit} />? It applies to everyone straight away.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={confirmButton}
              type="button"
              onClick={confirm}
              disabled={mode === "saving"}
              className="nmbm-btn nmbm-btn--dark nmbm-btn--md"
            >
              {mode === "saving" ? "Saving…" : "Yes, save the change"}
            </button>
            <button
              type="button"
              onClick={() => setMode("editing")}
              disabled={mode === "saving"}
              className="nmbm-btn nmbm-btn--secondary nmbm-btn--md"
            >
              Go back
            </button>
          </div>
        </div>
      )}

      {saved && mode === "locked" && (
        <p className="nmbm-alert nmbm-alert--ok mt-3" role="status">
          {saved}
        </p>
      )}

      <p className="mt-2 text-xs text-ds-muted">
        {setting.updatedAt
          ? `Last changed by ${setting.updatedByName} on ${formatDay(setting.updatedAt)}.`
          : "Using the default."}
      </p>
    </li>
  );
}

// The figure in the numeric face, the unit in the sentence's own.
function Amount({ n, unit }: { n: number | string; unit: string }) {
  const [figure, ...rest] = withUnit(n, unit).split(" ");
  return (
    <strong>
      <span className="ds-num">{figure}</span>
      {rest.length > 0 && ` ${rest.join(" ")}`}
    </strong>
  );
}

function LockIcon() {
  return (
    <svg className="ds-lockable__icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
