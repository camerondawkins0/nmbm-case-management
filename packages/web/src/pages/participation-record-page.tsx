import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import type { ParticipationRecord } from "../lib/types.js";
import { BrandMark } from "../components/brand-mark.js";

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
  if (!record) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

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
          className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm"
        >
          Print
        </button>
      </div>

      <article className="rounded border border-nmbm-ink/15 p-6">
        <header className="flex items-center gap-3 border-b border-nmbm-ink/10 pb-4">
          <BrandMark size={44} />
          <div>
            <p className="font-semibold tracking-wide text-nmbm-ink">NMBM</p>
            <p className="text-xs uppercase tracking-[0.15em] text-nmbm-gold">
              Record of participation
            </p>
          </div>
        </header>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-nmbm-ink/50">Participant</dt>
          <dd className="text-nmbm-ink">
            {enrollment.firstName} {enrollment.lastName}
          </dd>
          <dt className="text-nmbm-ink/50">Date of birth</dt>
          <dd className="text-nmbm-ink">{enrollment.dateOfBirth}</dd>
          <dt className="text-nmbm-ink/50">Programme</dt>
          <dd className="text-nmbm-ink">{enrollment.programName}</dd>
          <dt className="text-nmbm-ink/50">Cohort</dt>
          <dd className="text-nmbm-ink">{enrollment.cohortName}</dd>
          <dt className="text-nmbm-ink/50">Enrolment</dt>
          <dd className="text-nmbm-ink">{enrollment.status}</dd>
        </dl>

        <p className="mt-4 rounded bg-nmbm-ink/5 px-3 py-2 text-sm text-nmbm-ink">{outcomeLine}</p>

        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-nmbm-ink/10 text-left text-xs uppercase tracking-wide text-nmbm-ink/50">
              <th className="py-2 pr-4 font-semibold">Date</th>
              <th className="py-2 pr-4 font-semibold">Session</th>
              <th className="py-2 pr-4 font-semibold">Attendance</th>
              <th className="py-2 font-semibold">Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {record.sessions.map((session) => (
              <tr key={`${session.sessionDate}-${session.recordedAt}`} className="border-b border-nmbm-ink/5">
                <td className="py-2 pr-4 text-nmbm-ink">{session.sessionDate}</td>
                <td className="py-2 pr-4 text-nmbm-ink/70">{session.topic ?? "—"}</td>
                <td className="py-2 pr-4 text-nmbm-ink">{STATUS_LABELS[session.status]}</td>
                <td className="py-2 text-nmbm-ink/70">{session.recordedByName}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-4 text-xs text-nmbm-ink/50">
          Attended {record.attended} · excused {record.excused} · absent {record.absent} · of{" "}
          {record.sessionsHeld} sessions held. Each mark above was recorded by the named
          facilitator at the time of the class.
        </p>
      </article>
    </div>
  );
}
