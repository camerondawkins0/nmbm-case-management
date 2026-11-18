import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import type { FollowUpQueue, FollowUpQueueItem, Me, ReEnrollmentRequest } from "../lib/types.js";
import { CLOSURE_REASON_LABELS } from "../lib/labels.js";
import { Pill } from "../components/flags.js";
import { FollowUpCallForm } from "../components/follow-up-call-form.js";

// M12: "someone do follow up calls to reach out to participants to see
// how they are doing ... This may lead to re-enrollment or the client is
// successful." QA works the calls; intake sees who asked to come back.
export default function FollowUpsPage({ me }: { me: Me }) {
  const makesCalls = can(me, "follow_ups.record");
  const [queue, setQueue] = useState<FollowUpQueue | null>(null);
  const [requests, setRequests] = useState<ReEnrollmentRequest[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    if (makesCalls) api<FollowUpQueue>("/api/follow-ups").then(setQueue).catch(() => setQueue(null));
    api<ReEnrollmentRequest[]>("/api/follow-ups/re-enrollment-requests")
      .then(setRequests)
      .catch(() => setRequests([]));
  }, [makesCalls]);

  useEffect(load, [load]);

  const saved = (message: string) => {
    setOpen(null);
    setNotice(message);
    load();
  };

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="ds-display">Follow-up calls</h1>
      <p className="mt-1 text-sm text-ds-muted">
        Calls to former clients at 3, 5, 9 and 12 months after their case closed — to see how
        they're doing and how NMBM's services were received.
      </p>

      {notice && (
        <p className="nmbm-alert nmbm-alert--ok mt-4">
          {notice}
        </p>
      )}

      <section className="mt-8">
        <h2 className="ds-section-heading">
          Asked to come back {requests && <span className="text-ds-muted">({requests.length})</span>}
        </h2>
        <p className="mt-1 text-xs text-ds-muted">
          Each leaves this list on its own once the person is readmitted.
        </p>
        <ul className="ds-list mt-2">
          {requests?.map((r) => (
            <li key={r.callId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <Link to={`/participants/${r.participantId}`} className="ds-person hover:underline">
                  {r.firstName} {r.lastName}
                </Link>
                <span className="ml-2 text-xs text-ds-muted">born {r.dateOfBirth}</span>
                {r.note && <p className="mt-1 text-ds-secondary">{r.note}</p>}
                <p className="mt-1 text-xs text-ds-muted">
                  {r.milestoneMonths}-month call by {r.calledByName} on{" "}
                  {new Date(r.calledAt).toLocaleDateString()}
                </p>
              </div>
              <Link
                to={`/participants/${r.participantId}`}
                className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm"
              >
                Open record to readmit
              </Link>
            </li>
          ))}
          {requests?.length === 0 && <li className="px-4 py-3 text-sm text-ds-muted">Nobody waiting.</li>}
        </ul>
      </section>

      {makesCalls && queue && (
        <>
          <QueueSection title="Overdue" tone="alert" items={queue.overdue} open={open} setOpen={setOpen} onSaved={saved} />
          <QueueSection title="Due now" tone="warn" items={queue.due} open={open} setOpen={setOpen} onSaved={saved} />
          <QueueSection title="Coming up in the next month" tone="muted" items={queue.upcoming} open={open} setOpen={setOpen} onSaved={saved} />
        </>
      )}
    </div>
  );
}

function QueueSection({
  title,
  tone,
  items,
  open,
  setOpen,
  onSaved,
}: {
  title: string;
  tone: "alert" | "warn" | "muted";
  items: FollowUpQueueItem[];
  open: string | null;
  setOpen: (key: string | null) => void;
  onSaved: (message: string) => void;
}) {
  return (
    <section className="mt-8">
      <h2 className="ds-section-heading">
        {title} <span className="text-ds-muted">({items.length})</span>
      </h2>
      <ul className="ds-list mt-2">
        {items.map((item) => {
          const key = `${item.episodeId}:${item.months}`;
          const callable = item.state !== "upcoming";
          return (
            <li key={key} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link to={`/participants/${item.participantId}`} className="ds-person hover:underline">
                    {item.firstName} {item.lastName}
                  </Link>
                  <span className="ml-2">
                    <Pill tone={tone}>{item.months}-month call · due {item.dueDate}</Pill>
                  </span>
                  <p className="mt-1 text-xs text-ds-muted">
                    Closed {item.endDate}
                    {item.closureReason && ` — ${CLOSURE_REASON_LABELS[item.closureReason]}`}
                    {item.attempts > 0 && ` · ${item.attempts} unanswered attempt${item.attempts > 1 ? "s" : ""}`}
                    {item.state === "overdue" && ` · drops off on ${item.lapsesOn}`}
                  </p>
                </div>
                {callable && open !== key && (
                  <button
                    onClick={() => setOpen(key)}
                    className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm"
                  >
                    Record call
                  </button>
                )}
              </div>
              {open === key && (
                <FollowUpCallForm
                  episodeId={item.episodeId}
                  months={item.months}
                  onSaved={(m) => onSaved(`${item.firstName} ${item.lastName}: ${m}`)}
                  onCancel={() => setOpen(null)}
                />
              )}
            </li>
          );
        })}
        {items.length === 0 && <li className="px-4 py-3 text-sm text-ds-muted">None.</li>}
      </ul>
    </section>
  );
}
