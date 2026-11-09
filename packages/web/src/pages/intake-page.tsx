import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import type { AssignableWorker, IncomingReferralDetail } from "../lib/types.js";
import { PARTICIPANT_LABEL } from "@nmbm/shared";
import type { Payer } from "@nmbm/shared";
import { SearchResults, useParticipantSearch } from "../components/participant-search.js";
import { PAYER_OPTIONS } from "../lib/labels.js";

const PAYERS = PAYER_OPTIONS;

// Intake in one screen: the record, the episode that starts the 30-day
// care plan clock, and the named worker. M3 — what a funder
// additionally requires at intake — is still unanswered, so this asks
// only for what the discovery answers already justify.
export default function IntakePage() {
  const navigate = useNavigate();
  // Admitting somebody from the referrals queue. The id travels in the
  // URL, never their name or birthday — those are fetched, so they don't
  // end up in browser history or request logs.
  const [params] = useSearchParams();
  const referralId = params.get("referral");
  const [referral, setReferral] = useState<IncomingReferralDetail | null>(null);
  const [workers, setWorkers] = useState<AssignableWorker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set when the server says a record with this name and birthday already
  // exists. The only way past it is saying, deliberately, that this is
  // someone else — and that's written to the audit log.
  const [possibleDuplicate, setPossibleDuplicate] = useState<string | null>(null);
  const [confirmedDifferent, setConfirmedDifferent] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    payer: "" as Payer | "",
    assignedWorkerId: "",
    startDate: new Date().toISOString().slice(0, 10),
  });

  // R10: a returning client belongs on their existing record. Look as
  // soon as there's a birthday or a last name to go on, before anyone has
  // typed out the rest of the form.
  const returningQuery = form.dateOfBirth
    ? { dob: form.dateOfBirth }
    : form.lastName.trim().length >= 2
      ? { q: `${form.firstName} ${form.lastName}`.trim() }
      : null;
  const returning = useParticipantSearch(returningQuery);

  useEffect(() => {
    setPossibleDuplicate(null);
    setConfirmedDifferent(false);
  }, [form.firstName, form.lastName, form.dateOfBirth]);

  useEffect(() => {
    if (!referralId) return;
    api<IncomingReferralDetail>(`/api/incoming-referrals/${referralId}`)
      .then((r) => {
        setReferral(r);
        setForm((f) => ({
          ...f,
          firstName: r.firstName,
          lastName: r.lastName,
          dateOfBirth: r.dateOfBirth ?? "",
          payer: r.payer ?? "",
        }));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the referral"));
  }, [referralId]);

  useEffect(() => {
    api<AssignableWorker[]>("/api/participants/assignable-workers")
      .then(setWorkers)
      .catch(() => setWorkers([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ participant: { id: string } }>("/api/participants/intake", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          payer: form.payer === "" ? undefined : form.payer,
          confirmNotDuplicate: confirmedDifferent || undefined,
          incomingReferralId: referral?.id,
        }),
      });
      // Admitted onto somebody else's caseload, the record is one intake
      // can't open — say it worked rather than landing on "not found".
      const id = result.participant.id;
      const worker = workers.find((w) => w.id === form.assignedWorkerId)?.displayName ?? "their case manager";
      const notice = `${form.firstName} ${form.lastName} admitted and assigned to ${worker}.`;
      try {
        await api(`/api/participants/${id}`);
        navigate(`/participants/${id}`);
      } catch {
        navigate(referral ? "/referrals-in" : "/participants", { state: { notice } });
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "possible_duplicate") {
        setPossibleDuplicate(e.message);
      } else {
        setError(e instanceof ApiError ? e.message : "Could not complete intake");
      }
      setSaving(false);
    }
  }

  const field = "w-full rounded border border-nmbm-ink/20 px-3 py-2 text-sm";
  const label = "flex flex-col gap-1 text-sm text-nmbm-ink";

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-nmbm-ink">New {PARTICIPANT_LABEL.toLowerCase()}</h1>
      <p className="mt-1 text-sm text-nmbm-ink/60">
        Opens an episode and starts the 30-day care plan countdown.
      </p>

      {referral && (
        <p className="mt-4 rounded border border-nmbm-ink/10 bg-nmbm-ink/[0.03] px-3 py-2 text-sm text-nmbm-ink/80">
          Admitting from the referral by {referral.sourceName || "a referrer"} received {referral.receivedDate}.
          Admitting closes the referral.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            First name
            <input
              required
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className={field}
            />
          </label>
          <label className={label}>
            Last name
            <input
              required
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className={field}
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Date of birth
            <input
              required
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
              className={field}
            />
          </label>
          <label className={label}>
            Enrollment date
            <input
              required
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className={field}
            />
          </label>
        </div>

        <label className={label}>
          Health plan
          <select
            value={form.payer}
            onChange={(e) => setForm({ ...form, payer: e.target.value as Payer | "" })}
            className={field}
          >
            <option value="">Not recorded</option>
            {PAYERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {form.payer === "molina" && (
            <span className="text-xs text-nmbm-ink/50">
              Molina cases require a warning letter before a no-contact disenrollment.
            </span>
          )}
        </label>

        <label className={label}>
          Assigned worker
          <select
            required
            value={form.assignedWorkerId}
            onChange={(e) => setForm({ ...form, assignedWorkerId: e.target.value })}
            className={field}
          >
            <option value="">Choose a worker…</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.displayName}
              </option>
            ))}
          </select>
        </label>

        {returning && returning.length > 0 && (
          <div className="rounded border border-state-warn/30 bg-state-warn-bg p-4">
            <p className="text-sm font-medium text-state-warn">Has this person been with NMBM before?</p>
            <p className="mt-1 text-sm text-nmbm-ink/70">
              These records match. If one is them, open it and readmit rather than starting a new
              record — their history stays together that way.
            </p>
            <div className="mt-3 bg-nmbm-paper">
              <SearchResults results={returning} compact />
            </div>
          </div>
        )}

        {possibleDuplicate && (
          <div className="rounded border border-state-alert/25 bg-state-alert-bg p-4 text-sm text-state-alert">
            <p>{possibleDuplicate}</p>
            <label className="mt-3 flex items-center gap-2 text-nmbm-ink">
              <input
                type="checkbox"
                checked={confirmedDifferent}
                onChange={(e) => setConfirmedDifferent(e.target.checked)}
              />
              I've checked — this is a different person
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={saving || (possibleDuplicate !== null && !confirmedDifferent)}
          className="self-start rounded bg-nmbm-ink px-6 py-2 text-sm font-medium text-nmbm-paper disabled:opacity-50"
        >
          {saving ? "Saving…" : "Complete intake"}
        </button>
      </form>
    </div>
  );
}
