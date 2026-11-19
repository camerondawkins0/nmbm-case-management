import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import type { PendingNote } from "../lib/types.js";
import { Pill } from "../components/flags.js";
import { DateText } from "../components/dates.js";

// U6: "CHW supervisor/Program Manager can either approve CHW notes or
// return them for revision." The permission was granted from the start;
// this is the first screen that can act on it.
//
// Two levels, because that is how a supervisor works the queue: first who
// has notes waiting and how many, then one case manager's notes at a time,
// on a page of their own that can be linked to and left with Back. One list
// of every note mixed everybody together.

type Group = { key: string; name: string; notes: PendingNote[] };

// Notes on closed cases have no case manager; they get a page of their own.
const NO_CASE_MANAGER = "none";
const NO_CASE_MANAGER_NAME = "No current case manager";

const keyOf = (note: PendingNote) => note.caseManagerId ?? NO_CASE_MANAGER;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function groupByCaseManager(notes: PendingNote[]): Group[] {
  const groups = new Map<string, Group>();
  for (const note of notes) {
    const key = keyOf(note);
    if (!groups.has(key)) groups.set(key, { key, name: note.caseManagerName ?? NO_CASE_MANAGER_NAME, notes: [] });
    groups.get(key)!.notes.push(note);
  }
  // Alphabetical, so a worker is in the same place each visit; closed
  // cases, with nobody to group them under, go last.
  return [...groups.values()].sort((a, b) =>
    a.key === NO_CASE_MANAGER ? 1 : b.key === NO_CASE_MANAGER ? -1 : a.name.localeCompare(b.name),
  );
}

function useQueue() {
  const [notes, setNotes] = useState<PendingNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<PendingNote[]>("/api/notes/awaiting-review")
        .then(setNotes)
        .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the queue")),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { notes, error, load };
}

