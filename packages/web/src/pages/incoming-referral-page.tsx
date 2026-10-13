import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { INCOMING_REFERRAL_CLOSE_REASONS, type IncomingReferralCloseReason } from "@nmbm/shared";
import { api, ApiError } from "../lib/api.js";
import { PAYER_OPTIONS, REFERRAL_CLOSE_LABELS, REFERRAL_SOURCE_LABELS } from "../lib/labels.js";
import type { IncomingReferralDetail } from "../lib/types.js";
import { Pill } from "../components/flags.js";
import { useParticipantSearch } from "../components/participant-search.js";

const inputClass = "rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm";

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
  if (!r) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  const payer = PAYER_OPTIONS.find((p) => p.value === r.payer)?.label;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/referrals-in" className="text-sm text-nmbm-ink/60 underline-offset-2 hover:underline">
        ← Referrals in
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-nmbm-ink">
            {r.firstName} {r.lastName}
          </h1>
          <p className="mt-1 text-sm text-nmbm-ink/60">
            Referred by {r.sourceName || REFERRAL_SOURCE_LABELS[r.sourceType]}
            {r.sourceName && ` (${REFERRAL_SOURCE_LABELS[r.sourceType].toLowerCase()})`} · received{" "}
            {r.receivedDate} · recorded by {r.recordedByName}
          </p>
        </div>
        {r.status === "admitted" && <Pill tone="ok">admitted</Pill>}
        {r.status === "closed" && <Pill tone="muted">closed</Pill>}
        {open && <Pill tone="warn">{r.status === "new" ? "new" : "in hand"}</Pill>}
      </div>

      {notice && (
        <p className="mt-4 rounded border border-state-ok/20 bg-state-ok-bg px-3 py-2 text-sm text-state-ok">{notice}</p>
      )}
      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      <section className="mt-6 rounded border border-nmbm-ink/10 p-4 text-sm">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-nmbm-ink/50">Date of birth</dt>
            <dd>{r.dateOfBirth ?? "Not given"}</dd>
          </div>
          <div>
            <dt className="text-xs text-nmbm-ink/50">Phone</dt>
            <dd>{r.phone ?? "Not given"}</dd>
          </div>
          <div>
            <dt className="text-xs text-nmbm-ink/50">Payer</dt>
            <dd>{payer ?? "Not known"}</dd>
          </div>
          <div>
            <dt className="text-xs text-nmbm-ink/50">Referrer's contact</dt>
            <dd>{r.sourceContact ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-nmbm-ink/50">Why they were referred</dt>
            <dd className="whitespace-pre-wrap">{r.reason}</dd>
          </div>
        </dl>
      </section>

      {r.status === "admitted" && r.participantId && (
        <p className="mt-4 text-sm text-nmbm-ink/70">
          Admitted {r.admittedAt?.slice(0, 10)} by {r.admittedByName}.{" "}
          <Link to={`/participants/${r.participantId}`} className="font-medium text-nmbm-ink underline underline-offset-2">
            Open the record
          </Link>{" "}
          (if they're on a caseload you can see).
        </p>
      )}
      {r.status === "closed" && r.closeReason && (
        <p className="mt-4 text-sm text-nmbm-ink/70">
          Closed {r.closedAt?.slice(0, 10)} by {r.closedByName}: {REFERRAL_CLOSE_LABELS[r.closeReason]}
          {r.closeNote && ` — ${r.closeNote}`}
        </p>
      )}

      {(r.outcomeOwed || r.outcomeReportedAt) && (
        <section className="mt-4 rounded border border-nmbm-ink/10 px-4 py-3 text-sm">
          {r.outcomeReportedAt ? (
            <p className="text-nmbm-ink/70">
              {r.sourceName || "The referrer"} was told the outcome on {r.outcomeReportedAt.slice(0, 10)} by{" "}
              {r.outcomeReportedByName}.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-nmbm-ink/80">
                Let {r.sourceName || "the referrer"} know what happened
                {r.sourceContact ? ` (${r.sourceContact})` : ""}, then mark it done.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  run(() => api(`/api/incoming-referrals/${r.id}/outcome-reported`, { method: "POST" }), "Recorded that the referrer was told.")
                }
                className="rounded border border-nmbm-ink/30 px-3 py-1 text-sm"
              >
                Referrer told
              </button>
            </div>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">Contact attempts and notes</h2>
        {r.notes.length === 0 && <p className="mt-2 text-sm text-nmbm-ink/60">None yet.</p>}
        <ul className="mt-2 flex flex-col gap-2">
          {r.notes.map((n) => (
            <li key={n.id} className="rounded border border-nmbm-ink/10 px-3 py-2 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-0.5 text-xs text-nmbm-ink/50">
                {n.createdByName} · {new Date(n.createdAt).toLocaleString()}
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
            <button disabled={busy || !note.trim()} className="rounded border border-nmbm-ink/30 px-3 text-sm disabled:opacity-40">
              Add
            </button>
          </form>
        )}
      </section>

      {open && (
        <section className="mt-8 rounded border border-nmbm-ink/15 p-4">
          <h2 className="text-sm font-semibold text-nmbm-ink">What happens next</h2>

          {matches && matches.length > 0 && (
            <div className="mt-3">
              <p className="text-sm text-nmbm-ink/70">Already known to NMBM? Records that match:</p>
              <ul className="mt-2 divide-y divide-nmbm-ink/5 rounded border border-nmbm-ink/10">
                {matches.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">
                        {m.firstName} {m.lastName}
                      </span>
                      <span className="ml-2 text-xs text-nmbm-ink/50">born {m.dateOfBirth}</span>
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
                        className="rounded border border-nmbm-ink/30 px-3 py-1 text-xs"
                      >
                        Add to their current stay
                      </button>
                    ) : (
                      <button
                        onClick={() => navigate(`/participants/${m.id}?referral=${r.id}`)}
                        className="rounded border border-nmbm-ink/30 px-3 py-1 text-xs"
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
              className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper"
            >
              Admit as a new client
            </button>
            {!closing && (
              <button onClick={() => setClosing(true)} className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm">
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
              <button disabled={busy} className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper">
                Close
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
