import { useState } from "react";
import { FOLLOW_UP_OUTCOMES, FOLLOW_UP_OUTCOME_LABELS, type FollowUpOutcome } from "@nmbm/shared";
import { api, ApiError } from "../lib/api.js";

// M12: one call attempt. Used from QA's queue and from the record itself,
// so the two can't ask for different things.
export function FollowUpCallForm({
  episodeId,
  months,
  onSaved,
  onCancel,
}: {
  episodeId: string;
  months: number;
  onSaved: (message: string) => void;
  onCancel?: () => void;
}) {
  const [outcome, setOutcome] = useState<FollowUpOutcome>("no_answer");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const reached = outcome.startsWith("reached_");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/api/follow-ups", {
        method: "POST",
        body: JSON.stringify({
          episodeId,
          milestoneMonths: months,
          outcome,
          note: note.trim() || undefined,
          servicesFeedback: reached ? feedback.trim() || undefined : undefined,
        }),
      });
      onSaved(
        outcome === "no_answer"
          ? `${months}-month call: no answer recorded. It stays in the queue.`
          : outcome === "reached_wants_services"
            ? `${months}-month call recorded. They've been added to the list for intake to readmit.`
            : `${months}-month call recorded.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the call");
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded border border-nmbm-ink/20 bg-nmbm-paper px-3 py-1.5 text-sm";

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded border border-nmbm-ink/10 bg-nmbm-ink/[0.02] p-3">
      {error && <p className="text-sm text-state-alert">{error}</p>}
      <label className="flex flex-col gap-1 text-xs text-nmbm-ink/60">
        How did the call go?
        <select value={outcome} onChange={(e) => setOutcome(e.target.value as FollowUpOutcome)} className={field}>
          {FOLLOW_UP_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {FOLLOW_UP_OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-nmbm-ink/60">
        {reached ? "How are they doing?" : "Note (optional)"}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required={reached}
          rows={2}
          className={field}
        />
      </label>
      {reached && (
        <label className="flex flex-col gap-1 text-xs text-nmbm-ink/60">
          How were NMBM's services received? (optional)
          <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} className={field} />
        </label>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save call"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm text-nmbm-ink/60 hover:underline">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
