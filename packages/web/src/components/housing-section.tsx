import { useCallback, useEffect, useState } from "react";
import {
  CS_SERVICE_LABELS,
  CS_SERVICES,
  CS_TIME_SERVICES,
  CS_UNIT_LABELS,
  CS_UNIT_TYPES,
  DEPOSIT_PURPOSE_LABELS,
  DEPOSIT_PURPOSES,
  HOUSING_ACTIVITIES,
  HOUSING_ACTIVITY_LABELS,
  HOUSING_SITUATION_LABELS,
  HOUSING_SITUATIONS,
  SERVICE_CONTACT_METHOD_LABELS,
  SERVICE_CONTACT_METHODS,
  SUBSIDY_LABELS,
  SUBSIDY_TYPES,
  todayInOrg,
  type CsService,
} from "@nmbm/shared";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import type { CsAuthorizationRow, DepositRow, HousingRecord, Me, ParticipantDetail } from "../lib/types.js";
import { PAYER_OPTIONS } from "../lib/labels.js";
import { Pill } from "./flags.js";
import { DateText, Timestamp } from "./dates.js";

// Dollars from a string, for display only: "1250.5" -> "$1,250.50".
// Never added up here; the server sums money as numerics.
export function money(amount: string | null | undefined) {
  if (!amount) return "";
  const [whole, cents = ""] = amount.split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents.padEnd(2, "0")}`;
}

const STATE_PILL: Record<CsAuthorizationRow["state"], { tone: "ok" | "warn" | "alert" | "muted"; label: string }> = {
  requested: { tone: "warn", label: "awaiting decision" },
  upcoming: { tone: "muted", label: "not started" },
  active: { tone: "ok", label: "active" },
  expiring: { tone: "warn", label: "ending soon" },
  expired: { tone: "muted", label: "expired" },
  ended: { tone: "muted", label: "ended" },
  denied: { tone: "alert", label: "denied" },
  void: { tone: "muted", label: "void" },
};

const field = "nmbm-control";
const label = "ds-field";
const h3 = "text-xs font-semibold uppercase tracking-wide text-ds-muted";
const small = "nmbm-btn nmbm-btn--secondary nmbm-btn--sm";
const primary = "nmbm-btn nmbm-btn--dark nmbm-btn--sm";

// Housing Community Supports on the record (M24): where they're living,
// what the plan authorized, the work logged against it, their home, and
// deposits. Every button here is also checked on the server.
export function HousingSection({
  record,
  me,
  onChanged,
  onError,
}: {
  record: ParticipantDetail;
  me: Me;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [data, setData] = useState<HousingRecord | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<HousingRecord>(`/api/participants/${record.id}/housing`)
      .then(setData)
      .catch(() => setData(null));
  }, [record.id]);
  useEffect(load, [load]);

  if (!data) return null;
  const isOpen = record.episodeStatus === "open";
  const writes = can(me, "housing.write") && record.canWrite;
  const authorizes = can(me, "housing.authorizations") && record.canWrite;
  const approves = can(me, "housing.deposits.approve") && record.canWrite;

  async function send(url: string, body: unknown, message: string) {
    setBusy(true);
    try {
      await api(url, { method: "POST", body: JSON.stringify(body) });
      setOpen(null);
      onChanged(message);
      load();
      return true;
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function voidRow(url: string, what: string) {
    const reason = window.prompt(`Why is this ${what} being voided? It stays on the record, marked void.`);
    if (reason?.trim()) void send(url, { reason }, `${what[0].toUpperCase()}${what.slice(1)} voided.`);
  }

  const live = data.authorizations.filter((a) => a.state !== "void");
  const usable = (service: "time" | "deposits") =>
    live.filter(
      (a) =>
        (a.state === "active" || a.state === "expiring") &&
        (service === "deposits" ? a.service === "housing_deposits" : CS_TIME_SERVICES.includes(a.service)),
    );
  const current = data.tenancies.find((t) => !t.voidedAt && !t.moveOutDate);
  const nameOf = (id: string) => {
    const a = data.authorizations.find((x) => x.id === id);
    return a ? `${CS_SERVICE_LABELS[a.service]}${a.authorizationNumber ? ` · ${a.authorizationNumber}` : ""}` : "";
  };

  return (
    <section aria-labelledby="housing-heading" className="nmbm-card nmbm-card--dense mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="housing-heading" className="ds-section-heading">
          Housing
        </h2>
        <span className="text-sm text-ds-ink">
          {data.current ? (
            <>
              {HOUSING_SITUATION_LABELS[data.current.situation]}
              <span className="text-ds-muted"> · since <DateText value={data.current.effectiveDate} /></span>
            </>
          ) : (
            <span className="text-ds-muted">Housing situation not recorded</span>
          )}
        </span>
      </div>

      {/* Situation */}
      <div className="mt-3 flex flex-wrap gap-2">
        {writes && open !== "status" && (
          <button className={small} onClick={() => setOpen("status")}>
            Update housing situation
          </button>
        )}
        {data.statuses.length > 1 && (
          <details className="text-xs text-ds-secondary">
            <summary className="cursor-pointer">History ({data.statuses.length})</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {data.statuses.map((s) => (
                <li key={s.id} className={s.voidedAt ? "line-through text-ds-muted" : ""}>
                  <DateText value={s.effectiveDate} />: {HOUSING_SITUATION_LABELS[s.situation]}
                  {s.note && ` — ${s.note}`} <span className="text-ds-muted">({s.recordedByName})</span>
                  {s.voidedAt && <span className="no-underline"> · void: {s.voidReason}</span>}
                  {writes && !s.voidedAt && (
                    <button className="ml-2 underline" onClick={() => voidRow(`/api/housing-statuses/${s.id}/void`, "housing situation")}>
                      void
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {open === "status" && (
        <StatusForm busy={busy} onCancel={() => setOpen(null)} onSubmit={(b) => send(`/api/participants/${record.id}/housing-statuses`, b, "Housing situation recorded.")} />
      )}

      {/* Authorizations */}
      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={h3}>Community Supports authorizations</h3>
          {authorizes && isOpen && open !== "auth" && (
            <button className={small} onClick={() => setOpen("auth")}>
              Record a request
            </button>
          )}
        </div>
        {open === "auth" && (
          <AuthorizationRequestForm
            busy={busy}
            plan={record.payer}
            onCancel={() => setOpen(null)}
            onSubmit={(b) => send(`/api/participants/${record.id}/cs-authorizations`, b, "Authorization request recorded.")}
          />
        )}
        {data.authorizations.length === 0 ? (
          <p className="mt-2 text-sm text-ds-muted">None recorded.</p>
        ) : (
          <ul className="ds-list mt-2">
            {data.authorizations.map((a) => (
              <li key={a.id} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={a.state === "void" ? "text-ds-muted line-through" : "font-medium text-ds-ink"}>
                    {CS_SERVICE_LABELS[a.service]}
                    {a.authorizationNumber && <span className="font-normal text-ds-muted"> · {a.authorizationNumber}</span>}
                  </span>
                  <Pill tone={STATE_PILL[a.state].tone}>{STATE_PILL[a.state].label}</Pill>
                </div>
                <p className="mt-0.5 text-xs text-ds-muted">
                  {a.startDate ? (
                    <>
                      <DateText value={a.startDate} /> to <DateText value={a.lastCoveredDay} />
                    </>
                  ) : (
                    <>
                      Requested <DateText value={a.requestedDate} />
                    </>
                  )}
                  {a.endedDate && ` (ended early: ${a.endedReason})`}
                  {a.unitType && ` · ${a.unitsUsed} of ${a.unitsAuthorized} ${CS_UNIT_LABELS[a.unitType]} used`}
                  {!a.unitType && CS_TIME_SERVICES.includes(a.service) && a.minutesLogged > 0 && ` · ${a.minutesLogged} minutes logged`}
                  {a.amountAuthorized && ` · ${money(a.amountCommitted)} of ${money(a.amountAuthorized)} asked for, ${money(a.amountPaid)} paid`}
                  {a.status === "denied" && a.note && ` · ${a.note}`}
                  {a.voidedAt && ` · void: ${a.voidReason}`}
                </p>
                {a.overAuthorized && (
                  <p className="mt-1 rounded bg-state-warn-bg px-2 py-0.5 text-xs text-state-warn">
                    More work is logged than was authorized. Ask the plan for more before it's billed.
                  </p>
                )}
                {authorizes && a.state !== "void" && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {a.status === "requested" && open !== `decide:${a.id}` && (
                      <button className={small} onClick={() => setOpen(`decide:${a.id}`)}>
                        Record decision
                      </button>
                    )}
                    {a.status === "approved" && !a.endedDate && (a.state === "active" || a.state === "expiring") && open !== `end:${a.id}` && (
                      <button className={small} onClick={() => setOpen(`end:${a.id}`)}>
                        End early
                      </button>
                    )}
                    <button className={small} onClick={() => voidRow(`/api/cs-authorizations/${a.id}/void`, "authorization")}>
                      Void
                    </button>
                  </div>
                )}
                {open === `decide:${a.id}` && (
                  <DecisionForm
                    auth={a}
                    busy={busy}
                    onCancel={() => setOpen(null)}
                    onSubmit={(b) => send(`/api/cs-authorizations/${a.id}/decision`, b, "Decision recorded.")}
                  />
                )}
                {open === `end:${a.id}` && (
                  <EndForm busy={busy} onCancel={() => setOpen(null)} onSubmit={(b) => send(`/api/cs-authorizations/${a.id}/end`, b, "Authorization ended.")} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The work */}
      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={h3}>Housing services</h3>
          {writes && isOpen && usable("time").length > 0 && open !== "work" && (
            <button className={small} onClick={() => setOpen("work")}>
              Log housing work
            </button>
          )}
        </div>
        {writes && isOpen && usable("time").length === 0 && (
          <p className="mt-1 text-xs text-ds-muted">
            Work is logged against an active Navigation or Tenancy and Sustaining authorization. Until one is
            approved, record contacts as notes.
          </p>
        )}
        {open === "work" && (
          <WorkForm
            auths={usable("time")}
            earliest={record.startDate}
            busy={busy}
            onCancel={() => setOpen(null)}
            onSubmit={(b) => send(`/api/participants/${record.id}/housing-services`, b, "Housing work logged.")}
          />
        )}
        {data.services.length === 0 ? (
          <p className="mt-2 text-sm text-ds-muted">None logged.</p>
        ) : (
          <ul className="ds-list mt-2">
            {data.services.slice(0, 15).map((s) => (
              <li key={s.id} className={`px-3 py-2 text-sm ${s.voidedAt ? "text-ds-muted" : ""}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className={s.voidedAt ? "line-through" : ""}>
                    {HOUSING_ACTIVITY_LABELS[s.activity]} · {s.minutes} min · {SERVICE_CONTACT_METHOD_LABELS[s.contactMethod]}
                  </span>
                  <span className="text-xs text-ds-muted"><DateText value={s.serviceDate} /></span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-ds-secondary">{s.note}</p>
                <p className="mt-0.5 text-xs text-ds-muted">
                  {nameOf(s.authorizationId)} · {s.authorName}
                  {s.voidedAt && ` · void: ${s.voidReason}`}
                  {writes && !s.voidedAt && (
                    <button className="ml-2 underline" onClick={() => voidRow(`/api/housing-services/${s.id}/void`, "entry")}>
                      void
                    </button>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Home */}
      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={h3}>Home</h3>
          {writes && !current && open !== "home" && (
            <button className={small} onClick={() => setOpen("home")}>
              Record a move-in
            </button>
          )}
        </div>
        {open === "home" && (
          <TenancyForm busy={busy} onCancel={() => setOpen(null)} onSubmit={(b) => send(`/api/participants/${record.id}/tenancies`, b, "Move-in recorded.")} />
        )}
        {current ? (
          <div className="ds-row mt-2">
            <p className="font-medium text-ds-ink">
              {current.addressLine1}
              {current.addressLine2 && `, ${current.addressLine2}`}, {current.city}, {current.state} {current.postalCode}
            </p>
            <p className="mt-0.5 text-xs text-ds-muted">
              Moved in <DateText value={current.moveInDate} /> · {SUBSIDY_LABELS[current.subsidy]}
              {current.monthlyRent && ` · rent ${money(current.monthlyRent)}`}
              {current.tenantPortion && `, they pay ${money(current.tenantPortion)}`}
              {current.leaseEnd && (
                <>
                  {" "}
                  · lease to <DateText value={current.leaseEnd} />
                </>
              )}
              {current.landlordName && ` · landlord ${current.landlordName}`}
              {current.landlordPhone && ` ${current.landlordPhone}`}
            </p>
            {writes && open !== `out:${current.id}` && (
              <div className="mt-1 flex gap-2">
                <button className={small} onClick={() => setOpen(`out:${current.id}`)}>
                  Record move-out
                </button>
                <button className={small} onClick={() => voidRow(`/api/tenancies/${current.id}/void`, "tenancy")}>
                  Void
                </button>
              </div>
            )}
            {open === `out:${current.id}` && (
              <MoveOutForm
                earliest={current.moveInDate}
                busy={busy}
                onCancel={() => setOpen(null)}
                onSubmit={(b) => send(`/api/tenancies/${current.id}/move-out`, b, "Move-out recorded. Update their housing situation too.")}
              />
            )}
          </div>
        ) : (
          !open?.startsWith("home") && <p className="mt-2 text-sm text-ds-muted">No current home on file.</p>
        )}
        {data.tenancies.filter((t) => t !== current).length > 0 && (
          <ul className="mt-2 text-xs text-ds-muted">
            {data.tenancies
              .filter((t) => t !== current)
              .map((t) => (
                <li key={t.id} className={t.voidedAt ? "line-through" : ""}>
                  {t.addressLine1}, {t.city}: <DateText value={t.moveInDate} /> to {t.moveOutDate ? <DateText value={t.moveOutDate} /> : "—"}
                  {t.moveOutReason && ` (${t.moveOutReason})`}
                  {t.voidedAt && ` · void: ${t.voidReason}`}
                </li>
              ))}
          </ul>
        )}
      </div>

      {/* Deposits */}
      {(data.deposits.length > 0 || usable("deposits").length > 0) && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={h3}>Deposits</h3>
            {writes && isOpen && usable("deposits").length > 0 && open !== "deposit" && (
              <button className={small} onClick={() => setOpen("deposit")}>
                Ask for a deposit
              </button>
            )}
          </div>
          {open === "deposit" && (
            <DepositForm
              auths={usable("deposits")}
              busy={busy}
              onCancel={() => setOpen(null)}
              onSubmit={(b) => send(`/api/participants/${record.id}/housing-deposits`, b, "Deposit requested.")}
            />
          )}
          <ul className="ds-list mt-2">
            {data.deposits.map((d) => (
              <DepositItem
                key={d.id}
                deposit={d}
                me={me}
                writes={writes}
                approves={approves}
                busy={busy}
                open={open}
                setOpen={setOpen}
                send={send}
                voidRow={voidRow}
              />
            ))}
            {data.deposits.length === 0 && <li className="px-3 py-2 text-sm text-ds-muted">None asked for.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

function DepositItem({
  deposit: d,
  me,
  writes,
  approves,
  busy,
  open,
  setOpen,
  send,
  voidRow,
}: {
  deposit: DepositRow;
  me: Me;
  writes: boolean;
  approves: boolean;
  busy: boolean;
  open: string | null;
  setOpen: (v: string | null) => void;
  send: (url: string, body: unknown, message: string) => Promise<boolean>;
  voidRow: (url: string, what: string) => void;
}) {
  const [paidDate, setPaidDate] = useState(todayInOrg);
  const [reference, setReference] = useState("");
  const tone = { requested: "warn", approved: "ok", declined: "alert", paid: "muted" } as const;
  const mine = d.requestedById === me.id;
  return (
    <li className={`px-3 py-2 text-sm ${d.voidedAt ? "text-ds-muted" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={d.voidedAt ? "line-through" : "text-ds-ink"}>
          {money(d.amount)} to {d.payee} · {DEPOSIT_PURPOSE_LABELS[d.purpose]}
        </span>
        {d.voidedAt ? <Pill tone="muted">void</Pill> : <Pill tone={tone[d.status]}>{d.status}</Pill>}
      </div>
      <p className="mt-0.5 text-xs text-ds-muted">
        Asked for by {d.requestedByName} <Timestamp at={d.requestedAt} />
        {d.decidedByName && ` · ${d.status === "declined" ? "declined" : "approved"} by ${d.decidedByName}`}
        {d.decisionNote && `: ${d.decisionNote}`}
        {d.paidDate && (
          <>
            {" "}
            · paid <DateText value={d.paidDate} />, {d.paymentReference}
          </>
        )}
        {d.voidedAt && ` · void: ${d.voidReason}`}
      </p>
      {!d.voidedAt && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {approves && d.status === "requested" && !mine && (
            <>
              <button className={primary} disabled={busy} onClick={() => send(`/api/housing-deposits/${d.id}/decision`, { decision: "approved" }, "Deposit approved.")}>
                Approve
              </button>
              <button
                className={small}
                disabled={busy}
                onClick={() => {
                  const note = window.prompt("Why is it declined?");
                  if (note?.trim()) void send(`/api/housing-deposits/${d.id}/decision`, { decision: "declined", note }, "Deposit declined.");
                }}
              >
                Decline
              </button>
            </>
          )}
          {approves && d.status === "requested" && mine && <span className="text-xs text-ds-muted">Somebody else decides your request.</span>}
          {approves && d.status === "approved" && open !== `paid:${d.id}` && (
            <button className={small} onClick={() => setOpen(`paid:${d.id}`)}>
              Record payment
            </button>
          )}
          {d.status !== "paid" && (approves || (writes && mine && d.status === "requested")) && (
            <button className={small} onClick={() => voidRow(`/api/housing-deposits/${d.id}/void`, "deposit request")}>
              Void
            </button>
          )}
        </div>
      )}
      {open === `paid:${d.id}` && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(`/api/housing-deposits/${d.id}/paid`, { paidDate, paymentReference: reference }, "Payment recorded.");
          }}
        >
          <label className={label}>
            Paid on
            <input type="date" required className={field} value={paidDate} max={todayInOrg()} onChange={(e) => setPaidDate(e.target.value)} />
          </label>
          <label className={label}>
            Check or payment number
            <input required className={field} value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <button className={primary} disabled={busy}>
            Save
          </button>
          <button type="button" className={small} onClick={() => setOpen(null)}>
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}

function FormShell({ children, busy, onCancel, onSubmit }: { children: React.ReactNode; busy: boolean; onCancel: () => void; onSubmit: () => void }) {
  return (
    <form
      className="ds-inset mt-2 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <div className="flex gap-2">
        <button className={primary} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className={small} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function StatusForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (b: object) => void }) {
  const [situation, setSituation] = useState("emergency_shelter");
  const [effectiveDate, setDate] = useState(todayInOrg);
  const [note, setNote] = useState("");
  return (
    <FormShell busy={busy} onCancel={onCancel} onSubmit={() => onSubmit({ situation, effectiveDate, note })}>
      <label className={label}>
        Where they're living
        <select className={field} value={situation} onChange={(e) => setSituation(e.target.value)}>
          {HOUSING_SITUATIONS.map((s) => (
            <option key={s} value={s}>
              {HOUSING_SITUATION_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Since
        <input type="date" required className={field} value={effectiveDate} max={todayInOrg()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className={`${label} min-w-[12rem] flex-1`}>
        Note (optional)
        <input className={field} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </FormShell>
  );
}

function AuthorizationRequestForm({ busy, plan: defaultPlan, onCancel, onSubmit }: { busy: boolean; plan: string | null; onCancel: () => void; onSubmit: (b: object) => void }) {
  const [service, setService] = useState<CsService>("housing_transition_navigation");
  const [requestedDate, setDate] = useState(todayInOrg);
  const [plan, setPlan] = useState(defaultPlan ?? "");
  const [authorizationNumber, setNumber] = useState("");
  return (
    <FormShell busy={busy} onCancel={onCancel} onSubmit={() => onSubmit({ service, requestedDate, plan: plan || null, authorizationNumber })}>
      <label className={label}>
        Service
        <select className={field} value={service} onChange={(e) => setService(e.target.value as CsService)}>
          {CS_SERVICES.map((s) => (
            <option key={s} value={s}>
              {CS_SERVICE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Requested on
        <input type="date" required className={field} value={requestedDate} max={todayInOrg()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className={label}>
        Health plan
        <select className={field} value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="">Not recorded</option>
          {PAYER_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Reference number (optional)
        <input className={field} value={authorizationNumber} onChange={(e) => setNumber(e.target.value)} />
      </label>
    </FormShell>
  );
}

function DecisionForm({ auth, busy, onCancel, onSubmit }: { auth: CsAuthorizationRow; busy: boolean; onCancel: () => void; onSubmit: (b: object) => void }) {
  const [decision, setDecision] = useState<"approved" | "denied">("approved");
  const [decisionDate, setDecisionDate] = useState(todayInOrg);
  const [authorizationNumber, setNumber] = useState(auth.authorizationNumber ?? "");
  const [startDate, setStart] = useState(todayInOrg);
  const [endDate, setEnd] = useState("");
  const [unitType, setUnitType] = useState("");
  const [units, setUnits] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const deposits = auth.service === "housing_deposits";
  const body =
    decision === "denied"
      ? { decision, decisionDate, note }
      : {
          decision,
          decisionDate,
          authorizationNumber,
          startDate,
          endDate,
          ...(deposits ? { amountAuthorized: amount } : unitType ? { unitType, unitsAuthorized: Number(units) } : {}),
          note,
        };
  return (
    <FormShell busy={busy} onCancel={onCancel} onSubmit={() => onSubmit(body)}>
      <label className={label}>
        The plan
        <select className={field} value={decision} onChange={(e) => setDecision(e.target.value as "approved" | "denied")}>
          <option value="approved">Approved it</option>
          <option value="denied">Denied it</option>
        </select>
      </label>
      <label className={label}>
        On
        <input type="date" required className={field} value={decisionDate} min={auth.requestedDate} max={todayInOrg()} onChange={(e) => setDecisionDate(e.target.value)} />
      </label>
      {decision === "approved" ? (
        <>
          <label className={label}>
            Authorization number
            <input required className={field} value={authorizationNumber} onChange={(e) => setNumber(e.target.value)} />
          </label>
          <label className={label}>
            From
            <input type="date" required className={field} value={startDate} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className={label}>
            To
            <input type="date" required className={field} value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} />
          </label>
          {deposits ? (
            <label className={label}>
              Amount authorized ($)
              <input required inputMode="decimal" pattern="\d{1,7}(\.\d{1,2})?" className={`${field} w-28`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          ) : (
            <>
              <label className={label}>
                Units (optional)
                <input type="number" min={1} className={`${field} w-20`} value={units} required={Boolean(unitType)} onChange={(e) => setUnits(e.target.value)} />
              </label>
              <label className={label}>
                Counted in
                <select className={field} value={unitType} required={Boolean(units)} onChange={(e) => setUnitType(e.target.value)}>
                  <option value="">—</option>
                  {CS_UNIT_TYPES.map((u) => (
                    <option key={u} value={u}>
                      {CS_UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </>
      ) : (
        <label className={`${label} min-w-[14rem] flex-1`}>
          Reason given
          <input required className={field} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
    </FormShell>
  );
}

function EndForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (b: object) => void }) {
  const [endedDate, setDate] = useState(todayInOrg);
  const [reason, setReason] = useState("");
  return (
    <FormShell busy={busy} onCancel={onCancel} onSubmit={() => onSubmit({ endedDate, reason })}>
      <label className={label}>
        Last day it covers
        <input type="date" required className={field} value={endedDate} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className={`${label} min-w-[14rem] flex-1`}>
        Why
        <input required className={field} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
    </FormShell>
  );
}

function WorkForm({ auths, earliest, busy, onCancel, onSubmit }: { auths: CsAuthorizationRow[]; earliest: string | null; busy: boolean; onCancel: () => void; onSubmit: (b: object) => void }) {
  const [authorizationId, setAuth] = useState(auths[0]?.id ?? "");
  const [serviceDate, setDate] = useState(todayInOrg);
  const [minutes, setMinutes] = useState("");
  const [activity, setActivity] = useState("housing_search");
  const [contactMethod, setMethod] = useState("in_person");
  const [note, setNote] = useState("");
  const chosen = auths.find((a) => a.id === authorizationId);
  const minDate = [earliest, chosen?.startDate].filter(Boolean).sort().at(-1) ?? undefined;
  const maxDate = [todayInOrg(), chosen?.lastCoveredDay].filter(Boolean).sort()[0] ?? undefined;
  return (
    <FormShell busy={busy} onCancel={onCancel} onSubmit={() => onSubmit({ authorizationId, serviceDate, minutes: Number(minutes), activity, contactMethod, note })}>
      <label className={label}>
        Authorization
        <select className={field} value={authorizationId} onChange={(e) => setAuth(e.target.value)}>
          {auths.map((a) => (
            <option key={a.id} value={a.id}>
              {CS_SERVICE_LABELS[a.service]} · {a.authorizationNumber}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Date of service
        <input type="date" required className={field} value={serviceDate} min={minDate} max={maxDate} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className={label}>
        Minutes
        <input type="number" required min={1} max={720} className={`${field} w-20`} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </label>
      <label className={label}>
        Activity
        <select className={field} value={activity} onChange={(e) => setActivity(e.target.value)}>
          {HOUSING_ACTIVITIES.map((a) => (
            <option key={a} value={a}>
              {HOUSING_ACTIVITY_LABELS[a]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Contact method
        <select className={field} value={contactMethod} onChange={(e) => setMethod(e.target.value)}>
          {SERVICE_CONTACT_METHODS.map((m) => (
            <option key={m} value={m}>
              {SERVICE_CONTACT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <label className={`${label} w-full`}>
        What was done
        <textarea required rows={2} className={field} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </FormShell>
  );
}

function TenancyForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (b: object) => void }) {
  const [f, setF] = useState({
    moveInDate: todayInOrg(),
    addressLine1: "",
    addressLine2: "",
    city: "Long Beach",
    state: "CA",
    postalCode: "",
    landlordName: "",
    landlordPhone: "",
    subsidy: "none",
    monthlyRent: "",
    tenantPortion: "",
    leaseStart: "",
    leaseEnd: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const blankToNull = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v]));
  const money = { inputMode: "decimal" as const, pattern: "\\d{1,7}(\\.\\d{1,2})?", className: `${field} w-24` };
  return (
    <FormShell busy={busy} onCancel={onCancel} onSubmit={() => onSubmit(blankToNull)}>
      <label className={label}>
        Moved in
        <input type="date" required className={field} value={f.moveInDate} max={todayInOrg()} onChange={set("moveInDate")} />
      </label>
      <label className={`${label} min-w-[14rem] flex-1`}>
        Street address
        <input required className={field} value={f.addressLine1} onChange={set("addressLine1")} />
      </label>
      <label className={label}>
        Unit
        <input className={`${field} w-20`} value={f.addressLine2} onChange={set("addressLine2")} />
      </label>
      <label className={label}>
        City
        <input required className={field} value={f.city} onChange={set("city")} />
      </label>
      <label className={label}>
        State
        <input required maxLength={2} className={`${field} w-14`} value={f.state} onChange={set("state")} />
      </label>
      <label className={label}>
        ZIP
        <input required inputMode="numeric" pattern="\d{5}(-\d{4})?" className={`${field} w-24`} value={f.postalCode} onChange={set("postalCode")} />
      </label>
      <label className={label}>
        Subsidy
        <select className={field} value={f.subsidy} onChange={set("subsidy")}>
          {SUBSIDY_TYPES.map((s) => (
            <option key={s} value={s}>
              {SUBSIDY_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Monthly rent ($)
        <input {...money} value={f.monthlyRent} onChange={set("monthlyRent")} />
      </label>
      <label className={label}>
        They pay ($)
        <input {...money} value={f.tenantPortion} onChange={set("tenantPortion")} />
      </label>
      <label className={label}>
        Lease from
        <input type="date" className={field} value={f.leaseStart} onChange={set("leaseStart")} />
      </label>
      <label className={label}>
        Lease to
        <input type="date" className={field} value={f.leaseEnd} onChange={set("leaseEnd")} />
      </label>
      <label className={label}>
        Landlord
        <input className={field} value={f.landlordName} onChange={set("landlordName")} />
      </label>
      <label className={label}>
        Landlord phone
        <input type="tel" className={field} value={f.landlordPhone} onChange={set("landlordPhone")} />
      </label>
    </FormShell>
  );
}

function MoveOutForm({ earliest, busy, onCancel, onSubmit }: { earliest: string; busy: boolean; onCancel: () => void; onSubmit: (b: object) => void }) {
  const [moveOutDate, setDate] = useState(todayInOrg);
  const [reason, setReason] = useState("");
  return (
    <FormShell busy={busy} onCancel={onCancel} onSubmit={() => onSubmit({ moveOutDate, reason })}>
      <label className={label}>
        Moved out
        <input type="date" required className={field} value={moveOutDate} min={earliest} max={todayInOrg()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className={`${label} min-w-[14rem] flex-1`}>
        Why
        <input required className={field} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
    </FormShell>
  );
}

function DepositForm({ auths, busy, onCancel, onSubmit }: { auths: CsAuthorizationRow[]; busy: boolean; onCancel: () => void; onSubmit: (b: object) => void }) {
  const [authorizationId, setAuth] = useState(auths[0]?.id ?? "");
  const [purpose, setPurpose] = useState("security_deposit");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const chosen = auths.find((a) => a.id === authorizationId);
  return (
    <FormShell busy={busy} onCancel={onCancel} onSubmit={() => onSubmit({ authorizationId, purpose, payee, amount, note })}>
      <label className={label}>
        Authorization
        <select className={field} value={authorizationId} onChange={(e) => setAuth(e.target.value)}>
          {auths.map((a) => (
            <option key={a.id} value={a.id}>
              {a.authorizationNumber} ({money(a.amountAuthorized)})
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        For
        <select className={field} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          {DEPOSIT_PURPOSES.map((p) => (
            <option key={p} value={p}>
              {DEPOSIT_PURPOSE_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Paid to
        <input required className={field} value={payee} onChange={(e) => setPayee(e.target.value)} />
      </label>
      <label className={label}>
        Amount ($)
        <input required inputMode="decimal" pattern="\d{1,7}(\.\d{1,2})?" className={`${field} w-28`} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className={`${label} min-w-[12rem] flex-1`}>
        Note (optional)
        <input className={field} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {chosen && (
        <p className="w-full text-xs text-ds-muted">
          {money(chosen.amountCommitted)} of {money(chosen.amountAuthorized)} already asked for on this authorization.
        </p>
      )}
    </FormShell>
  );
}
