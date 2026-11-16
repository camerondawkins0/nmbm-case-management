import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CS_SERVICE_LABELS, todayInOrg } from "@nmbm/shared";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import type { HousingOverview, Me } from "../lib/types.js";
import { money } from "../components/housing-section.js";

// Housing across the caseload (M24): what's waiting on somebody, for the
// clients the person looking can see. The work itself is done on each
// client's record.
export default function HousingPage({ me }: { me: Me }) {
  const [data, setData] = useState<HousingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<HousingOverview>("/api/housing/overview")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load housing"));
  }, []);

  if (error) return <p className="text-sm text-state-alert">{error}</p>;
  if (!data) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  const person = (p: { participantId: string; firstName: string; lastName: string }) => (
    <Link to={`/participants/${p.participantId}`} className="font-medium text-nmbm-ink hover:underline">
      {p.firstName} {p.lastName}
    </Link>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-nmbm-ink">Housing</h1>
      <p className="mt-1 text-sm text-nmbm-ink/60">
        Community Supports for the clients you can see: what's waiting on somebody, and who's moved in.
        {" "}{data.active.length} active authorization{data.active.length === 1 ? "" : "s"}.
      </p>

      <List title="Authorizations awaiting the plan's decision" empty="None waiting." rows={data.awaitingDecision}>
        {(a) => (
          <>
            {person(a)} · {CS_SERVICE_LABELS[a.service]} <Muted>requested {a.requestedDate}</Muted>
          </>
        )}
      </List>

      <List title={`Ending within ${data.warningDays} days — ask for a renewal`} empty="None ending soon." rows={data.expiring}>
        {(a) => (
          <>
            {person(a)} · {CS_SERVICE_LABELS[a.service]} {a.authorizationNumber && <Muted>{a.authorizationNumber}</Muted>}{" "}
            <Muted>covers to {a.lastCoveredDay}</Muted>
          </>
        )}
      </List>

      <List title="Deposits waiting for approval" empty="None waiting." rows={data.depositsAwaitingDecision}>
        {(d) => (
          <>
            {person(d)} · {money(d.amount)} to {d.payee}
            {d.requestedById === me.id && <Muted> (yours — somebody else approves it)</Muted>}
          </>
        )}
      </List>

      <List title="Approved deposits not yet paid" empty="None waiting." rows={data.depositsAwaitingPayment}>
        {(d) => (
          <>
            {person(d)} · {money(d.amount)} to {d.payee}
          </>
        )}
      </List>

      <List title="Authorized, with no housing situation recorded" empty="Everyone has one." rows={data.noSituation}>
        {(p) => person(p)}
      </List>

      <List title="Moved in during the last 90 days" empty="Nobody yet." rows={data.movedIn}>
        {(t) => (
          <>
            {person(t)} <Muted>moved in {t.moveInDate}</Muted>
          </>
        )}
      </List>

      {can(me, "housing.export") && <ExportPanel />}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-nmbm-ink/50">{children}</span>;
}

function List<T extends { participantId: string }>({
  title,
  empty,
  rows,
  children,
}: {
  title: string;
  empty: string;
  rows: T[];
  children: (row: T) => React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
        {title} <span className="text-nmbm-ink/30">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-nmbm-ink/50">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-nmbm-ink/5 rounded border border-nmbm-ink/10">
          {rows.map((row, i) => (
            <li key={(row as { id?: string }).id ?? `${row.participantId}-${i}`} className="px-3 py-2 text-sm">
              {children(row)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The service log as a spreadsheet, for reporting to ILS. Every download
// is logged with its dates.
function ExportPanel() {
  const today = todayInOrg();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/housing/service-export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? "Could not export");
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `housing-services-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={download} className="mt-8 rounded border border-nmbm-ink/10 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">Service log for reporting</h2>
      <p className="mt-1 text-xs text-nmbm-ink/60">
        A spreadsheet of housing work in a period: client, Medi-Cal CIN, authorization, activity and minutes — not
        the notes. Each download is recorded in the audit log.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-nmbm-ink/70">
          From
          <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-nmbm-ink/20 px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-nmbm-ink/70">
          To
          <input type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} className="rounded border border-nmbm-ink/20 px-2 py-1 text-sm" />
        </label>
        <button disabled={busy} className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-50">
          {busy ? "Preparing…" : "Download CSV"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-state-alert">{error}</p>}
    </form>
  );
}
