import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import type { PendingNote } from "../lib/types.js";
import { Pill } from "../components/flags.js";
import { DateText } from "../components/dates.js";
import { NavIcon } from "../components/nav-icons.js";

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

// One case manager's notes, to approve or return. Each is a single row
// (client, date, outcome, the first line of the note) so a long queue reads
// at a glance; opening one shows it whole, with the decision, in a dialog.
// The reason box only appears once Return is chosen.
export function CaseManagerNotesPage() {
  const { caseManagerId = "" } = useParams<{ caseManagerId: string }>();
  const { notes, error, load } = useQueue();
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Kept once known, so the heading still names the person after their
  // last note is approved and the list is empty.
  const [name, setName] = useState<string | null>(null);

  const theirs = useMemo(() => (notes ?? []).filter((n) => keyOf(n) === caseManagerId), [notes, caseManagerId]);
  useEffect(() => {
    if (theirs.length > 0 && !name) setName(theirs[0].caseManagerName ?? NO_CASE_MANAGER_NAME);
  }, [theirs, name]);

  const index = theirs.findIndex((n) => n.id === openId);
  const open = index >= 0 ? theirs[index] : null;

  // After a decision the dialog moves on to the note that took this one's
  // place, so the queue can be worked without going back to the list;
  // after the last one it closes and says so.
  async function decided(note: PendingNote, message: string) {
    const position = theirs.findIndex((n) => n.id === note.id);
    const remaining = theirs.filter((n) => n.id !== note.id);
    await load();
    setNotice(message);
    const next = remaining[Math.min(position, remaining.length - 1)];
    setOpenId(next ? next.id : null);
  }

  // Moving by hand clears the last decision's message; it was about another note.
  function go(id: string) {
    setNotice(null);
    setOpenId(id);
  }

  if (error) return <p className="nmbm-alert nmbm-alert--alert">{error}</p>;
  if (!notes) return <p className="text-sm text-ds-muted">Loading…</p>;

  const heading = name ?? (caseManagerId === NO_CASE_MANAGER ? NO_CASE_MANAGER_NAME : "This case manager");

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/notes/review" className="ds-link text-sm">
        ← All case managers
      </Link>
      <h1 className="ds-display mt-2">{heading}</h1>
      <p className="mt-1 text-sm text-ds-muted">
        {theirs.length === 0
          ? "Nothing waiting for review here."
          : `${plural(theirs.length, "note", "notes")} awaiting approval${
              caseManagerId === NO_CASE_MANAGER ? ", on clients whose case has closed" : ` on ${heading}'s caseload`
            }. Open one to approve it or send it back.`}
      </p>

      {notice && !open && (
        <p className="nmbm-alert nmbm-alert--ok mt-4" role="status">
          {notice}
        </p>
      )}

      {theirs.length === 0 ? (
        <p className="mt-6">
          <Link to="/notes/review" className="nmbm-btn nmbm-btn--secondary nmbm-btn--md">
            Back to all case managers
          </Link>
        </p>
      ) : (
        <ul className="ds-list mt-6" aria-label={`Notes awaiting approval on ${heading}'s caseload`}>
          {theirs.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className="ds-note-row"
                data-note={note.id}
                onClick={() => {
                  setNotice(null);
                  setOpenId(note.id);
                }}
                aria-haspopup="dialog"
              >
                <span className="ds-note-row__who ds-person">
                  {note.firstName} {note.lastName}
                </span>
                <span className="ds-note-row__date text-xs text-ds-muted">
                  <DateText value={note.serviceDate} />
                </span>
                <span className="ds-note-row__result">
                  <Pill tone={note.contactResult === "contacted" ? "ok" : "warn"}>
                    {note.contactResult === "contacted" ? "Reached" : "No contact"}
                  </Pill>
                </span>
                <span className="ds-note-row__preview text-sm text-ds-secondary">{note.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <NoteDialog
          key={open.id}
          note={open}
          position={index + 1}
          total={theirs.length}
          notice={notice}
          onPrevious={index > 0 ? () => go(theirs[index - 1].id) : null}
          onNext={index < theirs.length - 1 ? () => go(theirs[index + 1].id) : null}
          onClose={() => {
            // Back to the row of the note that was open, or the one now in
            // its place: the dialog is rebuilt per note, so the browser's own
            // "return focus" would point at a button that no longer exists.
            const at = index;
            setNotice(null);
            setOpenId(null);
            requestAnimationFrame(() => {
              const list = [...document.querySelectorAll<HTMLButtonElement>(".ds-note-row")];
              (list.find((r) => r.dataset.note === open.id) ?? list[Math.min(at, list.length - 1)])?.focus();
            });
          }}
          onDecided={decided}
        />
      )}
    </div>
  );
}

