import { useState } from "react";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import type { ConsentType } from "@nmbm/shared";
import type { Me, ParticipantDetail } from "../lib/types.js";
import { Pill } from "./flags.js";

const TYPE_LABELS: Record<ConsentType, string> = {
  general_services: "General services",
  release_of_information: "Release of information",
  photo_media: "Photo / media",
  other: "Other",
};

// M15/M16. Recording that a form was signed is useful before the
// scanned copy can be attached — Cloud Storage isn't provisioned yet,
// so there's no upload control here on purpose.
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
  const [formName, setFormName] = useState("Authorisation to release information");
  const [signedDate, setSignedDate] = useState(new Date().toISOString().slice(0, 10));
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
    <section className="mt-6 rounded border border-nmbm-ink/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/50">
          Consent forms
        </h2>
        {writable && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded border border-nmbm-ink/30 px-3 py-1 text-sm"
          >
            Record a signed form
          </button>
        )}
      </div>

      {record.consents.length === 0 && !adding && (
        <p className="mt-3 text-sm text-nmbm-ink/60">Nothing on file.</p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {record.consents.map((consent) => (
          <li key={consent.id} className="rounded border border-nmbm-ink/10 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-nmbm-ink">{consent.formName}</span>
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
            <p className="mt-0.5 text-xs text-nmbm-ink/50">
              {TYPE_LABELS[consent.type]} · signed {consent.signedDate} · expires{" "}
              {consent.expiresDate}
              {consent.recordedByName && ` · recorded by ${consent.recordedByName}`}
            </p>
            {consent.revokedReason && (
              <p className="mt-1 text-xs text-state-alert">Revoked: {consent.revokedReason}</p>
            )}
            {writable && consent.status === "active" && (
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
                className="mt-1 text-xs text-nmbm-ink/50 underline-offset-2 hover:text-state-alert hover:underline"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="mt-3 rounded border border-nmbm-ink/15 p-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Form type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ConsentType)}
                className="rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm"
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
                className="rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Signed
              <input
                type="date"
                value={signedDate}
                onChange={(e) => setSignedDate(e.target.value)}
                className="rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-nmbm-ink/50">
            Expiry is set to one year from enrolment, per NMBM's rule — not from the signature
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
              className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-50"
            >
              Save
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
