import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ATTENDANCE_STATUSES, RECORD_EXPORT_PURPOSES, type RecordExportPurpose } from "@nmbm/shared";
import { api, ApiError } from "../lib/api.js";
import {
  ASSESSMENT_MODE_LABELS,
  CLOSURE_REASON_LABELS,
  EXPORT_PURPOSE_LABELS,
  PAYER_OPTIONS,
  REFERRAL_SOURCE_LABELS,
} from "../lib/labels.js";
import type { RecordExport } from "../lib/types.js";

const words = (code: string) => code.replace(/_/g, " ");
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className="mt-8 break-inside-avoid-page">
      <h2 className="border-b border-nmbm-ink/20 pb-1 text-base font-semibold text-nmbm-ink">{title}</h2>
      {empty ? <p className="mt-2 text-sm text-nmbm-ink/50">None on record.</p> : <div className="mt-2">{children}</div>}
    </section>
  );
}

// A participant's whole record as one document. Nothing is fetched until
// the person exporting says why — the purpose goes in the audit log with
// the export, as a disclosure — and nothing is kept: the export exists
// in this page and whatever they print or save from it.
export default function RecordExportPage() {
  const { id } = useParams();
  const [purpose, setPurpose] = useState<RecordExportPurpose>("participant_request");
  const [note, setNote] = useState("");
  const [doc, setDoc] = useState<RecordExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDoc(
        await api<RecordExport>(`/api/participants/${id}/record-export`, {
          method: "POST",
          body: JSON.stringify({ purpose, note: note.trim() || null }),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the export");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `record-${doc.participant.lastName}-${doc.generatedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!doc) {
    return (
      <div className="mx-auto max-w-xl">
        <Link to={`/participants/${id}`} className="text-sm text-nmbm-ink/60 underline-offset-2 hover:underline">
          ← Back to the record
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-nmbm-ink">Export the full record</h1>
        <p className="mt-1 text-sm text-nmbm-ink/60">
          Everything on this person's record, as one document to print, save as a PDF or send on.
          Sending a whole record outside NMBM is a disclosure: the export is logged with your name
          and the reason below.
        </p>
        {error && (
          <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
            {error}
          </p>
        )}
        <form onSubmit={create} className="mt-6 flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-nmbm-ink">What is it for?</legend>
            {RECORD_EXPORT_PURPOSES.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input type="radio" name="purpose" checked={purpose === p} onChange={() => setPurpose(p)} />
                {EXPORT_PURPOSE_LABELS[p]}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm">
            {purpose === "other" ? "Say what it's for" : "Reference or note (optional)"}
            <input
              value={note}
              required={purpose === "other"}
              onChange={(e) => setNote(e.target.value)}
              placeholder={purpose === "legal_request" ? "e.g. case or subpoena number" : ""}
              className="rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            disabled={busy}
            className="self-start rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-50"
          >
            {busy ? "Preparing…" : "Create the export"}
          </button>
        </form>
      </div>
    );
  }

  const p = doc.participant;
  const payer = PAYER_OPTIONS.find((o) => o.value === p.payer)?.label ?? "Not recorded";

  return (
    <div className="mx-auto max-w-3xl text-nmbm-ink">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={`/participants/${id}`} className="text-sm text-nmbm-ink/60 underline-offset-2 hover:underline">
          ← Back to the record
        </Link>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper">
            Print or save as PDF
          </button>
          <button onClick={download} className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm">
            Download as data
          </button>
        </div>
      </div>

      <header className="mt-4 border-b-2 border-nmbm-ink pb-3">
        <p className="text-xs uppercase tracking-wide text-nmbm-ink/60">NMBM · participant record · confidential</p>
        <h1 className="mt-1 text-2xl font-semibold">
          {p.firstName} {p.lastName}
        </h1>
        <p className="text-sm">
          Born {p.dateOfBirth} · payer {payer} · on file since {day(p.recordCreatedAt)}
        </p>
        <p className="mt-2 text-xs text-nmbm-ink/60">
          Exported {new Date(doc.generatedAt).toLocaleString()} by {doc.generatedByName} for:{" "}
          {EXPORT_PURPOSE_LABELS[doc.purpose]}
          {doc.purposeNote && ` (${doc.purposeNote})`}
        </p>
      </header>

      <Section title="Enrolments" empty={doc.episodes.length === 0}>
        <ul className="text-sm">
          {doc.episodes.map((e) => (
            <li key={e.id}>
              {e.startDate} to {e.endDate ?? "now"}
              {e.closureReason && ` — ${CLOSURE_REASON_LABELS[e.closureReason]}`}
              {e.closureNote && `: ${e.closureNote}`}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Case managers" empty={doc.caseManagers.length === 0}>
        <ul className="text-sm">
          {doc.caseManagers.map((c, i) => (
            <li key={i}>
              {c.name}, {day(c.startedAt)} to {c.endedAt ? day(c.endedAt) : "now"}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Referred to NMBM by" empty={doc.referralsIn.length === 0}>
        <ul className="flex flex-col gap-1 text-sm">
          {doc.referralsIn.map((r) => (
            <li key={r.id}>
              {r.sourceName || REFERRAL_SOURCE_LABELS[r.sourceType]}, {r.receivedDate}: {r.reason}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Contact notes" empty={doc.notes.length === 0}>
        <ul className="flex flex-col gap-3 text-sm">
          {[...doc.notes].reverse().map((n) => (
            <li key={n.id} className="break-inside-avoid">
              <p className="text-xs text-nmbm-ink/60">
                {new Date(n.createdAt).toLocaleString()} · {n.authorName} ·{" "}
                {n.contactResult === "contacted" ? "reached" : "no contact"} · {words(n.status)}
              </p>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Care plans" empty={doc.carePlans.length === 0}>
        <ul className="flex flex-col gap-3 text-sm">
          {doc.carePlans.map((c, i) => (
            <li key={i} className="break-inside-avoid">
              <p className="text-xs text-nmbm-ink/60">
                Written {day(c.createdAt)} · {words(c.status)}
                {c.approvedAt && ` · approved ${day(c.approvedAt)} by ${c.approvedByName}`}
              </p>
              <p className="whitespace-pre-wrap">{c.goals}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Forms and assessments" empty={doc.assessments.length === 0}>
        {doc.assessments.map((a) => (
          <div key={a.id} className="mb-4 break-inside-avoid">
            <p className="text-sm font-medium">
              {a.formName} (version {a.versionNumber})
            </p>
            <p className="text-xs text-nmbm-ink/60">
              {ASSESSMENT_MODE_LABELS[a.mode]} · started {day(a.startedAt)} · {words(a.status)}
              {a.completedAt && ` ${day(a.completedAt)}`}
              {a.voidReason && ` — voided: ${a.voidReason}`}
            </p>
            {a.answers.length === 0 ? (
              <p className="text-sm text-nmbm-ink/50">No answers.</p>
            ) : (
              <dl className="mt-1 text-sm">
                {a.answers.map((x, i) => (
                  <div key={i} className="mt-1">
                    <dt className="text-nmbm-ink/70">{x.question}</dt>
                    <dd className="whitespace-pre-wrap pl-3">{x.answer}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </Section>

      <Section title="Consent forms" empty={doc.consents.length === 0}>
        <ul className="text-sm">
          {doc.consents.map((c) => (
            <li key={c.id}>
              {c.formName}: signed {c.signedDate}, expires {c.expiresDate} · {c.status}
              {c.revokedReason && ` (revoked: ${c.revokedReason})`}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Referrals made by NMBM" empty={doc.referralsOut.length === 0}>
        <ul className="text-sm">
          {doc.referralsOut.map((r) => (
            <li key={r.id}>
              {day(r.referredAt)}: {r.partnerName} for {r.serviceType} · {words(r.status)}
              {r.outcomeNote && ` — ${r.outcomeNote}`}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Programmes and attendance" empty={doc.programmes.length === 0}>
        {doc.programmes.map((g, i) => (
          <div key={i} className="mb-3 break-inside-avoid text-sm">
            <p className="font-medium">
              {g.programName} — {g.cohortName} (from {g.startDate}) · {words(g.status)}
            </p>
            <p className="text-xs text-nmbm-ink/60">
              {ATTENDANCE_STATUSES.map((s) => `${g.attendance.filter((x) => x.status === s).length} ${s}`).join(" · ")}
            </p>
            <p className="text-xs">
              {g.attendance.map((x) => `${x.date} ${x.status}`).join("; ") || "No classes recorded."}
            </p>
          </div>
        ))}
      </Section>

      <Section title="Follow-up calls" empty={doc.followUpCalls.length === 0}>
        <ul className="text-sm">
          {doc.followUpCalls.map((c, i) => (
            <li key={i}>
              {c.milestoneMonths}-month call, {day(c.calledAt)} by {c.calledByName}: {words(c.outcome)}
              {c.note && ` — ${c.note}`}
              {c.servicesFeedback && ` · on services: ${c.servicesFeedback}`}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Documents on file" empty={doc.documents.length === 0}>
        <ul className="text-sm">
          {doc.documents.map((d, i) => (
            <li key={i}>
              {d.description} ({d.originalFilename}) · uploaded {day(d.uploadedAt)} by {d.uploadedByName}
              {d.status === "voided" && ` · voided${d.voidReason ? `: ${d.voidReason}` : ""}`}
            </li>
          ))}
        </ul>
      </Section>

      <section className="mt-8 border-t border-nmbm-ink/20 pt-3 text-xs text-nmbm-ink/60">
        <p className="font-medium">Not included in this export</p>
        <ul className="list-disc pl-5">
          {doc.omitted.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
