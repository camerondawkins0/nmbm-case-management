import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import type { AttendanceStatus } from "@nmbm/shared";
import type { CohortDetail, Me } from "../lib/types.js";
import { Pill } from "../components/flags.js";

const MARKS: { value: AttendanceStatus; label: string; short: string }[] = [
  { value: "present", label: "Present", short: "P" },
  { value: "late", label: "Late", short: "L" },
  { value: "excused", label: "Excused", short: "E" },
  { value: "absent", label: "Absent", short: "A" },
];

function shortFor(status: AttendanceStatus) {
  return MARKS.find((m) => m.value === status)?.short ?? "?";
}

function toneFor(status: AttendanceStatus) {
  if (status === "present" || status === "late") return "text-state-ok";
  if (status === "excused") return "text-state-warn";
  return "text-state-alert";
}

// M14's "grid where you mark a whole roster in one pass". The grid is
// the record; the panel underneath is how a facilitator fills it in
// without twelve separate saves.
export default function CohortPage({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<CohortDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [takingFor, setTakingFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    api<CohortDetail>(`/api/cohorts/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load cohort"));
  }, [id]);

  useEffect(load, [load]);

  if (error && !data) return <p className="text-sm text-state-alert">{error}</p>;
  if (!data) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  const markFor = (sessionId: string, enrollmentId: string) =>
    data.marks.find((m) => m.sessionId === sessionId && m.enrollmentId === enrollmentId);

  // Everyone still on the roster starts as present — the common case,
  // so a facilitator changes the exceptions rather than all twelve.
  function startTaking(sessionId: string) {
    const seeded: Record<string, AttendanceStatus> = {};
    for (const person of data!.roster) {
      if (person.status === "withdrawn") continue;
      seeded[person.enrollmentId] = markFor(sessionId, person.enrollmentId)?.status ?? "present";
    }
    setDraft(seeded);
    setTakingFor(sessionId);
    setNotice(null);
  }

  async function save() {
    if (!takingFor) return;
    setBusy(true);
    setError(null);
    try {
      const marks = Object.entries(draft).map(([enrollmentId, status]) => ({
        enrollmentId,
        status,
      }));
      await api(`/api/sessions/${takingFor}/attendance`, {
        method: "POST",
        body: JSON.stringify({ marks }),
      });
      setTakingFor(null);
      setNotice(`Attendance saved for ${marks.length} people.`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save attendance");
    } finally {
      setBusy(false);
    }
  }

  const activeRoster = data.roster.filter((p) => p.status !== "withdrawn");

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold text-nmbm-ink">{data.cohort.name}</h1>
      <p className="mt-1 text-sm text-nmbm-ink/60">
        {data.cohort.programName} · started {data.cohort.startDate} · {data.sessions.length}{" "}
        session(s) held
        {data.cohort.requiredSessions && ` · ${data.cohort.requiredSessions} needed to complete`}
      </p>

      {notice && (
        <p className="mt-4 rounded border border-state-ok/20 bg-state-ok-bg px-3 py-2 text-sm text-state-ok">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-nmbm-ink/10 text-xs uppercase tracking-wide text-nmbm-ink/50">
              <th className="py-2 pr-4 text-left font-semibold">Name</th>
              {data.sessions.map((session) => (
                <th key={session.id} className="px-2 py-2 text-center font-semibold" title={session.topic ?? ""}>
                  {session.sessionDate.slice(5)}
                </th>
              ))}
              <th className="py-2 pl-4 text-right font-semibold">Attended</th>
            </tr>
          </thead>
          <tbody>
            {data.roster.map((person) => (
              <tr key={person.enrollmentId} className="border-b border-nmbm-ink/5">
                <td className="py-2 pr-4">
                  <Link
                    to={`/participants/${person.participantId}`}
                    className="font-medium text-nmbm-ink hover:underline"
                  >
                    {person.firstName} {person.lastName}
                  </Link>
                  {person.status === "withdrawn" && (
                    <span className="ml-2 text-xs text-nmbm-ink/50">withdrawn</span>
                  )}
                </td>
                {data.sessions.map((session) => {
                  const mark = markFor(session.id, person.enrollmentId);
                  return (
                    <td key={session.id} className="px-2 py-2 text-center">
                      {mark ? (
                        <span
                          className={`font-semibold ${toneFor(mark.status)}`}
                          title={`${mark.status} — marked by ${mark.recordedByName}`}
                        >
                          {shortFor(mark.status)}
                        </span>
                      ) : (
                        <span className="text-nmbm-ink/20">·</span>
                      )}
                    </td>
                  );
                })}
                <td className="py-2 pl-4 text-right">
                  <Link
                    to={`/enrollments/${person.enrollmentId}/participation`}
                    className="text-nmbm-gold-dark hover:underline"
                  >
                    {person.attended}
                    {data.cohort.requiredSessions ? `/${data.cohort.requiredSessions}` : ""}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {can(me, "attendance.record") && (
        <section className="mt-8 rounded border border-nmbm-ink/10 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
            Take attendance
          </h2>

          {!takingFor && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => startTaking(session.id)}
                  className="rounded border border-nmbm-ink/30 px-3 py-1.5 text-sm hover:bg-nmbm-ink/5"
                >
                  {session.sessionDate}
                </button>
              ))}
              {data.sessions.length === 0 && (
                <p className="text-sm text-nmbm-ink/50">No sessions scheduled yet.</p>
              )}
            </div>
          )}

          {takingFor && (
            <>
              <p className="mt-3 text-sm text-nmbm-ink/60">
                {data.sessions.find((s) => s.id === takingFor)?.sessionDate} — everyone starts
                present; change the exceptions.
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {activeRoster.map((person) => (
                  <li
                    key={person.enrollmentId}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="text-nmbm-ink">
                      {person.firstName} {person.lastName}
                    </span>
                    <span className="flex gap-1">
                      {MARKS.map((mark) => {
                        const selected = draft[person.enrollmentId] === mark.value;
                        return (
                          <button
                            key={mark.value}
                            onClick={() =>
                              setDraft({ ...draft, [person.enrollmentId]: mark.value })
                            }
                            className={`rounded px-3 py-1 text-xs font-medium transition ${
                              selected
                                ? "bg-nmbm-ink text-nmbm-paper"
                                : "border border-nmbm-ink/20 text-nmbm-ink/60 hover:bg-nmbm-ink/5"
                            }`}
                          >
                            {mark.label}
                          </button>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex gap-2">
                <button
                  disabled={busy}
                  onClick={save}
                  className="rounded bg-nmbm-ink px-5 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-50"
                >
                  {busy ? "Saving…" : `Save all ${activeRoster.length}`}
                </button>
                <button
                  onClick={() => setTakingFor(null)}
                  className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <p className="mt-6 text-xs text-nmbm-ink/50">
        <Pill tone="ok">P</Pill> present · <Pill tone="ok">L</Pill> late ·{" "}
        <Pill tone="warn">E</Pill> excused · <Pill tone="alert">A</Pill> absent. Hover a mark to
        see who recorded it.
      </p>
    </div>
  );
}
