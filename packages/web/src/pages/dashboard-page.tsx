import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { Dashboard, Me, ParticipantRow } from "../lib/types.js";
import { CarePlanPills, MolinaLetterPill, NoContactPill, ParticipantLink } from "../components/flags.js";

// M9's framing, literally: an overdue plan turns up here rather than in
// a report nobody opens. Everything on this screen is something someone
// has to do today.
export default function DashboardPage({ me }: { me: Me }) {
  const [data, setData] = useState<Dashboard | null>(null);

  useEffect(() => {
    api<Dashboard>("/api/dashboard").then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  const firstName = me.displayName.split(" ")[0];
  const nothingDue =
    data.noContactWarnings.length === 0 &&
    data.carePlansMissing.length === 0 &&
    data.carePlanReviewsDue.length === 0 &&
    data.carePlansReturned.length === 0 &&
    data.awaitingReview.length === 0;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-nmbm-ink">Good morning, {firstName}</h1>
      <p className="mt-1 text-sm text-nmbm-ink/60">
        {data.caseloadSize} on your caseload · {data.needsAttention} need attention
      </p>

      {nothingDue && (
        <p className="mt-8 rounded border border-state-ok/20 bg-state-ok-bg px-4 py-3 text-sm text-state-ok">
          Nothing needs attention today.
        </p>
      )}

      <Section title="Missed contact" rows={data.noContactWarnings} kind="no-contact" />
      <Section title="Care plan not written yet" rows={data.carePlansMissing} kind="plan-missing" />
      <Section title="Care plan review due" rows={data.carePlanReviewsDue} kind="review-due" />
      <Section title="Returned for revision" rows={data.carePlansReturned} kind="returned" />

      {data.awaitingReview.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
            Waiting for your approval
          </h2>
          <ul className="mt-2 divide-y divide-nmbm-ink/5 rounded border border-nmbm-ink/10">
            {data.awaitingReview.map((plan) => (
              <li key={plan.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-medium text-nmbm-ink">
                  {plan.firstName} {plan.lastName}
                </span>
                <a href="/care-plans/review" className="text-nmbm-gold-dark hover:underline">
                  Review plan
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type SectionKind = "no-contact" | "plan-missing" | "review-due" | "returned";

// Someone with two problems legitimately appears under two headings —
// they are two pieces of work. Each row shows only the reason it is
// filed under, so the same person doesn't repeat an identical wall of
// pills twice.
function Section({
  title,
  rows,
  kind,
}: {
  title: string;
  rows: ParticipantRow[];
  kind: SectionKind;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
        {title} <span className="text-nmbm-ink/30">({rows.length})</span>
      </h2>
      <ul className="mt-2 divide-y divide-nmbm-ink/5 rounded border border-nmbm-ink/10">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
          >
            <ParticipantLink id={row.id} firstName={row.firstName} lastName={row.lastName} />
            <div className="flex flex-wrap items-center gap-1.5">
              {kind === "no-contact" && (
                <>
                  <MolinaLetterPill flags={row.flags.noContact} />
                  <NoContactPill flags={row.flags.noContact} />
                </>
              )}
              {kind !== "no-contact" && <CarePlanPills flags={row.flags.carePlan} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
