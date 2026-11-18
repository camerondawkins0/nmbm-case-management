import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import type { AssignableWorker, EpisodeSummary, Me, ParticipantDetail } from "../lib/types.js";
import type { ContactResult, EpisodeClosureReason } from "@nmbm/shared";
import { CarePlanPills, MolinaLetterPill, NoContactPill, Pill } from "../components/flags.js";
import { CarePlanSection } from "../components/care-plan-section.js";
import { ConsentsSection } from "../components/consents-section.js";
import { DocumentsSection } from "../components/documents-section.js";
import { AssessmentsSection } from "../components/assessments-section.js";
import { ReferralsSection } from "../components/referrals-section.js";
import { Link } from "react-router-dom";
import { CLOSURE_REASON_LABELS, REFERRAL_SOURCE_LABELS } from "../lib/labels.js";
import { FOLLOW_UP_OUTCOME_LABELS } from "@nmbm/shared";
import type { FollowUpSchedule } from "../lib/types.js";
import { FollowUpCallForm } from "../components/follow-up-call-form.js";
import { ClientDetailsSection } from "../components/client-details.js";
import { HousingSection } from "../components/housing-section.js";
import { todayInOrg } from "@nmbm/shared";
import { DateText, Timestamp, formatDay } from "../components/dates.js";
import { TabList, TabPanel } from "../components/tabs.js";
import { useShowMore } from "../components/show-more.js";

// The record was one page of a dozen sections, several screens long. It is
// now in tabs, by the kind of work: what a worker does on most visits is on
// Overview, and the rest is a tab away rather than a long scroll down.
const RECORD_TABS = [
  { id: "overview", label: "Overview" },
  { id: "care-plan", label: "Care plan" },
  { id: "housing", label: "Housing" },
  { id: "forms", label: "Forms & documents" },
  { id: "referrals", label: "Referrals & programs" },
  { id: "case", label: "Case" },
] as const;

