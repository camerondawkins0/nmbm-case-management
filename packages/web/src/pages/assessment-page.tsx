import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { visibleQuestionIds, type AnswerValue, type Answers } from "@nmbm/shared";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import { ASSESSMENT_MODE_LABELS } from "../lib/labels.js";
import type { AssessmentDetail, FormQuestion, Me, ParticipantDetail } from "../lib/types.js";
import { Pill } from "../components/flags.js";
import { QuestionField, answerText } from "../components/question-field.js";

// Consecutive questions under the same heading print together.
function bySection(questions: FormQuestion[]) {
  const groups: { section: string | null; questions: FormQuestion[] }[] = [];
  for (const q of questions) {
    const last = groups[groups.length - 1];
    if (last && last.section === q.section) last.questions.push(q);
    else groups.push({ section: q.section, questions: [q] });
  }
  return groups;
}

type SaveState = "saved" | "unsaved" | "saving" | "failed";

export default function AssessmentPage({ me }: { me: Me }) {
  const { id } = useParams();
  const [assessment, setAssessment] = useState<AssessmentDetail | null>(null);
  const [participant, setParticipant] = useState<ParticipantDetail | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Questions changed since the last save. Only these are sent, so two
  // people on the same form don't overwrite each other's answers.
  const dirty = useRef(new Set<string>());
  const answersRef = useRef<Answers>({});
  answersRef.current = answers;

  const load = useCallback(async () => {
    try {
      const a = await api<AssessmentDetail>(`/api/assessments/${id}`);
      setAssessment(a);
      setAnswers(a.answers);
      dirty.current.clear();
      setSaveState("saved");
      setParticipant(await api<ParticipantDetail>(`/api/participants/${a.participantId}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the assessment");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const flush = useCallback(async () => {
    if (dirty.current.size === 0) return true;
    const keys = [...dirty.current];
    dirty.current.clear();
    const patch = Object.fromEntries(keys.map((k) => [k, answersRef.current[k] ?? null]));
    setSaveState("saving");
    try {
      await api(`/api/assessments/${id}/answers`, { method: "PATCH", body: JSON.stringify({ answers: patch }) });
      setSaveState(dirty.current.size > 0 ? "unsaved" : "saved");
      return true;
    } catch (e) {
      // Put them back so the next attempt sends them again.
      keys.forEach((k) => dirty.current.add(k));
      setSaveState("failed");
      setError(e instanceof ApiError ? e.message : "Could not save");
      return false;
    }
  }, [id]);

  // Saved a moment after the last change, so typing a paragraph is one
  // request rather than one per letter.
  useEffect(() => {
    if (saveState !== "unsaved") return;
    const timer = setTimeout(flush, 800);
    return () => clearTimeout(timer);
  }, [answers, saveState, flush]);

  function change(stableId: string, value: AnswerValue | null) {
    setError(null);
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === null) delete next[stableId];
      else next[stableId] = value;
      return next;
    });
    dirty.current.add(stableId);
    setSaveState("unsaved");
  }

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      if (!(await flush())) return;
      await api(`/api/assessments/${id}/complete`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not complete");
    } finally {
      setBusy(false);
    }
  }

  async function voidIt() {
    const reason = window.prompt(
      "Why is this assessment being voided? It stays on the record, marked void.",
    );
    if (!reason) return;
    setBusy(true);
    try {
      await api(`/api/assessments/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not void");
    } finally {
      setBusy(false);
    }
  }

  if (error && !assessment) return <p className="text-sm text-state-alert">{error}</p>;
  if (!assessment) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  const { form } = assessment;
  const editable = assessment.status === "in_progress" && can(me, "assessments.write");
  const visible = visibleQuestionIds(form.questions, answers);
  const shown = form.questions.filter((q) => visible.has(q.stableId));
  const name = participant ? `${participant.firstName} ${participant.lastName}` : "";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="print:hidden">
        <Link
          to={`/participants/${assessment.participantId}`}
          className="text-sm text-nmbm-ink/60 underline-offset-2 hover:underline"
        >
          ← {name || "Back to the record"}
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-nmbm-ink">{form.formName}</h1>
          <p className="mt-1 text-sm text-nmbm-ink/60">
            {name && `${name} · `}version {form.versionNumber} ·{" "}
            {ASSESSMENT_MODE_LABELS[assessment.mode].toLowerCase()} · started{" "}
            {assessment.startedAt.slice(0, 10)}
            {assessment.startedByName && ` by ${assessment.startedByName}`}
          </p>
          {assessment.completedAt && (
            <p className="text-sm text-nmbm-ink/60">
              Completed {assessment.completedAt.slice(0, 10)}
              {assessment.completedByName && ` by ${assessment.completedByName}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {assessment.status === "completed" && <Pill tone="ok">completed</Pill>}
          {assessment.status === "voided" && <Pill tone="alert">voided</Pill>}
          {editable && (
            <span className="text-xs text-nmbm-ink/50" aria-live="polite">
              {saveState === "saving"
                ? "Saving…"
                : saveState === "unsaved"
                  ? "Unsaved changes"
                  : saveState === "failed"
                    ? "Not saved"
                    : "All changes saved"}
            </span>
          )}
          {assessment.status !== "in_progress" && (
            <button
              onClick={() => window.print()}
              className="rounded border border-nmbm-ink/30 px-3 py-1 text-sm"
            >
              Print
            </button>
          )}
        </div>
      </div>

      {assessment.voidReason && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          Voided: {assessment.voidReason}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert print:hidden">
          {error}
        </p>
      )}

      {editable ? (
        <form
          className="mt-6 flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (window.confirm("Complete this assessment? It can't be edited afterwards.")) complete();
          }}
        >
          {bySection(shown).map((group, i) => (
            <fieldset key={i} className="rounded border border-nmbm-ink/10 p-4">
              {group.section && (
                <legend className="px-1 text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
                  {group.section}
                </legend>
              )}
              <div className="flex flex-col gap-5">
                {group.questions.map((q) => (
                  <QuestionField
                    key={q.stableId}
                    question={q}
                    value={answers[q.stableId]}
                    onChange={(v) => change(q.stableId, v)}
                  />
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-nmbm-ink px-4 py-2 text-sm font-medium text-nmbm-paper disabled:opacity-50"
            >
              Complete
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={voidIt}
              className="rounded border border-nmbm-ink/30 px-4 py-2 text-sm"
            >
              Void
            </button>
          </div>
          <p className="text-xs text-nmbm-ink/50">
            Answers save as you go; you can leave and come back. Questions marked * are required
            when they're shown.
          </p>
        </form>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {bySection(shown).map((group, i) => (
            <section key={i} className="rounded border border-nmbm-ink/10 p-4 print:border-0 print:p-0">
              {group.section && (
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
                  {group.section}
                </h2>
              )}
              <dl className="flex flex-col gap-3">
                {group.questions.map((q) => (
                  <div key={q.stableId}>
                    <dt className="text-sm font-medium text-nmbm-ink">{q.prompt}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm text-nmbm-ink/80">
                      {answerText(q, answers[q.stableId]) ?? (
                        <span className="text-nmbm-ink/40">Not answered</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {assessment.status === "completed" && can(me, "assessments.write") && (
            <div className="print:hidden">
              <button
                disabled={busy}
                onClick={voidIt}
                className="text-sm text-nmbm-ink/50 underline-offset-2 hover:text-state-alert hover:underline"
              >
                Void this assessment
              </button>
              <p className="mt-1 text-xs text-nmbm-ink/50">
                A completed assessment can't be edited. To correct one, void it and start a new one.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