// The note, whole, and the decision on it. A native modal dialog, so focus
// stays inside it, Escape closes it, and the page behind can't be clicked.
function NoteDialog({
  note,
  position,
  total,
  notice,
  onPrevious,
  onNext,
  onClose,
  onDecided,
}: {
  note: PendingNote;
  position: number;
  total: number;
  notice: string | null;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
  onDecided: (note: PendingNote, message: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reasonBox = useRef<HTMLTextAreaElement>(null);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The author is said only when it isn't the case manager the page is
  // already about: an intern, or someone covering.
  const byOther = note.authorName !== note.caseManagerName;
  const client = `${note.firstName} ${note.lastName}`;

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    if (returning) reasonBox.current?.focus();
  }, [returning]);

  async function send(action: "approve" | "return") {
    setProblem(null);
    // The server refuses a return with no reason too, but in words meant for
    // a developer; say here what the reviewer needs to do.
    if (action === "return" && !reason.trim()) {
      setProblem(`Say why it's going back, so ${note.authorName} knows what to fix.`);
      reasonBox.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await api(`/api/notes/${note.id}/${action}`, {
        method: "POST",
        body: action === "return" ? JSON.stringify({ reviewNote: reason.trim() }) : undefined,
      });
      await onDecided(
        note,
        action === "approve"
          ? `Approved the note on ${client}.`
          : `Returned the note on ${client} to ${note.authorName}.`,
      );
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "That didn't go through. Nothing was changed.");
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="ds-dialog"
      aria-labelledby="note-dialog-title"
      onClose={onClose}
      // A click on the backdrop (the dialog element itself, outside its box) closes it.
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="ds-dialog__box">
        <div className="ds-dialog__head">
          <div className="min-w-0">
            <p className="text-xs text-ds-muted">
              Note <span className="ds-num">{position}</span> of <span className="ds-num">{total}</span>
            </p>
            <h2 id="note-dialog-title" className="ds-person text-lg">
              <Link to={`/participants/${note.participantId}`} className="hover:underline">
                {client}
              </Link>
            </h2>
          </div>
          <button type="button" className="ds-side__button" onClick={() => dialog.current?.close()}>
            <NavIcon name="close" />
            <span className="nmbm-sr">Close</span>
          </button>
        </div>

        {notice && (
          <p className="nmbm-alert nmbm-alert--ok mt-3" role="status">
            {notice}
          </p>
        )}

        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ds-muted">
          <Pill tone={note.contactResult === "contacted" ? "ok" : "warn"}>
            {note.contactResult === "contacted" ? "Reached" : "No contact"}
          </Pill>
          {note.clinicalReview && <Pill tone="muted">Clinical</Pill>}
          <span>
            {note.contactResult === "contacted" ? "Contact" : "Attempt"} on <DateText value={note.serviceDate} />
            {byOther && ` · written by ${note.authorName}`}
          </span>
        </p>
        <p className="ds-dialog__body mt-3 whitespace-pre-wrap text-sm text-ds-ink">{note.body}</p>

        {returning && (
          <label className="ds-field mt-4">
            Why it's going back
            <textarea
              ref={reasonBox}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              aria-invalid={problem ? true : undefined}
              placeholder={`What ${note.authorName} should add or change`}
              className="nmbm-control"
            />
          </label>
        )}
        {problem && (
          <p className="mt-2 text-sm text-state-alert" role="alert">
            {problem}
          </p>
        )}

        <div className="ds-dialog__foot">
          <div className="flex gap-2">
            <button type="button" disabled={!onPrevious || busy} onClick={onPrevious ?? undefined} className="nmbm-btn nmbm-btn--quiet nmbm-btn--sm">
              ← Previous
            </button>
            <button type="button" disabled={!onNext || busy} onClick={onNext ?? undefined} className="nmbm-btn nmbm-btn--quiet nmbm-btn--sm">
              Next →
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {returning ? (
              <>
                <button type="button" disabled={busy} onClick={() => setReturning(false)} className="nmbm-btn nmbm-btn--quiet nmbm-btn--md">
                  Cancel
                </button>
                <button type="button" disabled={busy} onClick={() => send("return")} className="nmbm-btn nmbm-btn--dark nmbm-btn--md">
                  {busy ? "Sending…" : `Send back to ${note.authorName}`}
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => setReturning(true)} className="nmbm-btn nmbm-btn--secondary nmbm-btn--md">
                  Return for revision
                </button>
                <button type="button" disabled={busy} onClick={() => send("approve")} className="nmbm-btn nmbm-btn--dark nmbm-btn--md">
                  {busy ? "Approving…" : "Approve"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
