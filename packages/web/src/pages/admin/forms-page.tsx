import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../lib/api.js";
import type { AssessmentFormSummary } from "../../lib/types.js";
import { Pill } from "../../components/flags.js";

// M11/M13: NMBM's own forms, set up here rather than in code, because
// the registration form and the needs assessment are theirs to change.
export default function FormsPage() {
  const navigate = useNavigate();
  const [forms, setForms] = useState<AssessmentFormSummary[] | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AssessmentFormSummary[]>("/api/assessment-forms")
      .then(setForms)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load forms"));
  }, []);
  useEffect(load, [load]);

  async function create() {
    setError(null);
    try {
      const form = await api<{ id: string }>("/api/assessment-forms", {
        method: "POST",
        body: JSON.stringify({ name, description: description || null }),
      });
      navigate(`/admin/forms/${form.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the form");
    }
  }

  if (error && !forms) return <p className="text-sm text-state-alert">{error}</p>;
  if (!forms) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-nmbm-ink">Forms</h1>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper"
          >
            New form
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-nmbm-ink/60">
        The forms staff fill in on a participant's record. A published version never changes —
        editing a form makes a new version, and everything already filled in stays with the
        wording it was answered against.
      </p>

      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      {creating && (
        <div className="mt-4 rounded border border-nmbm-ink/15 p-4">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Comprehensive needs assessment"
              className="rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="mt-3 flex flex-col gap-1 text-sm">
            Description (optional)
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              disabled={!name.trim()}
              onClick={create}
              className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-50"
            >
              Create and add questions
            </button>
            <button
              onClick={() => setCreating(false)}
              className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {forms.length === 0 && !creating && (
        <p className="mt-6 text-sm text-nmbm-ink/60">No forms yet.</p>
      )}
      <ul className="mt-6 flex flex-col gap-2">
        {forms.map((f) => (
          <li key={f.id} className="rounded border border-nmbm-ink/10 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                to={`/admin/forms/${f.id}`}
                className="font-medium text-nmbm-ink underline-offset-2 hover:underline"
              >
                {f.name}
              </Link>
              <div className="flex gap-2">
                {!f.active && <Pill tone="alert">retired</Pill>}
                {f.currentVersionNumber ? (
                  <Pill tone="ok">v{f.currentVersionNumber} live</Pill>
                ) : (
                  <Pill tone="warn">not published</Pill>
                )}
                {f.draftVersionId && f.currentVersionNumber && <Pill tone="warn">draft in progress</Pill>}
              </div>
            </div>
            {f.description && <p className="mt-0.5 text-sm text-nmbm-ink/60">{f.description}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
