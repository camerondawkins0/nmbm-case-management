import { useState } from "react";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import type { Me, ParticipantDetail } from "../lib/types.js";
import { Pill } from "./flags.js";
import { DateText } from "./dates.js";

// The other half of M9. The home screen has been able to say "no care
// plan, 5 days left" since the dashboard existed; this is where a CHW
// can actually do something about it.
export function CarePlanSection({
  record,
  me,
  onChanged,
}: {
  record: ParticipantDetail;
  me: Me;
  onChanged: (message: string) => void;
}) {
  const { carePlan } = record.flags;
  const [goals, setGoals] = useState(record.carePlanGoals ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writable = can(me, "care_plans.write") && record.episodeStatus === "open";
  const locked = carePlan.awaitingApproval;

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged(message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="nmbm-card nmbm-card--dense mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="ds-section-heading">
          Care plan
        </h2>
        <div className="flex items-center gap-1.5">
          {carePlan.missing && carePlan.completionOverdue && (
            <Pill tone="alert">Due <DateText value={carePlan.completionDueDate} /> — overdue</Pill>
          )}
          {carePlan.missing && !carePlan.completionOverdue && (
            <Pill tone="warn">Due in {carePlan.daysUntilCompletionDue} days</Pill>
          )}
          {!carePlan.missing && carePlan.status && (
            <Pill
              tone={
                carePlan.status === "approved"
                  ? "ok"
                  : carePlan.status === "needs_revision"
                    ? "warn"
                    : "muted"
              }
            >
              {carePlan.status.replace("_", " ")}
            </Pill>
          )}
          {carePlan.reviewOverdue && <Pill tone="warn">Review due</Pill>}
        </div>
      </div>

      {/* U6: the reason it bounced belongs where the author is fixing
          it, not in a notification they've already dismissed. */}
      {carePlan.needsRevision && record.carePlanReviewNote && (
        <p className="nmbm-alert nmbm-alert--warn mt-3">
          <span className="font-medium">Returned:</span> {record.carePlanReviewNote}
        </p>
      )}

      {error && <p className="mt-3 text-sm text-state-alert">{error}</p>}

      {locked && (
        <p className="mt-3 text-sm text-ds-muted">
          With the Clinical Director for review — it can't be edited until they respond.
        </p>
      )}

      {!writable && !locked && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-ds-secondary">
          {record.carePlanGoals ??
            (record.episodeStatus === "open"
              ? "No care plan written yet."
              : "No open episode — a care plan belongs to an enrollment.")}
        </p>
      )}

      {writable && !locked && (
        <>
          <textarea
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            rows={5}
            placeholder="Goals for this participant — what you're working on, and how you'll know it worked."
            className="nmbm-control nmbm-textarea mt-3 w-full"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {carePlan.missing ? (
              <button
                disabled={busy || goals.trim() === ""}
                onClick={() =>
                  run(
                    () =>
                      api("/api/care-plans", {
                        method: "POST",
                        body: JSON.stringify({
                          participantId: record.id,
                          episodeId: record.episodeId,
                          goals,
                        }),
                      }),
                    "Care plan created.",
                  )
                }
                className="nmbm-btn nmbm-btn--dark nmbm-btn--md"
              >
                Create plan
              </button>
            ) : (
              <>
                <button
                  disabled={busy || goals.trim() === ""}
                  onClick={() =>
                    run(
                      () =>
                        api(`/api/care-plans/${record.carePlanId}`, {
                          method: "PATCH",
                          body: JSON.stringify({ goals }),
                        }),
                      "Saved.",
                    )
                  }
                  className="nmbm-btn nmbm-btn--secondary nmbm-btn--md"
                >
                  Save
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        api(`/api/care-plans/${record.carePlanId}/submit`, { method: "POST" }),
                      "Sent for review.",
                    )
                  }
                  className="nmbm-btn nmbm-btn--dark nmbm-btn--md"
                >
                  Submit for review
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
