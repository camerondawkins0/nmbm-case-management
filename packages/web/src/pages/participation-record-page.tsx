import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import type { ParticipationRecord } from "../lib/types.js";
import { BrandMark } from "../components/brand-mark.js";
import { DateText } from "../components/dates.js";

const STATUS_LABELS = {
  present: "Present",
  late: "Present (late)",
  excused: "Excused absence",
  absent: "Absent",
} as const;

// M14: "The PO's or whomever, will need proof the person participated in
// the class." This is that page — dated rows with who recorded each one,
// not a summary figure somebody could have typed. It's laid out to be
// printed and handed over.
export default function ParticipationRecordPage() {
  const { id } = useParams<{ id: string }>();
  const [record, setRecord] = useState<ParticipationRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<ParticipationRecord>(`/api/enrollments/${id}/participation`)
      .then(setRecord)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load record"));
  }, [id]);

  if (error) return <p className="text-sm text-state-alert">{error}</p>;
  if (!record) return <p className="text-sm text-ds-muted">Loading…</p>;

  const { enrollment } = record;
  const outcomeLine = {
    met: `Completed: attended ${record.attended} of the ${enrollment.requiredSessions} sessions required.`,
    short: `Did not complete: attended ${record.attended} of the ${enrollment.requiredSessions} sessions required.`,
    in_progress: `In progress: attended ${record.attended} of ${record.sessionsHeld} sessions held so far; ${enrollment.requiredSessions} are required to complete.`,
    no_requirement: `Attended ${record.attended} of ${record.sessionsHeld} sessions held.`,
  }[record.outcome];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex justify-end print:hidden">
        <button
          onClick={() => window.print()}
          className="nmbm-btn nmbm-btn--secondary nmbm-btn--md"
        >
          Print
        </button>
      </div>

      <article className="nmbm-card">
        <header className="flex items-center gap-3 border-b border-ds-border pb-4">
          <BrandMark size={44} />
          <div>
            <p className="font-semibold tracking-wide text-ds-ink">NMBM</p>
            {/* The document's title, so it reads as one to a screen reader
                as well as on paper. */}
            <h1 className="nmbm-label">
              Record of participation
            </h1>
          </div>
        </header>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ds-muted">Participant</dt>
          <dd className="text-ds-ink">
            {enrollment.firstName} {enrollment.lastName}
          </dd>
          <dt className="text-ds-muted">Date of birth</dt>
          <dd className="text-ds-ink">{enrollment.dateOfBirth}</dd>
          <dt className="text-ds-muted">Program</dt>
          <dd className="text-ds-ink">{enrollment.programName}</dd>
          <dt className="text-ds-muted">Cohort</dt>
          <dd className="text-ds-ink">{enrollment.cohortName}</dd>
          <dt className="text-ds-muted">Enrollment</dt>
          <dd className="text-ds-ink">{enrollment.status}</dd>
        </dl>

        <p className="mt-4 rounded bg-ds-subtle px-3 py-2 text-sm text-ds-ink">{outcomeLine}</p>

        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ds-border text-left text-xs uppercase tracking-wide text-ds-muted">
              <th className="py-2 pr-4 font-semibold">Date</th>
              <th className="py-2 pr-4 font-semibold">Session</th>
              <th className="py-2 pr-4 font-semibold">Attendance</th>
              <th className="py-2 font-semibold">Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {record.sessions.map((session) => (
              <tr key={`${session.sessionDate}-${session.recordedAt}`} className="border-b border-ds-border">
                <td className="py-2 pr-4 text-ds-ink"><DateText value={session.sessionDate} /></td>
                <td className="py-2 pr-4 text-ds-secondary">{session.topic ?? "—"}</td>
                <td className="py-2 pr-4 text-ds-ink">{STATUS_LABELS[session.status]}</td>
                <td className="py-2 text-ds-secondary">{session.recordedByName}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-4 text-xs text-ds-muted">
          Counted as attending {record.attended} · excused {record.excused} · absent {record.absent} ·
          of {record.sessionsHeld} sessions held. {countingRule(record.countedStatuses)} Each mark
          above was recorded by the named facilitator at the time of the class.
        </p>
      </article>
    </div>
  );
}

// The program's own rule, in words, because the reader is outside NMBM
// and "attended 9" means nothing without knowing what counted.
function countingRule(counted: ParticipationRecord["countedStatuses"]) {
  const words = counted.map((s) => (s === "present" ? "present" : s === "late" ? "late" : "excused"));
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `For this program, ${list} marks count as attending.`;
}
