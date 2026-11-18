import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api.js";
import type { CarePlanStatus } from "@nmbm/shared";
import { Timestamp } from "../components/dates.js";

type PendingPlan = {
  id: string;
  goals: string;
  status: CarePlanStatus;
  updatedAt: string;
  participantId: string;
  firstName: string;
  lastName: string;
};

// U6: the Clinical Director's queue. Returning a plan needs a reason —
// the API rejects it without one, because a bounce with no explanation
// just costs the author another round trip.
export default function CarePlanReviewPage() {
  const [plans, setPlans] = useState<PendingPlan[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<PendingPlan[]>("/api/care-plans/awaiting-review")
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  useEffect(load, [load]);

  async function act(planId: string, action: "approve" | "return") {
    setError(null);
    try {
      await api(`/api/care-plans/${planId}/${action}`, {
        method: "POST",
        body: action === "return" ? JSON.stringify({ reviewNote: notes[planId] ?? "" }) : undefined,
      });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    }
  }

  if (!plans) return <p className="text-sm text-ds-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="ds-display">Care plans awaiting review</h1>
      <p className="mt-1 text-sm text-ds-muted">
        {plans.length === 0 ? "Nothing waiting." : `${plans.length} waiting for a decision.`}
      </p>

      {error && (
        <p className="nmbm-alert nmbm-alert--alert mt-4">
          {error}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-4">
        {plans.map((plan) => (
          <li key={plan.id} className="nmbm-card nmbm-card--dense">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-ds-ink">
                {plan.firstName} {plan.lastName}
              </span>
              <span className="text-xs text-ds-muted">
                submitted <Timestamp at={plan.updatedAt} />
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ds-secondary">{plan.goals}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => act(plan.id, "approve")}
                className="nmbm-btn nmbm-btn--dark nmbm-btn--md"
              >
                Approve
              </button>
              <input
                value={notes[plan.id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [plan.id]: e.target.value })}
                placeholder="Reason for returning"
                className="nmbm-control min-w-[16rem] flex-1"
              />
              <button
                onClick={() => act(plan.id, "return")}
                className="nmbm-btn nmbm-btn--secondary nmbm-btn--md"
              >
                Return for revision
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
