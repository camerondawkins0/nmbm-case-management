import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { AssignableWorker, CohortDetail } from "../lib/types.js";
import { useParticipantSearch, parseSearch } from "./participant-search.js";

const inputClass = "rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm";

type Act = (fn: () => Promise<unknown>, message: string) => Promise<boolean>;

// What can happen to a cohort next, as buttons. The server holds the
// same table (COHORT_STATUS_CHANGES) and refuses anything else.
const NEXT: Record<string, { status: "running" | "completed" | "canceled"; label: string; confirm: string; done: string }[]> = {
  planned: [
    { status: "running", label: "Start this cohort", confirm: "Start this cohort?", done: "Cohort started." },
    { status: "canceled", label: "Cancel it", confirm: "Cancel this cohort? A canceled cohort can't be reopened.", done: "Cohort canceled." },
  ],
  running: [
    {
      status: "completed",
      label: "Mark completed",
      confirm: "Mark this cohort completed? It stops taking new people and class dates, and can be reopened if this was too early.",
      done: "Cohort marked completed.",
    },
    {
      status: "canceled",
      label: "Cancel it",
      confirm: "Cancel this cohort? Attendance already recorded is kept, but a canceled cohort can't be reopened.",
      done: "Cohort canceled.",
    },
  ],
  completed: [{ status: "running", label: "Reopen", confirm: "Reopen this cohort?", done: "Cohort reopened." }],
  canceled: [],
};

export function CohortStatusActions({ cohort, act }: { cohort: CohortDetail["cohort"]; act: Act }) {
  const options = NEXT[cohort.status] ?? [];
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.status}
          onClick={() => {
            if (!window.confirm(o.confirm)) return;
            act(
              () => api(`/api/cohorts/${cohort.id}/status`, { method: "POST", body: JSON.stringify({ status: o.status }) }),
              o.done,
            );
          }}
          className={`rounded px-3 py-1.5 text-sm ${
            o.status === "canceled"
              ? "border border-nmbm-ink/20 text-nmbm-ink/60 hover:text-state-alert"
              : "border border-nmbm-ink/30 text-nmbm-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AddClassDate({ cohortId, act }: { cohortId: string; act: Act }) {
  const [date, setDate] = useState("");
  const [topic, setTopic] = useState("");
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        act(
          () =>
            api(`/api/cohorts/${cohortId}/sessions`, {
              method: "POST",
              body: JSON.stringify({ sessionDate: date, topic: topic.trim() || undefined }),
            }),
          `Class on ${date} added.`,
        ).then((ok) => {
          if (!ok) return;
          setDate("");
          setTopic("");
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Date
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-1 flex-col gap-1 text-sm">
        Topic (optional)
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Recognizing triggers" className={inputClass} />
      </label>
      <button className="rounded border border-nmbm-ink/30 px-3 py-1.5 text-sm">Add class date</button>
    </form>
  );
}

// Finding somebody to put on the roster uses the same search as the
// rest of the app, so it only ever offers records the person enrolling
// is allowed to open.
export function EnrollPanel({ cohortId, rosterIds, act }: { cohortId: string; rosterIds: Set<string>; act: Act }) {
  const [text, setText] = useState("");
  const results = useParticipantSearch(parseSearch(text));
  return (
    <div className="mt-3">
      <label className="flex flex-col gap-1 text-sm">
        Find a client by name or date of birth
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Rivera or 4/3/1981" className={inputClass} />
      </label>
      {text.trim().length >= 2 && !results && <p className="mt-2 text-sm text-nmbm-ink/50">Searching…</p>}
      {results && (
        <ul className="mt-2 divide-y divide-nmbm-ink/5 rounded border border-nmbm-ink/10">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-nmbm-ink/50">No matching records you can open.</li>}
          {results.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">
                  {r.firstName} {r.lastName}
                </span>
                <span className="ml-2 text-xs text-nmbm-ink/50">
                  born {r.dateOfBirth}
                  {!r.active && " · services ended"}
                </span>
              </span>
              {rosterIds.has(r.id) ? (
                <span className="text-xs text-nmbm-ink/50">On the roster</span>
              ) : (
                <button
                  onClick={() =>
                    act(
                      () =>
                        api(`/api/cohorts/${cohortId}/enrollments`, {
                          method: "POST",
                          body: JSON.stringify({ participantId: r.id }),
                        }),
                      `${r.firstName} ${r.lastName} added to the roster.`,
                    )
                  }
                  className="rounded border border-nmbm-ink/30 px-3 py-1 text-xs"
                >
                  Add to roster
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WithdrawButton({ enrollmentId, name, act }: { enrollmentId: string; name: string; act: Act }) {
  return (
    <button
      onClick={() => {
        const reason = window.prompt(`Why is ${name} leaving this cohort? Their attendance so far is kept.`);
        if (!reason) return;
        act(
          () => api(`/api/enrollments/${enrollmentId}/withdraw`, { method: "POST", body: JSON.stringify({ reason }) }),
          `${name} withdrawn.`,
        );
      }}
      className="ml-2 rounded border border-nmbm-ink/20 px-2 py-0.5 text-xs text-nmbm-ink/60 hover:border-state-alert hover:text-state-alert"
    >
      Withdraw…
    </button>
  );
}


// A cohort's own details, after it's made. The number of classes is
// this cohort's, starting from the program's default; blank means no
// set requirement, and the record then reports attendance without a
// verdict.
export function CohortDetailsForm({
  cohort,
  act,
  onDone,
}: {
  cohort: CohortDetail["cohort"];
  act: Act;
  onDone: () => void;
}) {
  const [workers, setWorkers] = useState<AssignableWorker[]>([]);
  const [form, setForm] = useState({
    name: cohort.name,
    startDate: cohort.startDate,
    endDate: cohort.endDate ?? "",
    facilitatorId: cohort.facilitatorId ?? "",
    requiredSessions: cohort.requiredSessions ? String(cohort.requiredSessions) : "",
  });
  useEffect(() => {
    api<AssignableWorker[]>("/api/participants/assignable-workers?for=facilitator").then(setWorkers).catch(() => setWorkers([]));
  }, []);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <form
      className="mt-4 grid gap-3 rounded border border-nmbm-ink/15 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        act(
          () =>
            api(`/api/cohorts/${cohort.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                name: form.name.trim(),
                startDate: form.startDate,
                endDate: form.endDate || null,
                facilitatorId: form.facilitatorId || null,
                requiredSessions: form.requiredSessions ? Number(form.requiredSessions) : null,
              }),
            }),
          "Cohort details saved.",
        ).then((ok) => ok && onDone());
      }}
    >
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Cohort name
        <input required value={form.name} onChange={set("name")} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Starts
        <input type="date" required value={form.startDate} onChange={set("startDate")} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Ends (optional)
        <input type="date" value={form.endDate} min={form.startDate} onChange={set("endDate")} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Facilitator
        <select value={form.facilitatorId} onChange={set("facilitatorId")} className={inputClass}>
          <option value="">Not set</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Classes needed to complete
        <input type="number" min={1} value={form.requiredSessions} onChange={set("requiredSessions")} placeholder="none set" className={inputClass} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper">Save</button>
        <button type="button" onClick={onDone} className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
