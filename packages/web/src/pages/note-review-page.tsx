import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import type { PendingNote } from "../lib/types.js";
import { Pill } from "../components/flags.js";
import { DateText } from "../components/dates.js";

// U6: "CHW supervisor/Program Manager can either approve CHW notes or
// return them for revision." The permission was granted from the start;
// this is the first screen that can act on it.
//
// Grouped by case manager because that is how a supervisor works the
// queue: one worker's notes at a time, alongside what they know of that
// worker's caseload. A long flat list mixed everybody together.

type Group = { key: string; name: string; notes: PendingNote[] };

const NO_CASE_MANAGER = "none";

function groupByCaseManager(notes: PendingNote[]): Group[] {
  const groups = new Map<string, Group>();
  for (const note of notes) {
    const key = note.caseManagerId ?? NO_CASE_MANAGER;
    const name = note.caseManagerName ?? "No current case manager";
    if (!groups.has(key)) groups.set(key, { key, name, notes: [] });
    groups.get(key)!.notes.push(note);
  }
  // Alphabetical, so a worker is in the same place each visit; closed
  // cases, with nobody to group them under, go last.
  return [...groups.values()].sort((a, b) =>
    a.key === NO_CASE_MANAGER ? 1 : b.key === NO_CASE_MANAGER ? -1 : a.name.localeCompare(b.name),
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Notes on closed cases aren't anybody's caseload, so they're counted apart.
function summary(total: number, groups: Group[]) {
  const caseloads = groups.filter((g) => g.key !== NO_CASE_MANAGER).length;
  const closed = groups.find((g) => g.key === NO_CASE_MANAGER)?.notes.length ?? 0;
  const parts = [caseloads > 0 && `across ${plural(caseloads, "caseload", "caseloads")}`, closed > 0 && `${closed} on closed cases`];
  return `${plural(total, "note", "notes")} ${parts.filter(Boolean).join(", ")}.`;
}

export default function NoteReviewPage() {
  const [notes, setNotes] = useState<PendingNote[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<PendingNote[]>("/api/notes/awaiting-review")
      .then(setNotes)
      .catch(() => setNotes([]));
  }, []);

  useEffect(load, [load]);

  const groups = useMemo(() => groupByCaseManager(notes ?? []), [notes]);

  async function act(id: string, action: "approve" | "return") {
    setError(null);
    try {
      await api(`/api/notes/${id}/${action}`, {
        method: "POST",
        body: action === "return" ? JSON.stringify({ reviewNote: reasons[id] ?? "" }) : undefined,
      });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    }
  }

  if (!notes) return <p className="text-sm text-ds-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="ds-display">Notes awaiting review</h1>
      <p className="mt-1 text-sm text-ds-muted">
        {notes.length === 0 ? "Nothing waiting." : summary(notes.length, groups)}
      </p>

      {groups.length > 1 && (
        <nav aria-label="Case managers" className="mt-4 flex flex-wrap gap-2">
          {groups.map((g) => (
            <a key={g.key} href={`#cm-${g.key}`} className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm">
              {g.name}
              <span className="nmbm-pill nmbm-pill--muted">{g.notes.length}</span>
            </a>
          ))}
        </nav>
      )}

      {error && <p className="nmbm-alert nmbm-alert--alert mt-4">{error}</p>}

      <div className="mt-6 flex flex-col gap-6">
        {groups.map((g) => (
          <details key={g.key} id={`cm-${g.key}`} open className="ds-group scroll-mt-4">
            <summary className="ds-group__head">
              <h2 className="ds-section-heading">{g.name}</h2>
              <span className="text-sm text-ds-muted">{plural(g.notes.length, "note", "notes")}</span>
            </summary>
            <ul className="mt-3 flex flex-col gap-3">
              {g.notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  reason={reasons[note.id] ?? ""}
                  onReason={(v) => setReasons({ ...reasons, [note.id]: v })}
                  onAct={(action) => act(note.id, action)}
                />
              ))}
            </ul>
          </details>
        ))}
      </div>
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
  // The author is said only when it isn't the case manager the group is
  // already named after: an intern, or someone covering.
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
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder="Reason for returning"
          aria-label={`Reason for returning ${note.firstName} ${note.lastName}'s note`}
          className="nmbm-control min-w-[14rem] flex-1"
        />
        <button onClick={() => onAct("return")} className="nmbm-btn nmbm-btn--secondary nmbm-btn--md">
          Return
        </button>
      </div>
    </li>
  );
}
