import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { INCOMING_REFERRAL_CLOSE_REASONS, type IncomingReferralCloseReason } from "@nmbm/shared";
import { api, ApiError } from "../lib/api.js";
import { PAYER_OPTIONS, REFERRAL_CLOSE_LABELS, REFERRAL_SOURCE_LABELS } from "../lib/labels.js";
import type { IncomingReferralDetail } from "../lib/types.js";
import { Pill } from "../components/flags.js";
import { useParticipantSearch } from "../components/participant-search.js";
import { DateText, Timestamp } from "../components/dates.js";

const inputClass = "nmbm-control";

export default function IncomingReferralPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [r, setR] = useState<IncomingReferralDetail | null>(null);
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState<IncomingReferralCloseReason>("declined");
  const [closeNote, setCloseNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<IncomingReferralDetail>(`/api/incoming-referrals/${id}`)
      .then(setR)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the referral"));
  }, [id]);
  useEffect(load, [load]);

  // Somebody NMBM already knows? Looked for as soon as the page opens,
  // so a returning client is readmitted rather than created twice.
  const open = r?.status === "new" || r?.status === "contacting";
  const matches = useParticipantSearch(
    open && r ? (r.dateOfBirth ? { dob: r.dateOfBirth } : { q: `${r.firstName} ${r.lastName}` }) : null,
  );

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(message);
      load();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error && !r) return <p className="text-sm text-state-alert">{error}</p>;
  if (!r) return <p className="text-sm text-ds-muted">Loading…</p>;

  const payer = PAYER_OPTIONS.find((p) => p.value === r.payer)?.label;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/referrals-in" className="text-sm text-ds-muted underline-offset-2 hover:underline">
        ← Referrals in
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="ds-display">
            {r.firstName} {r.lastName}
          </h1>
          <p className="mt-1 text-sm text-ds-muted">
            Referred by {r.sourceName || REFERRAL_SOURCE_LABELS[r.sourceType]}
            {r.sourceName && ` (${REFERRAL_SOURCE_LABELS[r.sourceType].toLowerCase()})`} · received{" "}
            <DateText value={r.receivedDate} /> · recorded by {r.recordedByName}
          </p>
        </div>
        {r.status === "admitted" && <Pill tone="ok">admitted</Pill>}
        {r.status === "closed" && <Pill tone="muted">closed</Pill>}
        {open && <Pill tone="warn">{r.status === "new" ? "new" : "in hand"}</Pill>}
      </div>

      {notice && (
        <p className="nmbm-alert nmbm-alert--ok mt-4">{notice}</p>
      )}
      {error && (
        <p className="nmbm-alert nmbm-alert--alert mt-4">
          {error}
        </p>
      )}

      <section className="nmbm-card nmbm-card--dense mt-6">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-ds-muted">Date of birth</dt>
            <dd>{r.dateOfBirth ?? "Not given"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ds-muted">Phone</dt>
            <dd>{r.phone ?? "Not given"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ds-muted">Payer</dt>
            <dd>{payer ?? "Not known"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ds-muted">Referrer's contact</dt>
            <dd>{r.sourceContact ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-ds-muted">Why they were referred</dt>
            <dd className="whitespace-pre-wrap">{r.reason}</dd>
          </div>
        </dl>
      </section>

      {r.status === "admitted" && r.participantId && (
        <p className="mt-4 text-sm text-ds-secondary">
          Admitted {r.admittedAt && <Timestamp at={r.admittedAt} />} by {r.admittedByName}.{" "}
          <Link to={`/participants/${r.participantId}`} className="font-medium text-ds-ink underline underline-offset-2">
            Open the record
          </Link>{" "}
          (if they're on a caseload you can see).
        </p>
      )}
      {r.status === "closed" && r.closeReason && (
        <p className="mt-4 text-sm text-ds-secondary">
          Closed {r.closedAt && <Timestamp at={r.closedAt} />} by {r.closedByName}: {REFERRAL_CLOSE_LABELS[r.closeReason]}
          {r.closeNote && ` — ${r.closeNote}`}
        </p>
      )}

      {(r.outcomeOwed || r.outcomeReportedAt) && (
        <section className="ds-row mt-4">
          {r.outcomeReportedAt ? (
            <p className="text-ds-secondary">
              {r.sourceName || "The referrer"} was told the outcome on <Timestamp at={r.outcomeReportedAt} /> by{" "}
              {r.outcomeReportedByName}.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ds-secondary">
                Let {r.sourceName || "the referrer"} know what happened
                {r.sourceContact ? ` (${r.sourceContact})` : ""}, then mark it done.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  run(() => api(`/api/incoming-referrals/${r.id}/outcome-reported`, { method: "POST" }), "Recorded that the referrer was told.")
                }
                className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm"
              >
                Referrer told
              </button>
            </div>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="ds-section-heading">Contact attempts and notes</h2>
        {r.notes.length === 0 && <p className="mt-2 text-sm text-ds-muted">None yet.</p>}
        <ul className="mt-2 flex flex-col gap-2">
          {r.notes.map((n) => (
            <li key={n.id} className="ds-row">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-0.5 text-xs text-ds-muted">
                {n.createdByName} · <Timestamp at={n.createdAt} withTime />
              </p>
            </li>
          ))}
        </ul>
        {open && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => api(`/api/incoming-referrals/${r.id}/notes`, { method: "POST", body: JSON.stringify({ body: note }) }),
                "Note added.",
              ).then((ok) => ok && setNote(""));
            }}
          >
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Called, left a voicemail"
              aria-label="Add a note"
              className={`${inputClass} flex-1`}
            />
            <button disabled={busy || !note.trim()} className="nmbm-btn nmbm-btn--secondary nmbm-btn--md">
              Add
            </button>
          </form>
        )}
      </section>

      {open && (
        <section className="nmbm-card nmbm-card--dense mt-8">
          <h2 className="text-sm font-semibold text-ds-ink">What happens next</h2>

          {matches && matches.length > 0 && (
            <div className="mt-3">
              <p className="text-sm text-ds-secondary">Already known to NMBM? Records that match:</p>
              <ul className="ds-list mt-2">
                {matches.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">
                        {m.firstName} {m.lastName}
                      </span>
                      <span className="ml-2 text-xs text-ds-muted">born {m.dateOfBirth}</span>
                    </span>
                    {m.active ? (
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              api(`/api/incoming-referrals/${r.id}/link`, {
                                method: "POST",
                                body: JSON.stringify({ participantId: m.id }),
                              }),
                            "Added to their current stay.",
                          )
                        }
                        className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm"
                      >
                        Add to their current stay
                      </button>
                    ) : (
                      <button
                        onClick={() => navigate(`/participants/${m.id}?referral=${r.id}`)}
                        className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm"
                      >
                        Readmit from this referral
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => navigate(`/participants/new?referral=${r.id}`)}
              className="nmbm-btn nmbm-btn--primary nmbm-btn--md"
            >
              Admit as a new client
            </button>
            {!closing && (
              <button onClick={() => setClosing(true)} className="nmbm-btn nmbm-btn--secondary nmbm-btn--md">
                Close without admitting
              </button>
            )}
          </div>

          {closing && (
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () =>
                    api(`/api/incoming-referrals/${r.id}/close`, {
                      method: "POST",
                      body: JSON.stringify({ reason: closeReason, note: closeNote.trim() || null }),
                    }),
                  "Referral closed.",
                ).then((ok) => ok && setClosing(false));
              }}
            >
              <label className="flex flex-col gap-1 text-sm">
                Reason
                <select
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value as IncomingReferralCloseReason)}
                  className={inputClass}
                >
                  {INCOMING_REFERRAL_CLOSE_REASONS.map((c) => (
                    <option key={c} value={c}>
                      {REFERRAL_CLOSE_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Note (optional)
                <input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} className={inputClass} />
              </label>
              <button disabled={busy} className="nmbm-btn nmbm-btn--dark nmbm-btn--md">
                Close
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
