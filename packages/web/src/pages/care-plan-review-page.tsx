import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api.js";
import type { CarePlanStatus } from "@nmbm/shared";

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

  if (!plans) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-nmbm-ink">Care plans awaiting review</h1>
      <p className="mt-1 text-sm text-nmbm-ink/60">
        {plans.length === 0 ? "Nothing waiting." : `${plans.length} waiting for a decision.`}
      </p>

      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-4">
        {plans.map((plan) => (
          <li key={plan.id} className="rounded border border-nmbm-ink/10 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-nmbm-ink">
                {plan.firstName} {plan.lastName}
              </span>
              <span className="text-xs text-nmbm-ink/50">
                submitted {new Date(plan.updatedAt).toLocaleDateString()}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-nmbm-ink/80">{plan.goals}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => act(plan.id, "approve")}
                className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper hover:bg-nmbm-ink/85"
              >
                Approve
              </button>
              <input
                value={notes[plan.id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [plan.id]: e.target.value })}
                placeholder="Reason for returning"
                className="min-w-[16rem] flex-1 rounded border border-nmbm-ink/20 px-3 py-1.5 text-sm"
              />
              <button
                onClick={() => act(plan.id, "return")}
                className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm font-medium text-nmbm-ink hover:bg-nmbm-ink/5"
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
