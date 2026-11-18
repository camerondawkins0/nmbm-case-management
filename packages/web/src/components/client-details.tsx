import { useState } from "react";
import { formatPhone, PARTICIPANT_DETAIL_FIELDS, type ParticipantDetails } from "@nmbm/shared";
import { api, ApiError } from "../lib/api.js";
import type { ClientDetails } from "../lib/types.js";

export type DetailsForm = Record<keyof ParticipantDetails, string>;

export const emptyDetails = (): DetailsForm =>
  Object.fromEntries(PARTICIPANT_DETAIL_FIELDS.map((k) => [k, ""])) as DetailsForm;

const field = "nmbm-control";
const label = "ds-field";
const legend = "ds-section-heading";

// The same boxes at intake and on the record. The browser checks the
// shape as people type; the server checks again and tidies (phones to
// ten digits, the CIN to capitals), so what's typed here can be loose.
export function DetailsFields({ value, onChange }: { value: DetailsForm; onChange: (v: DetailsForm) => void }) {
  const input = (key: keyof DetailsForm, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} className={field} {...props} />
  );
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className={`${legend} mb-2`}>Contact</legend>
        <label className={label}>
          Phone
          {input("phone", { type: "tel", autoComplete: "off", placeholder: "(562) 555-0134" })}
        </label>
        <label className={label}>
          Email
          {input("email", { type: "email", autoComplete: "off" })}
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-6">
        <legend className={`${legend} mb-2`}>Address</legend>
        <label className={`${label} sm:col-span-6`}>
          Street address
          {input("addressLine1", { autoComplete: "off" })}
        </label>
        <label className={`${label} sm:col-span-6`}>
          Apartment, unit or shelter (optional)
          {input("addressLine2", { autoComplete: "off" })}
        </label>
        <label className={`${label} sm:col-span-3`}>
          City
          {input("city", { autoComplete: "off" })}
        </label>
        <label className={`${label} sm:col-span-1`}>
          State
          {input("state", { maxLength: 2, placeholder: "CA", pattern: "[A-Za-z]{2}", title: "Two letters, like CA" })}
        </label>
        <label className={`${label} sm:col-span-2`}>
          ZIP code
          {input("postalCode", { inputMode: "numeric", pattern: "\\d{5}(-\\d{4})?", title: "5 digits, or 5 and 4" })}
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className={`${legend} mb-2`}>Insurance</legend>
        <label className={label}>
          Medi-Cal CIN
          {input("mediCalCin", {
            placeholder: "91234567A",
            pattern: "\\s*\\d{4}\\s*\\d{4}\\s*[A-Za-z]\\s*",
            title: "8 digits and a letter",
          })}
        </label>
        <label className={label}>
          Health plan member ID
          {input("planMemberId")}
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className={`${legend} mb-2`}>Emergency contact</legend>
        <label className={label}>
          Name
          {input("emergencyContactName", { autoComplete: "off" })}
        </label>
        <label className={label}>
          Phone
          {input("emergencyContactPhone", { type: "tel", autoComplete: "off" })}
        </label>
        <label className={label}>
          Relationship
          {input("emergencyContactRelationship", { placeholder: "e.g. sister" })}
        </label>
      </fieldset>
    </div>
  );
}

// What's sent: blanks as null so a cleared box clears the value.
export function detailsPayload(form: DetailsForm) {
  return Object.fromEntries(PARTICIPANT_DETAIL_FIELDS.map((k) => [k, form[k].trim() === "" ? null : form[k]]));
}

function toForm(details: ClientDetails): DetailsForm {
  return Object.fromEntries(
    PARTICIPANT_DETAIL_FIELDS.map((k) => [k, k.toLowerCase().includes("phone") ? formatPhone(details[k]) : details[k] ?? ""]),
  ) as DetailsForm;
}

// On the record: read at a glance, changed by whoever keeps them current.
export function ClientDetailsSection({
  participantId,
  details,
  canEdit,
  onSaved,
}: {
  participantId: string;
  details: ClientDetails;
  canEdit: boolean;
  onSaved: (message: string) => void;
}) {
  const [editing, setEditing] = useState<DetailsForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = [
    details.addressLine1,
    details.addressLine2,
    [details.city, [details.state, details.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
  ].filter(Boolean);
  const emergency = [
    details.emergencyContactName,
    details.emergencyContactRelationship && `(${details.emergencyContactRelationship})`,
    formatPhone(details.emergencyContactPhone),
  ]
    .filter(Boolean)
    .join(" ");
  const rows: [string, React.ReactNode][] = [
    ["Phone", formatPhone(details.phone)],
    ["Email", details.email],
    ["Address", address.length > 0 ? address.map((l, i) => <span key={i} className="block">{l}</span>) : null],
    ["Medi-Cal CIN", details.mediCalCin],
    ["Plan member ID", details.planMemberId],
    ["Emergency contact", emergency],
  ];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/participants/${participantId}/details`, {
        method: "PATCH",
        body: JSON.stringify(detailsPayload(editing)),
      });
      setEditing(null);
      onSaved("Details saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="nmbm-card nmbm-card--dense mt-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="ds-section-heading">Details</h2>
        {canEdit && !editing && (
          <button onClick={() => setEditing(toForm(details))} className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm">
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} className="mt-3">
          <DetailsFields value={editing} onChange={setEditing} />
          {error && <p className="mt-3 text-sm text-state-alert">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="nmbm-btn nmbm-btn--dark nmbm-btn--md"
            >
              {saving ? "Saving…" : "Save details"}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="nmbm-btn nmbm-btn--secondary nmbm-btn--md">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {rows.map(([name, v]) => (
              <div key={name}>
                <dt className="text-xs text-ds-muted">{name}</dt>
                <dd className={v ? "text-ds-ink" : "text-ds-muted"}>{v || "Not recorded"}</dd>
              </div>
            ))}
          </dl>
          {details.updatedAt && (
            <p className="mt-3 text-xs text-ds-muted">Last changed {new Date(details.updatedAt).toLocaleDateString()}</p>
          )}
        </>
      )}
    </section>
  );
}
