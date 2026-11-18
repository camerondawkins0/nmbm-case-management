import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import type { AttendanceStatus } from "@nmbm/shared";
import type { CohortDetail, Me } from "../lib/types.js";
import { Pill } from "../components/flags.js";
import { AddClassDate, CohortDetailsForm, CohortStatusActions, EnrollPanel, WithdrawButton } from "../components/cohort-setup.js";
import { DateText } from "../components/dates.js";

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
  const [editingDetails, setEditingDetails] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    api<CohortDetail>(`/api/cohorts/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load cohort"));
  }, [id]);

  useEffect(load, [load]);

  // Setting the class up: dates, roster, and moving it on. One helper so
  // every action reports back the same way.
  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(message);
      load();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
      return false;
    }
  };

  if (error && !data) return <p className="text-sm text-state-alert">{error}</p>;
  if (!data) return <p className="text-sm text-ds-muted">Loading…</p>;

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
  const manage = can(me, "programs.manage");
  // Completed or canceled: no new dates or people (the server refuses
  // too). Attendance can still be corrected after the fact.
  const open = data.cohort.status === "planned" || data.cohort.status === "running";

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/programs" className="text-sm text-ds-muted underline-offset-2 hover:underline">
        ← Programs
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="ds-display">{data.cohort.name}</h1>
          <p className="mt-1 text-sm text-ds-muted">
            {data.cohort.programName} · {data.cohort.status === "planned" ? "starts" : "started"}{" "}
            <DateText value={data.cohort.startDate} /> · {data.sessions.length} class date(s)
            {data.cohort.requiredSessions && ` · ${data.cohort.requiredSessions} needed to complete`}
          </p>
          <p className="text-xs text-ds-muted">
            Counted as attending: {data.countedStatuses.join(", ")} (set on the program)
          </p>
          {manage && !editingDetails && (
            <button
              onClick={() => setEditingDetails(true)}
              className="mt-1 text-xs text-ds-muted underline underline-offset-2 hover:text-ds-ink"
            >
              Edit details
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={data.cohort.status === "running" ? "ok" : data.cohort.status === "planned" ? "warn" : "muted"}>
            {data.cohort.status}
          </Pill>
          {manage && <CohortStatusActions cohort={data.cohort} act={act} />}
        </div>
      </div>

      {editingDetails && (
        <CohortDetailsForm cohort={data.cohort} act={act} onDone={() => setEditingDetails(false)} />
      )}

      {notice && (
        <p className="nmbm-alert nmbm-alert--ok mt-4">
          {notice}
        </p>
      )}
      {error && (
        <p className="nmbm-alert nmbm-alert--alert mt-4">
          {error}
        </p>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ds-border text-xs uppercase tracking-wide text-ds-muted">
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
              <tr key={person.enrollmentId} className="border-b border-ds-border">
                <td className="py-2 pr-4">
                  <Link
                    to={`/participants/${person.participantId}`}
                    className="ds-person hover:underline"
                  >
                    {person.firstName} {person.lastName}
                  </Link>
                  {person.status === "withdrawn" && (
                    <span className="ml-2 align-middle" title={person.withdrawnReason ? `Withdrawn: ${person.withdrawnReason}` : "Withdrawn"}>
                      <Pill tone="muted">withdrawn</Pill>
                    </span>
                  )}
                  {manage && person.status !== "withdrawn" && (
                    <WithdrawButton
                      enrollmentId={person.enrollmentId}
                      name={`${person.firstName} ${person.lastName}`}
                      act={act}
                    />
                  )}
                  <ServicesEndedFlag on={person.servicesEndedOn} />
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
                        <span className="text-ds-muted">·</span>
                      )}
                    </td>
                  );
                })}
                <td className="py-2 pl-4 text-right">
                  <Link
                    to={`/enrollments/${person.enrollmentId}/participation`}
                    className="text-ds-accent hover:underline"
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

      {data.roster.length === 0 && (
        <p className="mt-3 text-sm text-ds-muted">Nobody is on the roster yet.</p>
      )}

      {manage && open && (
        <section className="nmbm-card nmbm-card--dense mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="ds-section-heading">Add a class date</h2>
            <AddClassDate cohortId={data.cohort.id} act={act} />
          </div>
          <div>
            <h2 className="ds-section-heading">Add someone to the roster</h2>
            <EnrollPanel
              cohortId={data.cohort.id}
              rosterIds={new Set(data.roster.map((p) => p.participantId))}
              act={act}
            />
          </div>
        </section>
      )}

      {can(me, "attendance.record") && (
        <section className="nmbm-card nmbm-card--dense mt-8">
          <h2 className="ds-section-heading">
            Take attendance
          </h2>

          {!takingFor && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => startTaking(session.id)}
                  className="nmbm-btn nmbm-btn--secondary nmbm-btn--md"
                >
                  <DateText value={session.sessionDate} />
                </button>
              ))}
              {data.sessions.length === 0 && (
                <p className="text-sm text-ds-muted">No sessions scheduled yet.</p>
              )}
            </div>
          )}

          {takingFor && (
            <>
              <p className="mt-3 text-sm text-ds-muted">
                {data.sessions.find((s) => s.id === takingFor)?.sessionDate} — everyone starts
                present; change the exceptions.
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {activeRoster.map((person) => (
                  <li
                    key={person.enrollmentId}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="text-ds-ink">
                      {person.firstName} {person.lastName}
                      <ServicesEndedFlag on={person.servicesEndedOn} />
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
                                : "border border-ds-control text-ds-muted hover:bg-ds-subtle"
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
                  className="nmbm-btn nmbm-btn--dark nmbm-btn--md"
                >
                  {busy ? "Saving…" : `Save all ${activeRoster.length}`}
                </button>
                <button
                  onClick={() => setTakingFor(null)}
                  className="nmbm-btn nmbm-btn--secondary nmbm-btn--md"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <p className="mt-6 text-xs text-ds-muted">
        <Pill tone="ok">P</Pill> present · <Pill tone="ok">L</Pill> late ·{" "}
        <Pill tone="warn">E</Pill> excused · <Pill tone="alert">A</Pill> absent. Hover a mark to
        see who recorded it.
      </p>
    </div>
  );
}

// R10/M14: NMBM's answer — disenrollment means the person no longer
// receives services from NMBM, so flag them on the roster rather than
// withdrawing them. A court-ordered class may continue regardless, and
// whether it does is the facilitator's call, not the system's.
function ServicesEndedFlag({ on }: { on: string | null }) {
  if (!on) return null;
  return (
    <span
      className="ml-2 align-middle"
      title="Disenrolled from NMBM services. Still on this roster; attendance can still be recorded."
    >
      <Pill tone="warn">Services ended {on}</Pill>
    </span>
  );
}
