import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { ParticipantRow } from "../lib/types.js";
import { PARTICIPANT_LABEL_PLURAL } from "@nmbm/shared";
import { CarePlanPills, MolinaLetterPill, NoContactPill, ParticipantLink } from "../components/flags.js";

const PAYER_LABELS: Record<string, string> = {
  medicare: "Medicare",
  medi_cal: "Medi-Cal",
  molina: "Molina",
  kaiser: "Kaiser",
  blue_shield: "Blue Shield",
  la_health_net: "LA Health Net",
  self_pay: "Self-pay",
};

// U5: this is already only the caller's own caseload — the server
// decides that, so there's no "show everyone" toggle to get wrong.
export default function ParticipantsPage() {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [onlyAttention, setOnlyAttention] = useState(false);

  useEffect(() => {
    api<ParticipantRow[]>("/api/participants").then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  const visible = onlyAttention ? rows.filter((r) => r.needsAttention) : rows;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-nmbm-ink">{PARTICIPANT_LABEL_PLURAL}</h1>
        <label className="flex items-center gap-2 text-sm text-nmbm-ink/70">
          <input
            type="checkbox"
            checked={onlyAttention}
            onChange={(e) => setOnlyAttention(e.target.checked)}
          />
          Needs attention only
        </label>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-nmbm-ink/10 text-left text-xs uppercase tracking-wide text-nmbm-ink/50">
              <th className="py-2 pr-4 font-semibold">Name</th>
              <th className="py-2 pr-4 font-semibold">Plan</th>
              <th className="py-2 pr-4 font-semibold">Enrolled</th>
              <th className="py-2 pr-4 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-b border-nmbm-ink/5">
                <td className="py-3 pr-4">
                  <ParticipantLink id={row.id} firstName={row.firstName} lastName={row.lastName} />
                </td>
                <td className="py-3 pr-4 text-nmbm-ink/70">
                  {row.payer ? (PAYER_LABELS[row.payer] ?? row.payer) : "—"}
                </td>
                <td className="py-3 pr-4 text-nmbm-ink/70">{row.startDate ?? "—"}</td>
                <td className="py-3 pr-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MolinaLetterPill flags={row.flags.noContact} />
                    <NoContactPill flags={row.flags.noContact} />
                    <CarePlanPills flags={row.flags.carePlan} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="py-6 text-sm text-nmbm-ink/50">Nothing to show.</p>
        )}
      </div>
    </div>
  );
}
