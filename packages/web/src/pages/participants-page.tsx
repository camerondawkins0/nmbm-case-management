import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api.js";
import type { ClosedParticipantRow, ParticipantRow } from "../lib/types.js";
import { PARTICIPANT_LABEL_PLURAL } from "@nmbm/shared";
import { CarePlanPills, MolinaLetterPill, NoContactPill, ParticipantLink } from "../components/flags.js";
import { CLOSURE_REASON_LABELS, PAYER_LABELS } from "../lib/labels.js";
import { parseSearch, SearchResults, useParticipantSearch } from "../components/participant-search.js";

type View = "active" | "closed";

// U5: the active list is already only the caller's own caseload — the
// server decides that, so there's no "show everyone" toggle to get
// wrong. R10: it is also only people with an open episode. Closed
// records are a separate tab, and the server decides which: all of
// them for intake and supervisors, or a front-line worker's own former
// clients for a limited time.
export default function ParticipantsPage({
  canAdmit,
  seesAllClosed,
}: {
  canAdmit: boolean;
  seesAllClosed: boolean;
}) {
  const location = useLocation();
  // Set by the record page after an episode closes and the record has
  // left the caller's caseload — otherwise they'd land here wondering
  // where the person went.
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;
  const [view, setView] = useState<View>("active");
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [closed, setClosed] = useState<ClosedParticipantRow[] | null>(null);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [searchText, setSearchText] = useState("");
  const searchQuery = parseSearch(searchText);
  const searchResults = useParticipantSearch(searchQuery);

  useEffect(() => {
    api<ParticipantRow[]>("/api/participants").then(setRows).catch(() => setRows([]));
  }, []);

  useEffect(() => {
    if (view !== "closed" || closed) return;
    api<ClosedParticipantRow[]>("/api/participants?status=closed")
      .then(setClosed)
      .catch(() => setClosed([]));
  }, [view, closed]);

  if (!rows) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  const visible = onlyAttention ? rows.filter((r) => r.needsAttention) : rows;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-nmbm-ink">{PARTICIPANT_LABEL_PLURAL}</h1>
        <div className="flex flex-wrap items-center gap-4">
          {canAdmit && (
            <Link
              to="/participants/new"
              className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper"
            >
              New intake
            </Link>
          )}
          {view === "active" && (
            <label className="flex items-center gap-2 text-sm text-nmbm-ink/70">
              <input
                type="checkbox"
                checked={onlyAttention}
                onChange={(e) => setOnlyAttention(e.target.checked)}
              />
              Needs attention only
            </label>
          )}
        </div>
      </div>

      {notice && (
        <p className="mt-4 rounded border border-state-ok/20 bg-state-ok-bg px-3 py-2 text-sm text-state-ok">
          {notice}
        </p>
      )}

      <input
        type="search"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        placeholder="Find by name or date of birth (4/3/1981)"
        aria-label="Find a client by name or date of birth"
        className="mt-4 w-full max-w-md rounded border border-nmbm-ink/20 px-3 py-2 text-sm"
      />

      {searchQuery ? (
        <div className="mt-4">
          {searchResults ? <SearchResults results={searchResults} /> : <p className="text-sm text-nmbm-ink/50">Searching…</p>}
        </div>
      ) : (
      <>
      <div role="tablist" className="mt-4 flex gap-1 border-b border-nmbm-ink/10 text-sm">
        {(["active", "closed"] as View[]).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`-mb-px border-b-2 px-3 py-2 font-medium ${
              view === v
                ? "border-nmbm-gold text-nmbm-ink"
                : "border-transparent text-nmbm-ink/50 hover:text-nmbm-ink"
            }`}
          >
            {v === "active" ? `Active (${rows.length})` : seesAllClosed ? "Closed" : "Recently closed"}
          </button>
        ))}
      </div>

      {view === "active" ? (
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
          {visible.length === 0 && <p className="py-6 text-sm text-nmbm-ink/50">Nothing to show.</p>}
        </div>
      ) : (
        <ClosedTable rows={closed} seesAll={seesAllClosed} />
      )}
      </>
      )}
    </div>
  );
}

function ClosedTable({ rows, seesAll }: { rows: ClosedParticipantRow[] | null; seesAll: boolean }) {
  if (!rows) return <p className="mt-4 text-sm text-nmbm-ink/50">Loading…</p>;
  return (
    <div className="mt-4 overflow-x-auto">
      <p className="mb-3 text-sm text-nmbm-ink/60">
        {seesAll
          ? `Former ${PARTICIPANT_LABEL_PLURAL.toLowerCase()}, most recently closed first. Nothing here counts toward anyone's caseload; open a record to see its history or readmit.`
          : `${PARTICIPANT_LABEL_PLURAL} whose case closed while you were their worker. You can still open their records, read-only, until the date shown.`}
      </p>
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-nmbm-ink/10 text-left text-xs uppercase tracking-wide text-nmbm-ink/50">
            <th className="py-2 pr-4 font-semibold">Name</th>
            <th className="py-2 pr-4 font-semibold">Born</th>
            <th className="py-2 pr-4 font-semibold">Enrolled</th>
            <th className="py-2 pr-4 font-semibold">Closed</th>
            <th className="py-2 pr-4 font-semibold">Reason</th>
            {!seesAll && <th className="py-2 pr-4 font-semibold">Visible until</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-nmbm-ink/5">
              <td className="py-3 pr-4">
                <ParticipantLink id={row.id} firstName={row.firstName} lastName={row.lastName} />
              </td>
              <td className="py-3 pr-4 text-nmbm-ink/70">{row.dateOfBirth}</td>
              <td className="py-3 pr-4 text-nmbm-ink/70">{row.startDate}</td>
              <td className="py-3 pr-4 text-nmbm-ink/70">{row.endDate ?? "—"}</td>
              <td className="py-3 pr-4 text-nmbm-ink/70">
                {row.closureReason ? CLOSURE_REASON_LABELS[row.closureReason] : "—"}
              </td>
              {!seesAll && <td className="py-3 pr-4 text-nmbm-ink/70">{row.accessUntil}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="py-6 text-sm text-nmbm-ink/50">No closed records.</p>}
    </div>
  );
}
