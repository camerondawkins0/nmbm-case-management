import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import type { AssignableWorker, Me, ProgramSummary } from "../lib/types.js";
import { Pill } from "../components/flags.js";

const inputClass = "rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm";

const STATUS_TONE = { running: "ok", planned: "warn", completed: "muted", canceled: "muted" } as const;

// M14. NMBM run Anger Management now; Domestic Violence waits on LA
// County. A cohort is one run of a program, so the same class twice a
// year keeps its rosters apart.
export default function ProgramsPage({ me }: { me: Me }) {
  const manage = can(me, "programs.manage");
  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);
  const [workers, setWorkers] = useState<AssignableWorker[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cohortFor, setCohortFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ProgramSummary[]>("/api/programs").then(setPrograms).catch(() => setPrograms([]));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!manage) return;
    api<AssignableWorker[]>("/api/participants/assignable-workers")
      .then(setWorkers)
      .catch(() => setWorkers([]));
  }, [manage]);

  async function run(fn: () => Promise<unknown>, message: string) {
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
  }

  if (!programs) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-nmbm-ink">Programs</h1>
        {manage && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper"
          >
            New program
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-nmbm-ink/60">
        Attendance here is evidence someone outside NMBM relies on — every mark records who took
        it and when.
      </p>

      {notice && (
        <p className="mt-4 rounded border border-state-ok/20 bg-state-ok-bg px-3 py-2 text-sm text-state-ok">{notice}</p>
      )}
      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      {adding && (
        <form
          className="mt-4 flex flex-col gap-3 rounded border border-nmbm-ink/15 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                api("/api/programs", {
                  method: "POST",
                  body: JSON.stringify({ name, description: description.trim() || undefined }),
                }),
              `${name} added. Add its first cohort below.`,
            ).then((ok) => {
              if (!ok) return;
              setAdding(false);
              setName("");
              setDescription("");
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Parenting Skills" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Description (optional)
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
          </label>
          <div className="flex gap-2">
            <button className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper">Save</button>
            <button type="button" onClick={() => setAdding(false)} className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {programs.length === 0 && !adding && <p className="mt-6 text-sm text-nmbm-ink/60">No programs yet.</p>}

      <ul className="mt-6 flex flex-col gap-4">
        {programs.map((program) => (
          <li key={program.id} className="rounded border border-nmbm-ink/10 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-nmbm-ink">{program.name}</span>
              {!program.active && <Pill tone="muted">Inactive</Pill>}
            </div>
            {program.description && <p className="mt-1 text-sm text-nmbm-ink/60">{program.description}</p>}

            {program.cohorts.length === 0 ? (
              <p className="mt-3 text-sm text-nmbm-ink/50">No cohorts yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {program.cohorts.map((cohort) => (
                  <li
                    key={cohort.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-nmbm-ink/10 px-3 py-2 text-sm"
                  >
                    <span>
                      <Link
                        to={`/cohorts/${cohort.id}`}
                        className={`font-medium hover:underline ${cohort.status === "running" ? "text-nmbm-ink" : "text-nmbm-ink/60"}`}
                      >
                        {cohort.name}
                      </Link>
                      <span className="block text-xs text-nmbm-ink/50">
                        from {cohort.startDate}
                        {cohort.endDate && ` to ${cohort.endDate}`}
                        {cohort.facilitatorName && ` · ${cohort.facilitatorName}`}
                        {cohort.requiredSessions && ` · ${cohort.requiredSessions} sessions to complete`}
                      </span>
                    </span>
                    <Pill tone={STATUS_TONE[cohort.status]}>{cohort.status}</Pill>
                  </li>
                ))}
              </ul>
            )}

            {manage &&
              (cohortFor === program.id ? (
                <CohortForm
                  programId={program.id}
                  workers={workers}
                  onCancel={() => setCohortFor(null)}
                  onSave={(body) =>
                    run(
                      () => api("/api/cohorts", { method: "POST", body: JSON.stringify(body) }),
                      `Cohort added to ${program.name}. Open it to add class dates and people.`,
                    ).then((ok) => ok && setCohortFor(null))
                  }
                />
              ) : (
                <button
                  onClick={() => setCohortFor(program.id)}
                  className="mt-3 text-sm text-nmbm-ink/60 underline underline-offset-2 hover:text-nmbm-ink"
                >
                  Add a cohort
                </button>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CohortForm({
  programId,
  workers,
  onSave,
  onCancel,
}: {
  programId: string;
  workers: AssignableWorker[];
  onSave: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    facilitatorId: "",
    requiredSessions: "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <form
      className="mt-3 grid gap-3 rounded border border-nmbm-ink/15 p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          programId,
          name: form.name,
          startDate: form.startDate,
          endDate: form.endDate || undefined,
          facilitatorId: form.facilitatorId || undefined,
          requiredSessions: form.requiredSessions ? Number(form.requiredSessions) : undefined,
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Cohort name
        <input required value={form.name} onChange={set("name")} placeholder="e.g. Spring 2027, Tuesday evenings" className={inputClass} />
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
        Facilitator (optional)
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
        Sessions needed to complete (optional)
        <input type="number" min={1} value={form.requiredSessions} onChange={set("requiredSessions")} className={inputClass} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper">Add cohort</button>
        <button type="button" onClick={onCancel} className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
