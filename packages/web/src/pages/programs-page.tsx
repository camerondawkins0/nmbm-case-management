import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { ProgramSummary } from "../lib/types.js";
import { Pill } from "../components/flags.js";

// M14. NMBM run Anger Management now; Domestic Violence waits on LA
// County. A cohort is one run of a programme, so the same class twice a
// year keeps its rosters apart.
export default function ProgramsPage() {
  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);

  useEffect(() => {
    api<ProgramSummary[]>("/api/programs").then(setPrograms).catch(() => setPrograms([]));
  }, []);

  if (!programs) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-nmbm-ink">Programmes</h1>
      <p className="mt-1 text-sm text-nmbm-ink/60">
        Attendance here is evidence someone outside NMBM relies on — every mark records who took
        it and when.
      </p>

      <ul className="mt-6 flex flex-col gap-4">
        {programs.map((program) => (
          <li key={program.id} className="rounded border border-nmbm-ink/10 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-nmbm-ink">{program.name}</span>
              {!program.active && <Pill tone="muted">Inactive</Pill>}
            </div>
            {program.description && (
              <p className="mt-1 text-sm text-nmbm-ink/60">{program.description}</p>
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
                      {cohort.status === "planned" ? (
                        <span className="text-nmbm-ink/60">{cohort.name}</span>
                      ) : (
                        <Link
                          to={`/cohorts/${cohort.id}`}
                          className="font-medium text-nmbm-ink hover:underline"
                        >
                          {cohort.name}
                        </Link>
                      )}
                      <span className="block text-xs text-nmbm-ink/50">
                        from {cohort.startDate}
                        {cohort.facilitatorName && ` · ${cohort.facilitatorName}`}
                        {cohort.requiredSessions &&
                          ` · ${cohort.requiredSessions} sessions to complete`}
                      </span>
                    </span>
                    <Pill
                      tone={
                        cohort.status === "running"
                          ? "ok"
                          : cohort.status === "planned"
                            ? "warn"
                            : "muted"
                      }
                    >
                      {cohort.status}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