export default function ParticipantDetailPage({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Arrived from the referrals queue to readmit a returning client.
  const [params, setParams] = useSearchParams();
  const fromReferral = params.get("referral");
  // The open tab is in the address, so a reload or a shared link lands on
  // the same tab, and Back still leaves the record rather than stepping
  // through every tab looked at.
  const tab = RECORD_TABS.some((t) => t.id === params.get("tab")) ? params.get("tab")! : "overview";
  function chooseTab(next: string) {
    const p = new URLSearchParams(params);
    if (next === "overview") p.delete("tab");
    else p.set("tab", next);
    setParams(p, { replace: true });
  }
  const [record, setRecord] = useState<ParticipantDetail | null>(null);
  // A failed load means there is nothing to show. A rejected action —
  // the disenrollment gate, say — must not take the record off screen
  // with it, so the two are tracked separately.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The author revising a note a reviewer sent back (U6).
  const [revising, setRevising] = useState<string | null>(null);
  const [revision, setRevision] = useState("");
  const [revisionDate, setRevisionDate] = useState("");
  // Arriving at one note from a link shows them all, so the note is there to
  // scroll to however old it is.
  const contacts = useShowMore(record?.notes ?? [], 10, window.location.hash.startsWith("#note-"));

  const load = useCallback(() => {
    if (!id) return;
    api<ParticipantDetail>(`/api/participants/${id}`)
      .then(setRecord)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Could not load record"));
  }, [id]);

  useEffect(load, [load]);

  // Arriving from "Notes returned to you": the note isn't on the page
  // until the record has loaded, so the browser can't jump to it alone.
  useEffect(() => {
    if (!record || !window.location.hash.startsWith("#note-")) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [record]);

  if (loadError) return <p className="text-sm text-state-alert">{loadError}</p>;
  if (!record) return <p className="text-sm text-ds-muted">Loading…</p>;

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
      return true;
    } catch (e) {
      // The gate messages from the API are the useful part — show them
      // verbatim rather than "something went wrong".
      setActionError(e instanceof ApiError ? e.message : "Action failed");
      return false;
    }
  }

  return (
    <div className="ds-record mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="ds-display">
            {record.firstName} {record.lastName}
          </h1>
          <p className="mt-1 text-sm text-ds-muted">
            Born <DateText value={record.dateOfBirth} />
            {record.workerName && ` · ${record.workerName}`}
            {record.startDate && (
              <>
                {" "}
                · enrolled <DateText value={record.startDate} />
              </>
            )}
          </p>
          {can(me, "records.export") && (
            <Link
              to={`/participants/${record.id}/export`}
              className="mt-1 inline-block text-xs text-ds-muted underline underline-offset-2 hover:text-ds-ink"
            >
              Export the full record
            </Link>
          )}
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
        <div className="nmbm-alert nmbm-alert--info mt-6">
          <p className="font-medium">
            Closed <DateText value={lastEpisode.endDate} />
            {lastEpisode.closureReason && ` — ${CLOSURE_REASON_LABELS[lastEpisode.closureReason]}`}
          </p>
          <p className="mt-1 text-ds-muted">
            Not on anyone's caseload. The history below is kept in full; readmitting opens a new
            episode with its own care plan clock and contact count.
          </p>
          {fromReferral && can(me, "episodes.write") && (
            <p className="mt-2 text-sm text-ds-secondary">
              Readmitting from a referral — the referral closes when they're readmitted.
            </p>
          )}
          {can(me, "episodes.write") && (
            <ReadmitForm
              participantId={record.id}
              incomingReferralId={fromReferral}
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
        <p className="nmbm-alert nmbm-alert--ok mt-4">
          {notice}
        </p>
      )}
      {actionError && (
        <p className="nmbm-alert nmbm-alert--alert mt-4">
          {actionError}
        </p>
      )}

      {/* M6: the prompt appears where the worker already is, rather than
          asking them to remember the rule. */}
      {noContact.warning && record.episodeStatus === "open" && (
        <div className="nmbm-alert nmbm-alert--warn mt-6">
          <p className="font-medium">
            {noContact.count} failed contact attempts — prepare exit documentation.
          </p>
          <p className="mt-1">
            {noContact.disenrollmentEligible
              ? "Disenrollment is now allowed."
              : `${noContact.attemptsUntilDisenrollment} more attempt(s) needed before disenrollment is allowed.`}
          </p>
          {noContact.molinaLetterRequired && (
            <p className="mt-2">
              Molina requires a disenrollment warning letter before this case can be closed.
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
                  className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm ml-2"
                >
                  Record letter sent
                </button>
              )}
            </p>
          )}
        </div>
      )}

      <TabList tabs={[...RECORD_TABS]} active={tab} onChange={chooseTab} idPrefix="record" label="Record sections" />

      {/* Overview: the day-to-day of a case, side by side where there is
          room. Logging a contact sits beside the details it needs (a phone
          number), with the history underneath. */}
      <TabPanel id="overview" active={tab} idPrefix="record">
        <div className="ds-record-grid">
          <div className="ds-col">
            <ClientDetailsSection
              participantId={record.id}
              details={record.details}
              canEdit={can(me, "participants.update") && record.canWrite}
              onSaved={(message) => {
                setNotice(message);
                load();
              }}
            />
          </div>
          <div className="ds-col">
            {can(me, "notes.write") && record.episodeStatus === "open" && record.episodeId && (
              <NoteForm
                participantId={record.id}
                episodeId={record.episodeId}
                stayStarted={record.startDate}
                onSaved={(message) => {
                  setNotice(message);
                  load();
                }}
              />
            )}
            {record.followUps && (
              <FollowUpSection
                schedule={record.followUps}
                canRecord={can(me, "follow_ups.record")}
                onSaved={(message) => {
                  setNotice(message);
                  load();
                }}
              />
            )}
          </div>
        </div>
        <div className="ds-col mt-6">
            <section className="flex flex-col">
              <h2 className="ds-section-heading">
                Contact history
              </h2>
              <ul className="ds-list mt-2">
                {contacts.shown.map((note) => (
                  <li key={note.id} id={`note-${note.id}`} className="scroll-mt-6 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-ds-ink">{note.body}</span>
                      <Pill tone={note.contactResult === "contacted" ? "ok" : "warn"}>
                        {note.contactResult === "contacted" ? "Reached" : "No contact"}
                      </Pill>
                    </div>
                    <p className="mt-1 text-xs text-ds-muted">
                      {/* After a readmission the old episode's misses are still
                          here, but no longer count — say so, or a run of "No
                          contact" under a fresh episode reads as current. */}
                      {isOpen && note.episodeId !== record.episodeId && (
                        <span className="mr-1.5 rounded bg-ds-subtle px-1.5 py-0.5 text-ds-muted">
                          Earlier episode
                        </span>
                      )}
                      <span className="font-medium text-ds-secondary">
                        <DateText value={note.serviceDate} />
                      </span> · {note.authorName}
                      {/* Written up on a later day: both dates, so the gap is visible. */}
                      {formatDay(note.createdAt) !== note.serviceDate && (
                        <>
                          {" "}
                          · written <Timestamp at={note.createdAt} />
                        </>
                      )}
                      {note.clinicalReview && " · clinical"}
                      {note.status === "approved" && " · approved"}
                      {note.status === "pending_review" && " · awaiting review"}
                    </p>
                    {/* U6: the author has to be able to see why it bounced. */}
                    {note.status === "needs_revision" && note.reviewNote && (
                      <p className="mt-1 rounded bg-state-warn-bg px-2 py-1 text-xs text-state-warn">
                        Returned: {note.reviewNote}
                      </p>
                    )}
                    {note.status === "needs_revision" && note.authorId === me.id && revising !== note.id && (
                      <button
                        onClick={() => {
                          setRevising(note.id);
                          setRevision(note.body);
                          setRevisionDate(note.serviceDate);
                        }}
                        className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm mt-2"
                      >
                        Revise and resubmit
                      </button>
                    )}
                    {revising === note.id && (
                      <form
                        className="mt-2 flex flex-col gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          act(
                            () =>
                              api(`/api/notes/${note.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ body: revision, serviceDate: revisionDate }),
                              }),
                            "Note revised and sent back for review.",
                          ).then((ok) => ok && setRevising(null));
                        }}
                      >
                        <textarea
                          aria-label="Revised note"
                          rows={4}
                          value={revision}
                          onChange={(e) => setRevision(e.target.value)}
                          className="nmbm-control nmbm-textarea"
                        />
                        <label className="flex items-center gap-2 text-xs text-ds-secondary">
                          Date of service
                          <input
                            type="date"
                            required
                            value={revisionDate}
                            max={todayInOrg()}
                            onChange={(e) => setRevisionDate(e.target.value)}
                            className="nmbm-control"
                          />
                        </label>
                        <div className="flex gap-2">
                          <button
                            disabled={!revision.trim() || (revision === note.body && revisionDate === note.serviceDate)}
                            className="nmbm-btn nmbm-btn--dark nmbm-btn--sm"
                          >
                            Resubmit for review
                          </button>
                          <button type="button" onClick={() => setRevising(null)} className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm">
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </li>
                ))}
                {record.notes.length === 0 && (
                  <li className="px-4 py-3 text-sm text-ds-muted">No contact logged yet.</li>
                )}
              </ul>
              {contacts.toggle}
            </section>
        </div>
      </TabPanel>

      <TabPanel id="care-plan" active={tab} idPrefix="record">
        <div className="ds-col">
            <CarePlanSection
              record={record}
              me={me}
              onChanged={(message) => {
                setNotice(message);
                load();
              }}
            />
        </div>
      </TabPanel>

      <TabPanel id="housing" active={tab} idPrefix="record">
        <div className="ds-col">
            <HousingSection record={record} me={me} onChanged={setNotice} onError={setActionError} />
        </div>
      </TabPanel>

      <TabPanel id="forms" active={tab} idPrefix="record">
        <div className="ds-record-grid ds-record-grid--even">
          <div className="ds-col">
            <ConsentsSection
              record={record}
              me={me}
              onChanged={(message) => {
                setNotice(message);
                load();
              }}
              onError={setActionError}
            />
          </div>
          <div className="ds-col">
            <DocumentsSection
              record={record}
              me={me}
              onChanged={(message) => {
                setNotice(message);
                load();
              }}
              onError={setActionError}
            />
          </div>
        </div>
        <div className="ds-col mt-6">
            <AssessmentsSection record={record} me={me} onError={setActionError} />
        </div>
      </TabPanel>

      <TabPanel id="referrals" active={tab} idPrefix="record">
        <div className="ds-record-grid ds-record-grid--even">
          <div className="ds-col">
            <ReferralsSection
              record={record}
              me={me}
              onChanged={(message) => {
                setNotice(message);
                load();
              }}
              onError={setActionError}
            />
          </div>
          <div className="ds-col">
            {record.referralsIn.length > 0 && (
              <section className="nmbm-card nmbm-card--dense mt-6">
                <h2 className="ds-section-heading">Referred to NMBM</h2>
                <ul className="mt-2 flex flex-col gap-2 text-sm">
                  {record.referralsIn.map((r) => (
                    <li key={r.id}>
                      <span className="font-medium text-ds-ink">{r.sourceName || REFERRAL_SOURCE_LABELS[r.sourceType]}</span>
                      <span className="text-xs text-ds-muted"> · received <DateText value={r.receivedDate} /></span>
                      <p className="text-ds-secondary">{r.reason}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {record.programs.length > 0 && (
              <section className="nmbm-card nmbm-card--dense mt-6">
                <h2 className="ds-section-heading">
                  Programs
                </h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {record.programs.map((enrollment) => (
                    <li
                      key={enrollment.enrollmentId}
                      className="ds-row flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        <Link to={`/cohorts/${enrollment.cohortId}`} className="font-medium text-ds-ink hover:underline">
                          {enrollment.programName}
                        </Link>
                        <span className="block text-xs text-ds-muted">
                          {enrollment.cohortName} · {enrollment.status}
                        </span>
                      </span>
                      {/* M14: the reason this record exists — proof for a
                          probation officer, reachable from the case. */}
                      <Link
                        to={`/enrollments/${enrollment.enrollmentId}/participation`}
                        className="text-xs text-ds-accent hover:underline"
                      >
                        Proof of participation
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {record.referralsIn.length === 0 && record.programs.length === 0 && (
              <p className="nmbm-card nmbm-card--dense text-sm text-ds-muted">Not referred in, and in no programs.</p>
            )}
          </div>
        </div>
      </TabPanel>

      <TabPanel id="case" active={tab} idPrefix="record">
        <div className="ds-record-grid ds-record-grid--even">
          <div className="ds-col">
            {/* Who holds the case, for anyone who can't change it; the
                reassign control says the same for those who can. */}
            {!(can(me, "participants.assign") && isOpen) && (
              <section className="nmbm-card nmbm-card--dense">
                <h2 className="ds-section-heading">Case manager</h2>
                <p className="mt-2 text-sm">
                  {isOpen ? (record.workerName ?? "Nobody assigned") : "None: the case is closed."}
                </p>
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
          </div>
          <div className="ds-col">
            <EpisodeHistory episodes={record.episodes} />
          </div>
        </div>
      </TabPanel>
    </div>
  );
}


function NoteForm({
  participantId,
  episodeId,
  stayStarted,
  onSaved,
}: {
  participantId: string;
  episodeId: string;
  stayStarted: string | null;
  onSaved: (message: string) => void;
}) {
  const [contactResult, setContactResult] = useState<ContactResult>("contacted");
  const [body, setBody] = useState("");
  const [serviceDate, setServiceDate] = useState(todayInOrg);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ noContact: { count: number; attemptsUntilDisenrollment: number } }>(
        "/api/notes",
        {
          method: "POST",
          body: JSON.stringify({ participantId, episodeId, contactResult, body, serviceDate }),
        },
      );
      setBody("");
      setServiceDate(todayInOrg());
      // Telling the worker where the ladder now stands is the whole
      // point of returning the count from the write.
      onSaved(
        contactResult === "no_contact"
          ? `Logged. ${result.noContact.count} consecutive missed attempts.`
          : "Contact logged.",
      );
    } catch (err) {
      // Kept on screen with what was typed: a visit note is hard to
      // write twice.
      setError(err instanceof ApiError ? err.message : "Could not save the note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="nmbm-card nmbm-card--dense mt-6">
      <h2 className="ds-section-heading">
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
        <label className="ml-auto flex items-center gap-2 text-ds-secondary">
          Date of service
          <input
            type="date"
            required
            value={serviceDate}
            min={stayStarted ?? undefined}
            max={todayInOrg()}
            onChange={(e) => setServiceDate(e.target.value)}
            className="nmbm-control"
          />
        </label>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        rows={3}
        placeholder="What happened?"
        className="nmbm-control nmbm-textarea mt-3 w-full"
      />
      {error && <p className="mt-1 text-sm text-state-alert">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="nmbm-btn nmbm-btn--dark nmbm-btn--md mt-2"
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
    <div className="nmbm-card nmbm-card--dense mt-6">
      <h2 className="ds-section-heading">
        Close this episode
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as EpisodeClosureReason)}
          className="nmbm-control nmbm-select"
        >
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          onClick={() => onClose(reason)}
          className="nmbm-btn nmbm-btn--secondary nmbm-btn--md"
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
    <div className="nmbm-card nmbm-card--dense mt-6">
      <h2 className="ds-section-heading">
        Assigned worker
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-ds-secondary">{currentWorker ?? "Nobody assigned"}</span>
        <select
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          className="nmbm-control nmbm-select"
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
          className="nmbm-btn nmbm-btn--secondary nmbm-btn--md"
        >
          Reassign
        </button>
      </div>
    </div>
  );
}

// M2: each stay is its own episode. Shown whenever there is more than
// one, or the record is closed, since that's when "which time?" matters.
// Every stay with NMBM, the current one included: on its own tab there is
// room, and "since when" is the first thing asked about a case.
function EpisodeHistory({ episodes }: { episodes: EpisodeSummary[] }) {
  if (episodes.length === 0) return null;
  return (
    <section className="nmbm-card nmbm-card--dense mt-6">
      <h2 className="ds-section-heading">
        Episodes
      </h2>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {episodes.map((episode) => (
          <li
            key={episode.id}
            className="ds-row flex flex-wrap items-center justify-between gap-2"
          >
            <span className="text-ds-ink">
              <DateText value={episode.startDate} /> – {episode.endDate ? <DateText value={episode.endDate} /> : "present"}
              {episode.readmittedFromEpisodeId && (
                <span className="ml-2 text-xs text-ds-muted">readmission</span>
              )}
            </span>
            <span className="text-xs text-ds-muted">
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
  incomingReferralId,
  earliest,
  onDone,
  onError,
}: {
  participantId: string;
  incomingReferralId: string | null;
  earliest: string | null;
  onDone: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [workers, setWorkers] = useState<AssignableWorker[]>([]);
  const [workerId, setWorkerId] = useState("");
  // Long Beach's today, not UTC's: after 4pm here UTC is already tomorrow.
  const [startDate, setStartDate] = useState(todayInOrg);
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
        body: JSON.stringify({
          participantId,
          startDate,
          assignedWorkerId: workerId,
          incomingReferralId: incomingReferralId ?? undefined,
        }),
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
      <label className="flex flex-col gap-1 text-xs text-ds-muted">
        Start date
        <input
          type="date"
          value={startDate}
          min={earliest ?? undefined}
          onChange={(e) => setStartDate(e.target.value)}
          required
          className="nmbm-control"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ds-muted">
        Assign to
        <select
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          required
          className="nmbm-control nmbm-select"
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
        className="nmbm-btn nmbm-btn--dark nmbm-btn--md"
      >
        {busy ? "Readmitting…" : "Readmit"}
      </button>
    </form>
  );
}

const MILESTONE_TONE = {
  completed: "ok",
  due: "warn",
  overdue: "alert",
  upcoming: "muted",
  lapsed: "muted",
} as const;

const MILESTONE_LABEL = {
  completed: "Done",
  due: "Due now",
  overdue: "Overdue",
  upcoming: "Upcoming",
  lapsed: "Missed",
} as const;

// M12 on the record: all four calls, what each came to, and every
// attempt with who made it — so a supervisor reading the file can see
// "tried twice, then reached" rather than just the last word.
function FollowUpSection({
  schedule,
  canRecord,
  onSaved,
}: {
  schedule: FollowUpSchedule;
  canRecord: boolean;
  onSaved: (message: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="nmbm-card nmbm-card--dense mt-6">
      <h2 className="ds-section-heading">Follow-up calls</h2>
      <p className="mt-1 text-xs text-ds-muted">Counted from the case closing on <DateText value={schedule.endDate} />.</p>
      <ol className="mt-3 flex flex-col gap-2">
        {schedule.milestones.map((m) => (
          <li key={m.months} className="ds-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ds-ink">
                <span className="font-medium">{m.months}-month call</span>
                <span className="ml-2 text-xs text-ds-muted">due <DateText value={m.dueDate} /></span>
              </span>
              <span className="flex items-center gap-2">
                <Pill tone={MILESTONE_TONE[m.state]}>{MILESTONE_LABEL[m.state]}</Pill>
                {canRecord && (m.state === "due" || m.state === "overdue") && open !== m.months && (
                  <button
                    onClick={() => setOpen(m.months)}
                    className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm"
                  >
                    Record call
                  </button>
                )}
              </span>
            </div>
            {m.attempts.map((call) => (
              <div key={call.id} className="mt-2 border-l-2 border-ds-border pl-3 text-xs text-ds-secondary">
                <p>
                  <span className="font-medium text-ds-ink">{FOLLOW_UP_OUTCOME_LABELS[call.outcome]}</span> ·{" "}
                  {call.calledByName} · <Timestamp at={call.calledAt} />
                </p>
                {call.note && <p className="mt-0.5">{call.note}</p>}
                {call.servicesFeedback && <p className="mt-0.5 italic">On NMBM's services: {call.servicesFeedback}</p>}
              </div>
            ))}
            {open === m.months && (
              <FollowUpCallForm
                episodeId={schedule.episodeId}
                months={m.months}
                onSaved={(message) => {
                  setOpen(null);
                  onSaved(message);
                }}
                onCancel={() => setOpen(null)}
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
