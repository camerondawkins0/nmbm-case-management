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
  const [editing, setEditing] = useState<string | null>(null);
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
        <ProgramForm
          submitLabel="Save"
          onCancel={() => setAdding(false)}
          onSave={(body) =>
            run(
              () => api("/api/programs", { method: "POST", body: JSON.stringify(body) }),
              `${body.name} added. Add its first cohort below.`,
            ).then((ok) => ok && setAdding(false))
          }
        />
      )}

      {programs.length === 0 && !adding && <p className="mt-6 text-sm text-nmbm-ink/60">No programs yet.</p>}

      <ul className="mt-6 flex flex-col gap-4">
        {programs.map((program) => (
          <li key={program.id} className="rounded border border-nmbm-ink/10 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-nmbm-ink">{program.name}</span>
              {!program.active && <Pill tone="muted">Retired</Pill>}
            </div>
            {program.description && <p className="mt-1 text-sm text-nmbm-ink/60">{program.description}</p>}
            <p className="mt-1 text-xs text-nmbm-ink/60">{ruleSummary(program)}</p>
            {manage && editing !== program.id && (
              <button
                onClick={() => setEditing(program.id)}
                className="mt-1 text-xs text-nmbm-ink/60 underline underline-offset-2 hover:text-nmbm-ink"
              >
                Edit program and completion rules
              </button>
            )}
            {editing === program.id && (
              <ProgramForm
                program={program}
                submitLabel="Save changes"
                onCancel={() => setEditing(null)}
                onSave={(body) =>
                  run(
                    () => api(`/api/programs/${program.id}`, { method: "PATCH", body: JSON.stringify(body) }),
                    `${body.name} saved.`,
                  ).then((ok) => ok && setEditing(null))
                }
              />
            )}

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
              program.active &&
              (cohortFor === program.id ? (
                <CohortForm
                  programId={program.id}
                  defaultSessions={program.defaultRequiredSessions}
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
  defaultSessions,
  workers,
  onSave,
  onCancel,
}: {
  programId: string;
  defaultSessions: number | null;
  workers: AssignableWorker[];
  onSave: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    facilitatorId: "",
    requiredSessions: defaultSessions ? String(defaultSessions) : "",
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

type ProgramRow = ProgramSummary;

// The program's completion rule, as a sentence: the thing NMBM decide.
function ruleSummary(p: Pick<ProgramRow, "defaultRequiredSessions" | "lateCounts" | "excusedCounts">) {
  const counted = ["present", p.lateCounts && "late", p.excusedCounts && "excused"].filter(Boolean).join(", ");
  const sessions = p.defaultRequiredSessions
    ? `New cohorts need ${p.defaultRequiredSessions} classes to complete`
    : "No set number of classes to complete";
  return `${sessions} · counted as attending: ${counted}.`;
}

function ProgramForm({
  program,
  submitLabel,
  onSave,
  onCancel,
}: {
  program?: ProgramRow;
  submitLabel: string;
  onSave: (body: {
    name: string;
    description?: string | null;
    defaultRequiredSessions: number | null;
    lateCounts: boolean;
    excusedCounts: boolean;
    active?: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: program?.name ?? "",
    description: program?.description ?? "",
    defaultRequiredSessions: program?.defaultRequiredSessions ? String(program.defaultRequiredSessions) : "",
    lateCounts: program?.lateCounts ?? true,
    excusedCounts: program?.excusedCounts ?? false,
    active: program?.active ?? true,
  });
  return (
    <form
      className="mt-3 grid gap-3 rounded border border-nmbm-ink/15 p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: form.name.trim(),
          // A new program sends no description rather than an empty one.
          description: program ? form.description.trim() || null : form.description.trim() || undefined,
          defaultRequiredSessions: form.defaultRequiredSessions ? Number(form.defaultRequiredSessions) : null,
          lateCounts: form.lateCounts,
          excusedCounts: form.excusedCounts,
          ...(program ? { active: form.active } : {}),
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Parenting Skills" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Description (optional)
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
      </label>
      <fieldset className="flex flex-col gap-2 text-sm sm:col-span-2">
        <legend className="mb-1 font-medium">What completing it takes</legend>
        <label className="flex flex-wrap items-center gap-2">
          Classes needed to complete
          <input
            type="number"
            min={1}
            value={form.defaultRequiredSessions}
            onChange={(e) => setForm({ ...form, defaultRequiredSessions: e.target.value })}
            placeholder="none set"
            className={`${inputClass} w-28`}
          />
          <span className="text-xs text-nmbm-ink/50">The starting number for new cohorts; each cohort can change its own.</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.lateCounts} onChange={(e) => setForm({ ...form, lateCounts: e.target.checked })} />
          A late arrival counts as attending
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.excusedCounts} onChange={(e) => setForm({ ...form, excusedCounts: e.target.checked })} />
          An excused absence counts as attending
        </label>
        <p className="text-xs text-nmbm-ink/50">
          Present always counts and an unexcused absence never does. Changing these recounts every
          enrollment in the program, past ones included, and the change is logged.
        </p>
      </fieldset>
      {program && (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Still offered (a retired program keeps its cohorts and records but takes no new cohorts)
        </label>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper">{submitLabel}</button>
        <button type="button" onClick={onCancel} className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
