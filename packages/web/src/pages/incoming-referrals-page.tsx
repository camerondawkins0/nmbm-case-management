import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { INCOMING_REFERRAL_SOURCES, type IncomingReferralSource, type Payer } from "@nmbm/shared";
import { api, ApiError } from "../lib/api.js";
import { PAYER_OPTIONS, REFERRAL_CLOSE_LABELS, REFERRAL_SOURCE_LABELS } from "../lib/labels.js";
import type { IncomingReferralRow } from "../lib/types.js";
import { Pill } from "../components/flags.js";

type View = "open" | "outcome_owed" | "all";
const VIEWS: { value: View; label: string }[] = [
  { value: "open", label: "To deal with" },
  { value: "outcome_owed", label: "Tell the referrer" },
  { value: "all", label: "All" },
];

const inputClass = "rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm";
const today = () => new Date().toISOString().slice(0, 10);

// People referred to NMBM, before they're participants: intake's queue.
export default function IncomingReferralsPage() {
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [view, setView] = useState<View>("open");
  const [rows, setRows] = useState<IncomingReferralRow[] | null>(null);
  const [counts, setCounts] = useState<{ open: number; outcomeOwed: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    receivedDate: today(),
    sourceType: "health_plan" as IncomingReferralSource,
    sourceName: "",
    sourceContact: "",
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    phone: "",
    payer: "" as Payer | "",
    reason: "",
  });

  const load = useCallback(() => {
    setRows(null);
    api<IncomingReferralRow[]>(`/api/incoming-referrals?view=${view}`)
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load referrals"));
    api<{ open: number; outcomeOwed: number }>("/api/incoming-referrals/counts")
      .then(setCounts)
      .catch(() => setCounts(null));
  }, [view]);
  useEffect(load, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const blank = (v: string) => (v.trim() === "" ? null : v);
      const created = await api<{ id: string }>("/api/incoming-referrals", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          sourceName: blank(form.sourceName),
          sourceContact: blank(form.sourceContact),
          dateOfBirth: blank(form.dateOfBirth),
          phone: blank(form.phone),
          payer: form.payer === "" ? null : form.payer,
        }),
      });
      navigate(`/referrals-in/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the referral");
    }
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-nmbm-ink">Referrals in</h1>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper"
          >
            Record a referral
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-nmbm-ink/60">
        People referred to NMBM by a plan, hospital, court or partner. Each one stays here until
        they're admitted or the referral is closed, and the referrer is owed word of what happened.
      </p>

      {notice && (
        <p className="mt-4 rounded border border-state-ok/20 bg-state-ok-bg px-3 py-2 text-sm text-state-ok">{notice}</p>
      )}
      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      {adding && (
        <form onSubmit={save} className="mt-4 rounded border border-nmbm-ink/15 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Received
              <input type="date" required value={form.receivedDate} max={today()} onChange={set("receivedDate")} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              From
              <select value={form.sourceType} onChange={set("sourceType")} className={inputClass}>
                {INCOMING_REFERRAL_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {REFERRAL_SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            {form.sourceType !== "self" && (
              <label className="flex flex-col gap-1 text-sm">
                Who exactly
                <input value={form.sourceName} onChange={set("sourceName")} placeholder="e.g. Molina care team" className={inputClass} />
              </label>
            )}
            {form.sourceType !== "self" && (
              <label className="flex flex-col gap-1 text-sm sm:col-span-3">
                Their contact (to report back)
                <input value={form.sourceContact} onChange={set("sourceContact")} placeholder="Name, phone or email" className={inputClass} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              First name
              <input required value={form.firstName} onChange={set("firstName")} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Last name
              <input required value={form.lastName} onChange={set("lastName")} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Date of birth (if given)
              <input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Phone
              <input value={form.phone} onChange={set("phone")} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Payer
              <select value={form.payer} onChange={set("payer")} className={inputClass}>
                <option value="">Not known</option>
                {PAYER_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-3">
              Why they were referred
              <textarea required rows={3} value={form.reason} onChange={set("reason")} className={inputClass} />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper">
              Save
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 flex gap-1 border-b border-nmbm-ink/10">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            onClick={() => setView(v.value)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${view === v.value ? "border-nmbm-ink font-medium text-nmbm-ink" : "border-transparent text-nmbm-ink/60"}`}
          >
            {v.label}
            {v.value === "open" && counts ? ` (${counts.open})` : ""}
            {v.value === "outcome_owed" && counts ? ` (${counts.outcomeOwed})` : ""}
          </button>
        ))}
      </div>

      {!rows ? (
        <p className="mt-4 text-sm text-nmbm-ink/50">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-nmbm-ink/60">
          {view === "open" ? "Nothing waiting." : view === "outcome_owed" ? "Every referrer has been told." : "No referrals yet."}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-nmbm-ink/5 rounded border border-nmbm-ink/10">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/referrals-in/${r.id}`} className="font-medium text-nmbm-ink hover:underline">
                  {r.firstName} {r.lastName}
                </Link>
                {r.status === "new" && <Pill tone={r.daysWaiting > 2 ? "alert" : "warn"}>new · {r.daysWaiting}d</Pill>}
                {r.status === "contacting" && <Pill tone="warn">{r.attempts} note{r.attempts === 1 ? "" : "s"}</Pill>}
                {r.status === "admitted" && <Pill tone="ok">admitted</Pill>}
                {r.status === "closed" && <Pill tone="muted">{r.closeReason ? REFERRAL_CLOSE_LABELS[r.closeReason] : "closed"}</Pill>}
              </div>
              <p className="mt-0.5 text-xs text-nmbm-ink/50">
                {r.sourceName || REFERRAL_SOURCE_LABELS[r.sourceType]} · received {r.receivedDate}
                {r.dateOfBirth && ` · born ${r.dateOfBirth}`}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-nmbm-ink/70">{r.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
