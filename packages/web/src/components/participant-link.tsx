import { useState } from "react";
import { api, ApiError } from "../lib/api.js";
import type { AssessmentLinkState, IssuedLink } from "../lib/types.js";

// The one date not written 2026-11-25: it is read out to the participant,
// often over the phone, and "Wed, Nov 25" is what they will remember.
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="nmbm-label">{label}</span>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
          className="nmbm-control min-w-0 flex-1 font-mono"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard blocked; the field is selectable instead.
            }
          }}
          className="nmbm-btn nmbm-btn--secondary nmbm-btn--md"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// The link and passcode, shown this once. The app sends nothing: the
// case manager passes them on themselves — and the two separately, so
// that an email forwarded or read over someone's shoulder isn't enough
// to open the form.
export function LinkHandover({ issued, onDone }: { issued: IssuedLink; onDone: () => void }) {
  const url = `${window.location.origin}/f/${issued.token}`;
  return (
    <div className="mt-3 nmbm-alert nmbm-alert--warn">
      <h3 className="text-sm font-semibold text-ds-ink">Give these to the participant</h3>
      <p className="mt-1 text-sm text-ds-secondary">
        Shown once — the passcode can't be looked up again. If it's lost, make a new link.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <CopyLine label="Link" value={url} />
        <CopyLine label="Passcode" value={issued.passcode} />
      </div>
      <ul className="mt-3 list-disc pl-5 text-xs text-ds-muted">
        <li>
          Send them separately: the link by email from your NMBM account, say, and the passcode by
          phone or in person.
        </li>
        <li>Works until {day(issued.expiresAt)}, or until they send their answers.</li>
        <li>Five wrong passcodes lock the link.</li>
      </ul>
      <button
        onClick={onDone}
        className="nmbm-btn nmbm-btn--dark nmbm-btn--md mt-4"
      >
        I've passed these on
      </button>
    </div>
  );
}

const STATE_TEXT: Record<AssessmentLinkState["state"], string> = {
  live: "Link works until",
  locked: "Link locked after too many wrong passcodes",
  expired: "Link expired",
  revoked: "Link withdrawn",
  submitted: "Sent in by the participant",
};

// Where a participant's link stands, and what the case manager can do
// about it.
export function LinkStatus({
  assessmentId,
  link,
  canManage,
  onIssued,
  onChanged,
  onError,
}: {
  assessmentId: string;
  link: AssessmentLinkState;
  canManage: boolean;
  onIssued: (issued: IssuedLink) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ds-muted">
      <span>
        {STATE_TEXT[link.state]}
        {link.state === "live" && ` ${day(link.expiresAt)}`}
        {link.state === "live" && (link.openedAt ? " · opened" : " · not opened yet")}
      </span>
      {canManage && link.state !== "submitted" && (
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (
                link.state === "live" &&
                !window.confirm("Make a new link and passcode? The current ones will stop working.")
              )
                return;
              onIssued(await api<IssuedLink>(`/api/assessments/${assessmentId}/link`, { method: "POST" }));
            })
          }
          className="underline underline-offset-2 hover:text-ds-ink"
        >
          New link and passcode
        </button>
      )}
      {canManage && link.state === "live" && (
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (!window.confirm("Stop this link working? Answers given so far are kept.")) return;
              await api(`/api/assessments/${assessmentId}/link/revoke`, { method: "POST" });
              onChanged();
            })
          }
          className="nmbm-btn nmbm-btn--danger nmbm-btn--md"
        >
          Withdraw link
        </button>
      )}
    </div>
  );
}
