import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import type { PendingNote } from "../lib/types.js";
import { Pill } from "../components/flags.js";
import { DateText } from "../components/dates.js";

// U6: "CHW supervisor/Program Manager can either approve CHW notes or
// return them for revision." The permission was granted from the start;
// this is the first screen that can act on it.
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
        {notes.length === 0 ? "Nothing waiting." : `${notes.length} waiting for a decision.`}
      </p>

      {error && (
        <p className="nmbm-alert nmbm-alert--alert mt-4">
          {error}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {notes.map((note) => (
          <li key={note.id} className="nmbm-card nmbm-card--dense">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                to={`/participants/${note.participantId}`}
                className="ds-person hover:underline"
              >
                {note.firstName} {note.lastName}
              </Link>
              <span className="flex items-center gap-2 text-xs text-ds-muted">
                <Pill tone={note.contactResult === "contacted" ? "ok" : "warn"}>
                  {note.contactResult === "contacted" ? "Reached" : "No contact"}
                </Pill>
                {note.clinicalReview && <Pill tone="muted">Clinical</Pill>}
                {note.authorName} · {note.contactResult === "contacted" ? "contact" : "attempt"} on <DateText value={note.serviceDate} />
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ds-secondary">{note.body}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => act(note.id, "approve")}
                className="nmbm-btn nmbm-btn--dark nmbm-btn--md"
              >
                Approve
              </button>
              <input
                value={reasons[note.id] ?? ""}
                onChange={(e) => setReasons({ ...reasons, [note.id]: e.target.value })}
                placeholder="Reason for returning"
                className="nmbm-control min-w-[14rem] flex-1"
              />
              <button
                onClick={() => act(note.id, "return")}
                className="nmbm-btn nmbm-btn--secondary nmbm-btn--md"
              >
                Return
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
