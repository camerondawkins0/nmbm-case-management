import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ATTENDANCE_STATUSES,
  formatPhone,
  PARTICIPANT_DETAIL_FIELDS,
  PARTICIPANT_DETAIL_LABELS,
  CS_SERVICE_LABELS,
  CS_UNIT_LABELS,
  DEPOSIT_PURPOSE_LABELS,
  HOUSING_ACTIVITY_LABELS,
  HOUSING_SITUATION_LABELS,
  RECORD_EXPORT_PURPOSES,
  type RecordExportPurpose,
} from "@nmbm/shared";
import { api, ApiError } from "../lib/api.js";
import {
  ASSESSMENT_MODE_LABELS,
  CLOSURE_REASON_LABELS,
  EXPORT_PURPOSE_LABELS,
  PAYER_OPTIONS,
  REFERRAL_SOURCE_LABELS,
} from "../lib/labels.js";
import type { RecordExport } from "../lib/types.js";
import { money } from "../components/housing-section.js";
import { DateText, Timestamp, formatDay } from "../components/dates.js";

const words = (code: string) => code.replace(/_/g, " ");
// The Long Beach day, not the UTC one slicing the timestamp gave: an evening
// note was printed as the next day.
const day = (iso: string | null) => (iso ? <Timestamp at={iso} /> : "—");

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className="mt-8 break-inside-avoid-page">
      <h2 className="border-b border-ds-control pb-1 text-base font-semibold text-ds-ink">{title}</h2>
      {empty ? <p className="mt-2 text-sm text-ds-muted">None on record.</p> : <div className="mt-2">{children}</div>}
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
    a.download = `record-${doc.participant.lastName}-${formatDay(doc.generatedAt)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!doc) {
    return (
      <div className="mx-auto max-w-xl">
        <Link to={`/participants/${id}`} className="text-sm text-ds-muted underline-offset-2 hover:underline">
          ← Back to the record
        </Link>
        <h1 className="ds-display mt-2">Export the full record</h1>
        <p className="mt-1 text-sm text-ds-muted">
          Everything on this person's record, as one document to print, save as a PDF or send on.
          Sending a whole record outside NMBM is a disclosure: the export is logged with your name
          and the reason below.
        </p>
        {error && (
          <p className="nmbm-alert nmbm-alert--alert mt-4">
            {error}
          </p>
        )}
        <form onSubmit={create} className="mt-6 flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-ds-ink">What is it for?</legend>
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
              className="nmbm-control"
            />
          </label>
          <button
            disabled={busy}
            className="nmbm-btn nmbm-btn--dark nmbm-btn--md self-start"
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
    <div className="mx-auto max-w-3xl text-ds-ink">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={`/participants/${id}`} className="text-sm text-ds-muted underline-offset-2 hover:underline">
          ← Back to the record
        </Link>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="nmbm-btn nmbm-btn--dark nmbm-btn--md">
            Print or save as PDF
          </button>
          <button onClick={download} className="nmbm-btn nmbm-btn--secondary nmbm-btn--md">
            Download as data
          </button>
        </div>
      </div>

      <header className="mt-4 border-b-2 border-nmbm-ink pb-3">
        <p className="nmbm-label">NMBM · participant record · confidential</p>
        <h1 className="ds-display mt-1">
          {p.firstName} {p.lastName}
        </h1>
        <p className="text-sm">
          Born <DateText value={p.dateOfBirth} /> · payer {payer} · on file since {day(p.recordCreatedAt)}
        </p>
        <ExportDetails details={p.details} />
        <p className="mt-2 text-xs text-ds-muted">
          Exported <Timestamp at={doc.generatedAt} withTime /> by {doc.generatedByName} for:{" "}
          {EXPORT_PURPOSE_LABELS[doc.purpose]}
          {doc.purposeNote && ` (${doc.purposeNote})`}
        </p>
      </header>

      <Section title="Enrollments" empty={doc.episodes.length === 0}>
        <ul className="text-sm">
          {doc.episodes.map((e) => (
            <li key={e.id}>
              <DateText value={e.startDate} /> to {e.endDate ? <DateText value={e.endDate} /> : "now"}
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
              {r.sourceName || REFERRAL_SOURCE_LABELS[r.sourceType]}, <DateText value={r.receivedDate} />: {r.reason}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Contact notes" empty={doc.notes.length === 0}>
        <ul className="flex flex-col gap-3 text-sm">
          {[...doc.notes].reverse().map((n) => (
            <li key={n.id} className="break-inside-avoid">
              <p className="text-xs text-ds-muted">
                <DateText value={n.serviceDate} /> (written <Timestamp at={n.createdAt} withTime />) · {n.authorName} ·{" "}
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
              <p className="text-xs text-ds-muted">
                Written {day(c.createdAt)} · {words(c.status)}
                {c.approvedAt && (
                  <>
                    {" "}
                    · approved {day(c.approvedAt)} by {c.approvedByName}
                  </>
                )}
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
            <p className="text-xs text-ds-muted">
              {ASSESSMENT_MODE_LABELS[a.mode]} · started {day(a.startedAt)} · {words(a.status)}
              {a.completedAt && <> {day(a.completedAt)}</>}
              {a.voidReason && ` — voided: ${a.voidReason}`}
            </p>
            {a.answers.length === 0 ? (
              <p className="text-sm text-ds-muted">No answers.</p>
            ) : (
              <dl className="mt-1 text-sm">
                {a.answers.map((x, i) => (
                  <div key={i} className="mt-1">
                    <dt className="text-ds-secondary">{x.question}</dt>
                    <dd className="whitespace-pre-wrap pl-3">{x.answer}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </Section>

      <Section
        title="Housing"
        empty={
          doc.housing.statuses.length + doc.housing.authorizations.length + doc.housing.services.length + doc.housing.tenancies.length + doc.housing.deposits.length === 0
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <h3 className="font-medium">Housing situation</h3>
            <ul>
              {doc.housing.statuses.map((s) => (
                <li key={s.id}>
                  <DateText value={s.effectiveDate} />: {HOUSING_SITUATION_LABELS[s.situation]}
                  {s.note && ` — ${s.note}`}
                  {s.voidedAt && ` [void: ${s.voidReason}]`}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium">Community Supports authorizations</h3>
            <ul>
              {doc.housing.authorizations.map((a) => (
                <li key={a.id}>
                  {CS_SERVICE_LABELS[a.service]} {a.authorizationNumber ?? ""}: requested <DateText value={a.requestedDate} />, {a.status}
                  {a.startDate && (
                    <>
                      , <DateText value={a.startDate} /> to <DateText value={a.lastCoveredDay} />
                    </>
                  )}
                  {a.unitType && `, ${a.unitsUsed} of ${a.unitsAuthorized} ${CS_UNIT_LABELS[a.unitType]}`}
                  {a.amountAuthorized && `, ${money(a.amountPaid)} paid of ${money(a.amountAuthorized)}`}
                  {a.voidedAt && ` [void: ${a.voidReason}]`}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium">Housing services</h3>
            <ul>
              {[...doc.housing.services].reverse().map((v) => (
                <li key={v.id} className="break-inside-avoid">
                  <DateText value={v.serviceDate} /> · {HOUSING_ACTIVITY_LABELS[v.activity]} · {v.minutes} min · {v.authorName}
                  {v.voidedAt && ` [void: ${v.voidReason}]`}
                  <span className="block whitespace-pre-wrap text-ds-secondary">{v.note}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium">Homes</h3>
            <ul>
              {doc.housing.tenancies.map((t) => (
                <li key={t.id}>
                  {t.addressLine1}, {t.city} {t.state} {t.postalCode}: <DateText value={t.moveInDate} /> to {t.moveOutDate ? <DateText value={t.moveOutDate} /> : "now"}
                  {t.voidedAt && ` [void: ${t.voidReason}]`}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium">Deposits</h3>
            <ul>
              {doc.housing.deposits.map((d) => (
                <li key={d.id}>
                  {money(d.amount)} to {d.payee} ({DEPOSIT_PURPOSE_LABELS[d.purpose]}): {d.status}
                  {d.paidDate && (
                    <>
                      , paid <DateText value={d.paidDate} />
                    </>
                  )}
                  {d.voidedAt && ` [void: ${d.voidReason}]`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section title="Consent forms" empty={doc.consents.length === 0}>
        <ul className="text-sm">
          {doc.consents.map((c) => (
            <li key={c.id}>
              {c.formName}: signed <DateText value={c.signedDate} />, expires <DateText value={c.expiresDate} /> · {c.status}
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

      <Section title="Programs and attendance" empty={doc.programs.length === 0}>
        {doc.programs.map((g, i) => (
          <div key={i} className="mb-3 break-inside-avoid text-sm">
            <p className="font-medium">
              {g.programName} — {g.cohortName} (from <DateText value={g.startDate} />) · {words(g.status)}
            </p>
            <p className="text-xs text-ds-muted">
              {ATTENDANCE_STATUSES.map((s) => `${g.attendance.filter((x) => x.status === s).length} ${s}`).join(" · ")}
            </p>
            <p className="text-xs">
              {g.attendance.length === 0
                ? "No classes recorded."
                : g.attendance.map((x, i) => (
                    <span key={i}>
                      {i > 0 && "; "}
                      <DateText value={x.date} /> {x.status}
                    </span>
                  ))}
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

      <section className="mt-8 border-t border-ds-control pt-3 text-xs text-ds-muted">
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

function ExportDetails({ details }: { details: RecordExport["participant"]["details"] }) {
  const rows = PARTICIPANT_DETAIL_FIELDS.filter((k) => details[k]).map((k) => [
    PARTICIPANT_DETAIL_LABELS[k],
    k.toLowerCase().includes("phone") ? formatPhone(details[k]) : details[k],
  ]);
  if (rows.length === 0) return <p className="mt-1 text-sm text-ds-muted">No contact or insurance details recorded.</p>;
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ds-muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
