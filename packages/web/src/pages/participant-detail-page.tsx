import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import type { AssignableWorker, EpisodeSummary, Me, ParticipantDetail } from "../lib/types.js";
import type { ContactResult, EpisodeClosureReason } from "@nmbm/shared";
import { CarePlanPills, MolinaLetterPill, NoContactPill, Pill } from "../components/flags.js";
import { CarePlanSection } from "../components/care-plan-section.js";
import { ConsentsSection } from "../components/consents-section.js";
import { ReferralsSection } from "../components/referrals-section.js";
import { Link } from "react-router-dom";
import { CLOSURE_REASON_LABELS } from "../lib/labels.js";

export default function ParticipantDetailPage({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [record, setRecord] = useState<ParticipantDetail | null>(null);
  // A failed load means there is nothing to show. A rejected action —
  // the disenrolment gate, say — must not take the record off screen
  // with it, so the two are tracked separately.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api<ParticipantDetail>(`/api/participants/${id}`)
      .then(setRecord)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Could not load record"));
  }, [id]);

  useEffect(load, [load]);

  if (loadError) return <p className="text-sm text-state-alert">{loadError}</p>;
  if (!record) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  const { noContact, carePlan } = record.flags;
  const isOpen = record.episodeStatus === "open";
  const lastEpisode = record.episodes[0];

  async function act(fn: () => Promise<unknown>, success: string) {
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
      load();
    } catch (e) {
      // The gate messages from the API are the useful part — show them
      // verbatim rather than "something went wrong".
      setActionError(e instanceof ApiError ? e.message : "Action failed");
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-nmbm-ink">
            {record.firstName} {record.lastName}
          </h1>
          <p className="mt-1 text-sm text-nmbm-ink/60">
            Born {record.dateOfBirth}
            {record.workerName && ` · ${record.workerName}`}
            {record.startDate && ` · enrolled ${record.startDate}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isOpen ? (
            <>
              <MolinaLetterPill flags={noContact} />
              <NoContactPill flags={noContact} />
              <CarePlanPills flags={carePlan} />
            </>
          ) : (
            <Pill tone="muted">Closed</Pill>
          )}
        </div>
      </div>

      {/* R10: retrievable, but plainly not active — nothing on this page
          is due, and it is on nobody's caseload. */}
      {!isOpen && lastEpisode && (
        <div className="mt-6 rounded border border-nmbm-ink/15 bg-nmbm-ink/[0.03] px-4 py-3 text-sm text-nmbm-ink">
          <p className="font-medium">
            Closed {lastEpisode.endDate ?? ""}
            {lastEpisode.closureReason && ` — ${CLOSURE_REASON_LABELS[lastEpisode.closureReason]}`}
          </p>
          <p className="mt-1 text-nmbm-ink/60">
            Not on anyone's caseload. The history below is kept in full; readmitting opens a new
            episode with its own care plan clock and contact count.
          </p>
          {can(me, "episodes.write") && (
            <ReadmitForm
              participantId={record.id}
              earliest={lastEpisode.endDate}
              onDone={async (message) => {
                // Readmitted to somebody else's caseload, the record is an
                // active case the person who readmitted may not be able to
                // see — intake, usually. Tell them it worked rather than
                // showing "not found".
                try {
                  setRecord(await api<ParticipantDetail>(`/api/participants/${record.id}`));
                  setNotice(message);
                } catch {
                  navigate("/participants", {
                    state: { notice: `${record.firstName} ${record.lastName}: ${message}` },
                  });
                }
              }}
              onError={setActionError}
            />
          )}
        </div>
      )}

      {notice && (
        <p className="mt-4 rounded border border-state-ok/20 bg-state-ok-bg px-3 py-2 text-sm text-state-ok">
          {notice}
        </p>
      )}
      {actionError && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {actionError}
        </p>
      )}

      {/* M6: the prompt appears where the worker already is, rather than
          asking them to remember the rule. */}
      {noContact.warning && record.episodeStatus === "open" && (
        <div className="mt-6 rounded border border-state-warn/25 bg-state-warn-bg px-4 py-3 text-sm text-state-warn">
          <p className="font-medium">
            {noContact.count} failed contact attempts — prepare exit documentation.
          </p>
          <p className="mt-1">
            {noContact.disenrollmentEligible
              ? "Disenrolment is now allowed."
              : `${noContact.attemptsUntilDisenrollment} more attempt(s) needed before disenrolment is allowed.`}
          </p>
          {noContact.molinaLetterRequired && (
            <p className="mt-2">
              Molina requires a disenrolment warning letter before this case can be closed.
              {can(me, "episodes.write") && record.episodeId && (
                <button
                  onClick={() =>
                    act(
                      () =>
                        api(`/api/episodes/${record.episodeId}/disenrollment-letter`, {
                          method: "POST",
                        }),
                      "Letter recorded.",
                    )
                  }
                  className="ml-2 rounded border border-state-warn px-2 py-0.5 text-xs font-medium hover:bg-state-warn hover:text-nmbm-paper"
                >
                  Record letter sent
                </button>
              )}
            </p>
          )}
        </div>
      )}

      {can(me, "notes.write") && record.episodeStatus === "open" && record.episodeId && (
        <NoteForm
          participantId={record.id}
          episodeId={record.episodeId}
          onSaved={(message) => {
            setNotice(message);
            load();
          }}
        />
      )}

      <CarePlanSection
        record={record}
        me={me}
        onChanged={(message) => {
          setNotice(message);
          load();
        }}
      />

      <ConsentsSection
        record={record}
        me={me}
        onChanged={(message) => {
          setNotice(message);
          load();
        }}
        onError={setActionError}
      />

      <ReferralsSection
        record={record}
        me={me}
        onChanged={(message) => {
          setNotice(message);
          load();
        }}
        onError={setActionError}
      />

      {record.programs.length > 0 && (
        <section className="mt-6 rounded border border-nmbm-ink/10 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
            Programmes
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {record.programs.map((enrolment) => (
              <li
                key={enrolment.enrollmentId}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-nmbm-ink/10 px-3 py-2 text-sm"
              >
                <span>
                  <Link to={`/cohorts/${enrolment.cohortId}`} className="font-medium text-nmbm-ink hover:underline">
                    {enrolment.programName}
                  </Link>
                  <span className="block text-xs text-nmbm-ink/50">
                    {enrolment.cohortName} · {enrolment.status}
                  </span>
                </span>
                {/* M14: the reason this record exists — proof for a
                    probation officer, reachable from the case. */}
                <Link
                  to={`/enrollments/${enrolment.enrollmentId}/participation`}
                  className="text-xs text-nmbm-gold-dark hover:underline"
                >
                  Proof of participation
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {can(me, "participants.assign") && isOpen && (
        <AssignmentControl
          participantId={record.id}
          currentWorker={record.workerName}
          onChanged={(message) => {
            setNotice(message);
            load();
          }}
          onError={setActionError}
        />
      )}

      {can(me, "episodes.write") && record.episodeStatus === "open" && record.episodeId && (
        <CloseEpisodeForm
          onClose={async (reason) => {
            setActionError(null);
            setNotice(null);
            const name = `${record.firstName} ${record.lastName}`;
            try {
              await api(`/api/episodes/${record.episodeId}/close`, {
                method: "POST",
                body: JSON.stringify({ closureReason: reason }),
              });
            } catch (e) {
              // The M6 gate's message says how many attempts are still
              // needed, or that the Molina letter is outstanding.
              setActionError(e instanceof ApiError ? e.message : "Could not close episode");
              return;
            }
            // R10: closing ends the assignment. Whether the closer can
            // still open the record depends on their role and on the
            // former-worker window, which the server decides — so ask it,
            // and if the answer is no, go to the list and say why rather
            // than land on a 404.
            try {
              setRecord(await api<ParticipantDetail>(`/api/participants/${record.id}`));
            } catch {
              navigate("/participants", {
                state: { notice: `Episode closed. ${name} has left your caseload.` },
              });
              return;
            }
            setNotice(
              record.workerName
                ? `Episode closed. ${name} is no longer on ${record.workerName}'s caseload.`
                : "Episode closed.",
            );
          }}
        />
      )}

      <EpisodeHistory episodes={record.episodes} />

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
          Contact history
        </h2>
        <ul className="mt-2 divide-y divide-nmbm-ink/5 rounded border border-nmbm-ink/10">
          {record.notes.map((note) => (
            <li key={note.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-nmbm-ink">{note.body}</span>
                <Pill tone={note.contactResult === "contacted" ? "ok" : "warn"}>
                  {note.contactResult === "contacted" ? "Reached" : "No contact"}
                </Pill>
              </div>
              <p className="mt-1 text-xs text-nmbm-ink/50">
                {/* After a readmission the old episode's misses are still
                    here, but no longer count — say so, or a run of "No
                    contact" under a fresh episode reads as current. */}
                {isOpen && note.episodeId !== record.episodeId && (
                  <span className="mr-1.5 rounded bg-nmbm-ink/5 px-1.5 py-0.5 text-nmbm-ink/60">
                    Earlier episode
                  </span>
                )}
                {note.authorName} · {new Date(note.createdAt).toLocaleDateString()}
                {note.status === "approved" && " · approved"}
                {note.status === "pending_review" && " · awaiting review"}
              </p>
              {/* U6: the author has to be able to see why it bounced. */}
              {note.status === "needs_revision" && note.reviewNote && (
                <p className="mt-1 rounded bg-state-warn-bg px-2 py-1 text-xs text-state-warn">
                  Returned: {note.reviewNote}
                </p>
              )}
            </li>
          ))}
          {record.notes.length === 0 && (
            <li className="px-4 py-3 text-sm text-nmbm-ink/50">No contact logged yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function NoteForm({
  participantId,
  episodeId,
  onSaved,
}: {
  participantId: string;
  episodeId: string;
  onSaved: (message: string) => void;
}) {
  const [contactResult, setContactResult] = useState<ContactResult>("contacted");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await api<{ noContact: { count: number; attemptsUntilDisenrollment: number } }>(
        "/api/notes",
        {
          method: "POST",
          body: JSON.stringify({ participantId, episodeId, contactResult, body }),
        },
      );
      setBody("");
      // Telling the worker where the ladder now stands is the whole
      // point of returning the count from the write.
      onSaved(
        contactResult === "no_contact"
          ? `Logged. ${result.noContact.count} consecutive missed attempts.`
          : "Contact logged.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded border border-nmbm-ink/10 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
        Log a contact attempt
      </h2>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        {(["contacted", "no_contact"] as ContactResult[]).map((value) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              checked={contactResult === value}
              onChange={() => setContactResult(value)}
            />
            {value === "contacted" ? "Reached them" : "Could not reach"}
          </label>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        rows={3}
        placeholder="What happened?"
        className="mt-3 w-full rounded border border-nmbm-ink/20 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={saving}
        className="mt-2 rounded bg-nmbm-ink px-5 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

function CloseEpisodeForm({ onClose }: { onClose: (reason: EpisodeClosureReason) => void }) {
  const [reason, setReason] = useState<EpisodeClosureReason>("completed");
  const labels = CLOSURE_REASON_LABELS;

  return (
    <div className="mt-6 rounded border border-nmbm-ink/10 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
        Close this episode
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as EpisodeClosureReason)}
          className="rounded border border-nmbm-ink/20 px-3 py-1.5 text-sm"
        >
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          onClick={() => onClose(reason)}
          className="rounded border border-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-ink transition hover:bg-nmbm-ink hover:text-nmbm-paper"
        >
          Close episode
        </button>
      </div>
    </div>
  );
}

// U3/M4: supervisors assign, and U9's "caseloads would be reassigned"
// is the same action — the previous assignment is closed, not erased.
function AssignmentControl({
  participantId,
  currentWorker,
  onChanged,
  onError,
}: {
  participantId: string;
  currentWorker: string | null;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [workers, setWorkers] = useState<AssignableWorker[]>([]);
  const [workerId, setWorkerId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<AssignableWorker[]>("/api/participants/assignable-workers")
      .then(setWorkers)
      .catch(() => setWorkers([]));
  }, []);

  async function submit() {
    setBusy(true);
    try {
      await api(`/api/participants/${participantId}/assignment`, {
        method: "POST",
        body: JSON.stringify({ workerId }),
      });
      setWorkerId("");
      onChanged("Reassigned.");
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not reassign");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded border border-nmbm-ink/10 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
        Assigned worker
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-nmbm-ink/70">{currentWorker ?? "Nobody assigned"}</span>
        <select
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          className="rounded border border-nmbm-ink/20 px-3 py-1.5 text-sm"
        >
          <option value="">Reassign to…</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.displayName}
            </option>
          ))}
        </select>
        <button
          disabled={!workerId || busy}
          onClick={submit}
          className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          Reassign
        </button>
      </div>
    </div>
  );
}

// M2: each stay is its own episode. Shown whenever there is more than
// one, or the record is closed, since that's when "which time?" matters.
function EpisodeHistory({ episodes }: { episodes: EpisodeSummary[] }) {
  if (episodes.length < 2 && episodes[0]?.status !== "closed") return null;
  return (
    <section className="mt-6 rounded border border-nmbm-ink/10 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
        Episodes
      </h2>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {episodes.map((episode) => (
          <li
            key={episode.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-nmbm-ink/10 px-3 py-2"
          >
            <span className="text-nmbm-ink">
              {episode.startDate} – {episode.endDate ?? "present"}
              {episode.readmittedFromEpisodeId && (
                <span className="ml-2 text-xs text-nmbm-ink/50">readmission</span>
              )}
            </span>
            <span className="text-xs text-nmbm-ink/60">
              {episode.status === "open"
                ? "Open"
                : episode.closureReason
                  ? CLOSURE_REASON_LABELS[episode.closureReason]
                  : "Closed"}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Readmission (M2/R10): the same one act as intake — a start date and a
// named worker — for somebody already on file, so their history stays
// on one record instead of a duplicate being created at the front desk.
function ReadmitForm({
  participantId,
  earliest,
  onDone,
  onError,
}: {
  participantId: string;
  earliest: string | null;
  onDone: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [workers, setWorkers] = useState<AssignableWorker[]>([]);
  const [workerId, setWorkerId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<AssignableWorker[]>("/api/participants/assignable-workers")
      .then(setWorkers)
      .catch(() => setWorkers([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/episodes", {
        method: "POST",
        body: JSON.stringify({ participantId, startDate, assignedWorkerId: workerId }),
      });
      const worker = workers.find((w) => w.id === workerId)?.displayName ?? "the worker";
      await onDone(`Readmitted and assigned to ${worker}.`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not readmit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-nmbm-ink/60">
        Start date
        <input
          type="date"
          value={startDate}
          min={earliest ?? undefined}
          onChange={(e) => setStartDate(e.target.value)}
          required
          className="rounded border border-nmbm-ink/20 bg-nmbm-paper px-3 py-1.5 text-sm text-nmbm-ink"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-nmbm-ink/60">
        Assign to
        <select
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          required
          className="rounded border border-nmbm-ink/20 bg-nmbm-paper px-3 py-1.5 text-sm text-nmbm-ink"
        >
          <option value="">Choose a worker…</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.displayName}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={!workerId || busy}
        className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-40"
      >
        {busy ? "Readmitting…" : "Readmit"}
      </button>
    </form>
  );
}
