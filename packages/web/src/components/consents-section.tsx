import { useState } from "react";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import { todayInOrg, type ConsentType } from "@nmbm/shared";
import type { Me, ParticipantDetail } from "../lib/types.js";
import { Pill } from "./flags.js";
import { DateText } from "./dates.js";

const TYPE_LABELS: Record<ConsentType, string> = {
  general_services: "General services",
  release_of_information: "Release of information",
  photo_media: "Photo / media",
  other: "Other",
};

// M15/M16. Recording that a form was signed and attaching the scan are
// separate steps: the scan goes in Documents, linked back to the form,
// so a signature can be recorded the day it happens even if the scanner
// is down.
export function ConsentsSection({
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
  const writable = can(me, "consents.write");
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<ConsentType>("release_of_information");
  const [formName, setFormName] = useState("Authorization to release information");
  // Long Beach's today, not UTC's: after 4pm here UTC is already tomorrow.
  const [signedDate, setSignedDate] = useState(todayInOrg);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      setAdding(false);
      onChanged(message);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="nmbm-card nmbm-card--dense mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="ds-section-heading">
          Consent forms
        </h2>
        {/* A form is recorded against an enrollment, so a closed record
            can't take a new one — but revoking stays available below:
            somebody who has left can still withdraw an authorization. */}
        {writable && record.episodeStatus === "open" && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm"
          >
            Record a signed form
          </button>
        )}
      </div>

      {record.consents.length === 0 && !adding && (
        <p className="mt-3 text-sm text-ds-muted">Nothing on file.</p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {record.consents.map((consent) => (
          <li key={consent.id} className="ds-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-ds-ink">{consent.formName}</span>
              <Pill
                tone={
                  consent.status === "active"
                    ? "ok"
                    : consent.status === "expired"
                      ? "warn"
                      : "alert"
                }
              >
                {consent.status}
              </Pill>
            </div>
            <p className="mt-0.5 text-xs text-ds-muted">
              {TYPE_LABELS[consent.type]} · signed <DateText value={consent.signedDate} /> · expires{" "}
              <DateText value={consent.expiresDate} />
              {consent.recordedByName && ` · recorded by ${consent.recordedByName}`}
            </p>
            {consent.revokedReason && (
              <p className="mt-1 text-xs text-state-alert">Revoked: {consent.revokedReason}</p>
            )}
            {writable && record.canWrite && consent.status === "active" && (
              <button
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt("Why is this consent being revoked?");
                  if (!reason) return;
                  run(
                    () =>
                      api(`/api/consents/${consent.id}/revoke`, {
                        method: "POST",
                        body: JSON.stringify({ reason }),
                      }),
                    "Consent revoked.",
                  );
                }}
                className="nmbm-btn nmbm-btn--danger nmbm-btn--sm mt-1"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="nmbm-card nmbm-card--dense mt-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Form type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ConsentType)}
                className="nmbm-control nmbm-select"
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Form name
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="nmbm-control"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Signed
              <input
                type="date"
                value={signedDate}
                onChange={(e) => setSignedDate(e.target.value)}
                className="nmbm-control"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-ds-muted">
            Expiry is set to one year from enrollment, per NMBM's rule — not from the signature
            date.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              disabled={busy || !formName.trim()}
              onClick={() =>
                run(
                  () =>
                    api("/api/consents", {
                      method: "POST",
                      body: JSON.stringify({
                        participantId: record.id,
                        type,
                        formName,
                        signedDate,
                      }),
                    }),
                  "Consent recorded.",
                )
              }
              className="nmbm-btn nmbm-btn--dark nmbm-btn--md"
            >
              Save
            </button>
            <button
              onClick={() => setAdding(false)}
              className="nmbm-btn nmbm-btn--secondary nmbm-btn--md"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
