import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import { ASSESSMENT_MODE_LABELS } from "../lib/labels.js";
import type {
  AssessmentFormSummary,
  Me,
  ParticipantAssessment,
  ParticipantDetail,
} from "../lib/types.js";
import { Pill } from "./flags.js";

// M13: the registration form and the needs assessment, on the record.
export function AssessmentsSection({
  record,
  me,
  onError,
}: {
  record: ParticipantDetail;
  me: Me;
  onError: (message: string) => void;
}) {
  const navigate = useNavigate();
  const writable = can(me, "assessments.write");
  const [rows, setRows] = useState<ParticipantAssessment[] | null>(null);
  const [forms, setForms] = useState<AssessmentFormSummary[]>([]);
  const [starting, setStarting] = useState(false);
  const [formId, setFormId] = useState("");
  const [mode, setMode] = useState<"with_staff" | "from_paper">("with_staff");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api<ParticipantAssessment[]>(`/api/participants/${record.id}/assessments`));
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not load assessments");
    }
  }, [record.id, onError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!starting) return;
    api<AssessmentFormSummary[]>("/api/assessment-forms")
      .then((all) => {
        const usable = all.filter((f) => f.active && f.currentVersionId);
        setForms(usable);
        setFormId((current) => current || usable[0]?.id || "");
      })
      .catch((e) => onError(e instanceof ApiError ? e.message : "Could not load forms"));
  }, [starting, onError]);

  async function start() {
    setBusy(true);
    try {
      const created = await api<{ id: string }>(`/api/participants/${record.id}/assessments`, {
        method: "POST",
        body: JSON.stringify({ formId, mode }),
      });
      navigate(`/assessments/${created.id}`);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not start the assessment");
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded border border-nmbm-ink/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
          Forms and assessments
        </h2>
        {writable && record.episodeStatus === "open" && !starting && (
          <button
            onClick={() => setStarting(true)}
            className="rounded border border-nmbm-ink/30 px-3 py-1 text-sm"
          >
            Start a form
          </button>
        )}
      </div>

      {rows && rows.length === 0 && !starting && (
        <p className="mt-3 text-sm text-nmbm-ink/60">None yet.</p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {(rows ?? []).map((a) => (
          <li key={a.id} className="rounded border border-nmbm-ink/10 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                to={`/assessments/${a.id}`}
                className={`font-medium underline-offset-2 hover:underline ${a.status === "voided" ? "text-nmbm-ink/50 line-through" : "text-nmbm-ink"}`}
              >
                {a.formName}
              </Link>
              <Pill tone={a.status === "completed" ? "ok" : a.status === "voided" ? "alert" : "warn"}>
                {a.status === "in_progress" ? "in progress" : a.status}
              </Pill>
            </div>
            <p className="mt-0.5 text-xs text-nmbm-ink/50">
              v{a.versionNumber} · {ASSESSMENT_MODE_LABELS[a.mode].toLowerCase()} · started{" "}
              {a.startedAt.slice(0, 10)}
              {a.startedByName && ` by ${a.startedByName}`}
              {a.completedAt && ` · completed ${a.completedAt.slice(0, 10)}`}
            </p>
            {a.voidReason && <p className="mt-1 text-xs text-state-alert">Voided: {a.voidReason}</p>}
          </li>
        ))}
      </ul>

      {starting && (
        <div className="mt-3 rounded border border-nmbm-ink/15 p-3">
          {forms.length === 0 ? (
            <p className="text-sm text-nmbm-ink/60">
              No forms have been published yet. The Clinical Director or Program Manager sets them
              up under Forms.
            </p>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Form
                <select
                  value={formId}
                  onChange={(e) => setFormId(e.target.value)}
                  className="rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm"
                >
                  {forms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                How
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "with_staff" | "from_paper")}
                  className="rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm"
                >
                  <option value="with_staff">{ASSESSMENT_MODE_LABELS.with_staff}</option>
                  <option value="from_paper">{ASSESSMENT_MODE_LABELS.from_paper}</option>
                </select>
              </label>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              disabled={busy || !formId}
              onClick={start}
              className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-50"
            >
              Start
            </button>
            <button
              onClick={() => setStarting(false)}
              className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
