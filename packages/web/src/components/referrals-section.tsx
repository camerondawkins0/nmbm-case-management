import { useState } from "react";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import type { ReferralStatus } from "@nmbm/shared";
import type { Me, ParticipantDetail } from "../lib/types.js";
import { Pill } from "./flags.js";

const OUTCOMES: { value: ReferralStatus; label: string }[] = [
  { value: "accepted", label: "Partner accepted" },
  { value: "completed", label: "Service delivered" },
  { value: "declined", label: "Partner declined" },
  { value: "no_response", label: "No response" },
  { value: "withdrawn", label: "Withdrawn" },
];

function tone(status: ReferralStatus) {
  if (status === "completed" || status === "accepted") return "ok" as const;
  if (status === "declined" || status === "no_response") return "warn" as const;
  if (status === "withdrawn") return "muted" as const;
  return "muted" as const;
}

// M17: refer out and find out what happened. The consent gate lives on
// the server — this surfaces whatever it says rather than trying to
// predict it, so the reason shown is always the real one.
export function ReferralsSection({
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
  const writable = can(me, "referrals.write") && record.episodeStatus === "open";
  const [adding, setAdding] = useState(false);
  const [partnerName, setPartnerName] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [outcomeStatus, setOutcomeStatus] = useState<ReferralStatus>("completed");
  const [outcomeNote, setOutcomeNote] = useState("");

  const hasUsableRelease = record.consents.some(
    (c) => c.type === "release_of_information" && c.status === "active",
  );

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      setAdding(false);
      setOutcomeFor(null);
      setPartnerName("");
      setServiceType("");
      setReason("");
      setOutcomeNote("");
      onChanged(message);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded border border-nmbm-ink/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
          Referrals out
        </h2>
        {writable && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded border border-nmbm-ink/30 px-3 py-1 text-sm"
          >
            Refer out
          </button>
        )}
      </div>

      {/* Saying so up front beats letting someone fill in a form that
          the server is going to refuse. The server still decides. */}
      {writable && !hasUsableRelease && (
        <p className="mt-3 rounded border border-state-warn/25 bg-state-warn-bg px-3 py-2 text-sm text-state-warn">
          No current release of information on file — a referral can't be sent until one is
          recorded above.
        </p>
      )}

      {record.referrals.length === 0 && !adding && (
        <p className="mt-3 text-sm text-nmbm-ink/60">None sent.</p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {record.referrals.map((referral) => (
          <li key={referral.id} className="rounded border border-nmbm-ink/10 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-nmbm-ink">
                {referral.serviceType} — {referral.partnerName}
              </span>
              <Pill tone={tone(referral.status)}>{referral.status.replace("_", " ")}</Pill>
            </div>
            <p className="mt-0.5 text-xs text-nmbm-ink/50">
              sent {new Date(referral.referredAt).toLocaleDateString()} by{" "}
              {referral.referredByName}
              {referral.outcomeRecordedAt &&
                ` · outcome ${new Date(referral.outcomeRecordedAt).toLocaleDateString()}`}
            </p>
            {referral.outcomeNote && (
              <p className="mt-1 text-xs text-nmbm-ink/70">{referral.outcomeNote}</p>
            )}

            {writable && outcomeFor !== referral.id && (
              <button
                onClick={() => setOutcomeFor(referral.id)}
                className="mt-1 text-xs text-nmbm-gold-dark underline-offset-2 hover:underline"
              >
                Record what happened
              </button>
            )}

            {outcomeFor === referral.id && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={outcomeStatus}
                  onChange={(e) => setOutcomeStatus(e.target.value as ReferralStatus)}
                  className="rounded border border-nmbm-ink/20 px-2 py-1 text-sm"
                >
                  {OUTCOMES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  value={outcomeNote}
                  onChange={(e) => setOutcomeNote(e.target.value)}
                  placeholder="What did the partner say?"
                  className="min-w-[14rem] flex-1 rounded border border-nmbm-ink/20 px-2 py-1 text-sm"
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        api(`/api/referrals/${referral.id}/outcome`, {
                          method: "POST",
                          body: JSON.stringify({
                            status: outcomeStatus,
                            outcomeNote: outcomeNote || undefined,
                          }),
                        }),
                      "Outcome recorded.",
                    )
                  }
                  className="rounded bg-nmbm-ink px-3 py-1 text-sm font-medium text-nmbm-paper disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="mt-3 rounded border border-nmbm-ink/15 p-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Partner agency
              <input
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                placeholder="Who are you referring to?"
                className="rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Service
              <input
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                placeholder="What for?"
                className="rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="mt-3 w-full rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm"
          />
          <div className="mt-2 flex gap-2">
            <button
              disabled={busy || !partnerName.trim() || !serviceType.trim()}
              onClick={() =>
                run(
                  () =>
                    api("/api/referrals", {
                      method: "POST",
                      body: JSON.stringify({
                        participantId: record.id,
                        partnerName,
                        serviceType,
                        reason: reason || undefined,
                      }),
                    }),
                  "Referral sent.",
                )
              }
              className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-50"
            >
              Send referral
            </button>
            <button
              onClick={() => setAdding(false)}
              className="rounded border border-nmbm-ink/30 px-4 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