// The queue: each case manager with notes waiting, and how many.
export default function NoteReviewPage() {
  const { notes, error } = useQueue();
  const groups = useMemo(() => groupByCaseManager(notes ?? []), [notes]);

  if (error) return <p className="nmbm-alert nmbm-alert--alert">{error}</p>;
  if (!notes) return <p className="text-sm text-ds-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="ds-display">Notes awaiting review</h1>
      <p className="mt-1 text-sm text-ds-muted">
        {notes.length === 0
          ? "Nothing waiting."
          : `${plural(notes.length, "note", "notes")} waiting. Choose a case manager to review theirs.`}
      </p>

      {groups.length > 0 && (
        <ul className="ds-list mt-6" aria-label="Case managers with notes waiting">
          {groups.map((g) => {
            // Newest first from the server, so the last is the longest waiting.
            const oldest = g.notes[g.notes.length - 1].serviceDate;
            return (
              <li key={g.key}>
                <Link to={`/notes/review/${g.key}`} className="ds-queue-row">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ds-ink">{g.name}</span>
                    <span className="block text-xs text-ds-muted">
                      {g.key === NO_CASE_MANAGER ? "Clients whose case has closed" : "Case manager"}
                      {" · "}oldest from <DateText value={oldest} />
                    </span>
                  </span>
                  <span className="ds-queue-row__count">
                    <span className="ds-num text-lg font-semibold text-ds-ink">{g.notes.length}</span>
                    <span className="text-xs text-ds-muted">awaiting approval</span>
                  </span>
                  <svg className="ds-queue-row__go" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// One case manager's notes, to approve or return.
export function CaseManagerNotesPage() {
  const { caseManagerId = "" } = useParams<{ caseManagerId: string }>();
  const { notes, error, load } = useQueue();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Kept once known, so the heading still names the person after their
  // last note is approved and the list is empty.
  const [name, setName] = useState<string | null>(null);

  const theirs = useMemo(() => (notes ?? []).filter((n) => keyOf(n) === caseManagerId), [notes, caseManagerId]);
  useEffect(() => {
    if (theirs.length > 0 && !name) setName(theirs[0].caseManagerName ?? NO_CASE_MANAGER_NAME);
  }, [theirs, name]);

  async function act(note: PendingNote, action: "approve" | "return") {
    setActionError(null);
    setNotice(null);
    // The server refuses a return with no reason too, but in words meant
    // for a developer; say here what the reviewer needs to do.
    if (action === "return" && !(reasons[note.id] ?? "").trim()) {
      setActionError(`Say why the note on ${note.firstName} ${note.lastName} is going back, so ${note.authorName} knows what to fix.`);
      document.getElementById(`reason-${note.id}`)?.focus();
      return;
    }
    try {
      await api(`/api/notes/${note.id}/${action}`, {
        method: "POST",
        body: action === "return" ? JSON.stringify({ reviewNote: reasons[note.id] ?? "" }) : undefined,
      });
      // The list is refreshed first, so the message and the note leaving
      // the list arrive together.
      await load();
      setNotice(
        action === "approve"
          ? `Approved the note on ${note.firstName} ${note.lastName}.`
          : `Returned the note on ${note.firstName} ${note.lastName} to ${note.authorName}.`,
      );
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Action failed");
    }
  }

  if (error) return <p className="nmbm-alert nmbm-alert--alert">{error}</p>;
  if (!notes) return <p className="text-sm text-ds-muted">Loading…</p>;

  const heading = name ?? (caseManagerId === NO_CASE_MANAGER ? NO_CASE_MANAGER_NAME : "This case manager");

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/notes/review" className="ds-link text-sm">
        ← All case managers
      </Link>
      <h1 className="ds-display mt-2">{heading}</h1>
      <p className="mt-1 text-sm text-ds-muted">
        {theirs.length === 0
          ? "Nothing waiting for review here."
          : `${plural(theirs.length, "note", "notes")} awaiting approval${
              caseManagerId === NO_CASE_MANAGER ? ", on clients whose case has closed" : ` on ${heading}'s caseload`
            }.`}
      </p>

      {notice && (
        <p className="nmbm-alert nmbm-alert--ok mt-4" role="status">
          {notice}
        </p>
      )}
      {actionError && <p className="nmbm-alert nmbm-alert--alert mt-4">{actionError}</p>}

      {theirs.length === 0 ? (
        <p className="mt-6">
          <Link to="/notes/review" className="nmbm-btn nmbm-btn--secondary nmbm-btn--md">
            Back to all case managers
          </Link>
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {theirs.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              reason={reasons[note.id] ?? ""}
              onReason={(v) => setReasons({ ...reasons, [note.id]: v })}
              onAct={(action) => act(note, action)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteCard({
  note,
  reason,
  onReason,
  onAct,
}: {
  note: PendingNote;
  reason: string;
  onReason: (v: string) => void;
  onAct: (action: "approve" | "return") => void;
}) {
  // The author is said only when it isn't the case manager the page is
  // already about: an intern, or someone covering.
  const byOther = note.authorName !== note.caseManagerName;
  return (
    <li className="nmbm-card nmbm-card--dense">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link to={`/participants/${note.participantId}`} className="ds-person hover:underline">
          {note.firstName} {note.lastName}
        </Link>
        <span className="flex flex-wrap items-center gap-2 text-xs text-ds-muted">
          <Pill tone={note.contactResult === "contacted" ? "ok" : "warn"}>
            {note.contactResult === "contacted" ? "Reached" : "No contact"}
          </Pill>
          {note.clinicalReview && <Pill tone="muted">Clinical</Pill>}
          <span>
            {note.contactResult === "contacted" ? "Contact" : "Attempt"} on <DateText value={note.serviceDate} />
            {byOther && ` · written by ${note.authorName}`}
          </span>
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-ds-secondary">{note.body}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => onAct("approve")} className="nmbm-btn nmbm-btn--dark nmbm-btn--md">
          Approve
        </button>
        <input
          id={`reason-${note.id}`}
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder="Reason for returning"
          aria-label={`Reason for returning the note on ${note.firstName} ${note.lastName}`}
          className="nmbm-control min-w-[14rem] flex-1"
        />
        <button onClick={() => onAct("return")} className="nmbm-btn nmbm-btn--secondary nmbm-btn--md">
          Return
        </button>
      </div>
    </li>
  );
}
