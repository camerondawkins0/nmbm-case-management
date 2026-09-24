import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import type { PendingNote } from "../lib/types.js";
import { Pill } from "../components/flags.js";

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

  if (!notes) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-nmbm-ink">Notes awaiting review</h1>
      <p className="mt-1 text-sm text-nmbm-ink/60">
        {notes.length === 0 ? "Nothing waiting." : `${notes.length} waiting for a decision.`}
      </p>

      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {notes.map((note) => (
          <li key={note.id} className="rounded border border-nmbm-ink/10 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                to={`/participants/${note.participantId}`}
                className="font-medium text-nmbm-ink hover:underline"
              >
                {note.firstName} {note.lastName}
              </Link>
              <span className="flex items-center gap-2 text-xs text-nmbm-ink/50">
                <Pill tone={note.contactResult === "contacted" ? "ok" : "warn"}>
                  {note.contactResult === "contacted" ? "Reached" : "No contact"}
                </Pill>
                {note.authorName} · {new Date(note.createdAt).toLocaleDateString()}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-nmbm-ink/80">{note.body}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => act(note.id, "approve")}
                className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper hover:bg-nmbm-ink/85"
              >
                Approve
              </button>
              <input
                value={reasons[note.id] ?? ""}
                onChange={(e) => setReasons({ ...reasons, [note.id]: e.target.value })}
                placeholder="Reason for returning"
                className="min-w-[14rem] flex-1 rounded border border-nmbm-ink/20 px-3 py-1.5 text-sm"
              />
              <button
                onClick={() => act(note.id, "return")}
                className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm font-medium text-nmbm-ink hover:bg-nmbm-ink/5"
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
