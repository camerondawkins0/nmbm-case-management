import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api.js";
import { can } from "../lib/use-me.js";
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES } from "@nmbm/shared";
import type { Me, ParticipantDetail, ParticipantDocument } from "../lib/types.js";
import { Pill } from "./flags.js";
import { DateText, Timestamp } from "./dates.js";

type UploadStart = {
  documentId: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
};

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Some browsers report no type for an iPhone photo, which would turn
// away the most common upload there is. Only HEIC gets the fallback;
// anything else without a type is refused as before.
function contentTypeOf(file: File) {
  if (!file.type && /\.hei[cf]$/i.test(file.name)) return "image/heic";
  return file.type;
}

// Scans and photos of paperwork. The file goes from the browser straight
// to storage on a short-lived signed link, so it never passes through
// the app server, and the record only shows it once the server has
// checked it actually arrived.
export function DocumentsSection({
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
  const writable = can(me, "documents.write");
  const [documents, setDocuments] = useState<ParticipantDocument[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [consentId, setConsentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [showVoided, setShowVoided] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setDocuments(await api<ParticipantDocument[]>(`/api/participants/${record.id}/documents`));
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not load documents");
    }
  }, [record.id, onError]);

  useEffect(() => {
    load();
  }, [load]);

  function reset() {
    setAdding(false);
    setFile(null);
    setDescription("");
    setConsentId("");
    if (fileInput.current) fileInput.current.value = "";
  }

  // Checked here only so the worker hears it before waiting on an
  // upload; the server and the signed link enforce both regardless.
  const fileProblem = !file
    ? null
    : !(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(contentTypeOf(file))
      ? "Upload a PDF or a photo (JPEG, PNG, HEIC or WebP)."
      : file.size > DOCUMENT_MAX_BYTES
        ? "Files can be up to 10 MB."
        : null;

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const start = await api<UploadStart>(`/api/participants/${record.id}/documents`, {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          contentType: contentTypeOf(file),
          sizeBytes: file.size,
          description,
          ...(consentId ? { consentId } : {}),
        }),
      });
      // Not through api(): this goes to storage, not to the app, and
      // must carry exactly the headers the link was signed with.
      const put = await fetch(start.upload.url, {
        method: start.upload.method,
        headers: start.upload.headers,
        body: file,
      });
      if (!put.ok) throw new ApiError(put.status, "The upload didn't go through. Try again.");
      await api(`/api/documents/${start.documentId}/confirm`, { method: "POST" });
      reset();
      onChanged("Document uploaded.");
      load();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "The upload didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function open(doc: ParticipantDocument) {
    // Opened before the request so the browser treats it as the click's
    // own window rather than a pop-up to block.
    const tab = window.open("", "_blank");
    try {
      const { url } = await api<{ url: string }>(`/api/documents/${doc.id}/download-url`);
      if (tab) {
        // The new tab mustn't be able to reach back into this one.
        tab.opener = null;
        tab.location.href = url;
      } else window.location.assign(url);
    } catch (e) {
      tab?.close();
      onError(e instanceof ApiError ? e.message : "Could not open the document");
    }
  }

  async function voidDoc(doc: ParticipantDocument) {
    const reason = window.prompt(
      "Why is this document being voided? It stays on file but can no longer be opened here.",
    );
    if (!reason) return;
    setBusy(true);
    try {
      await api(`/api/documents/${doc.id}/void`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      onChanged("Document voided.");
      load();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not void the document");
    } finally {
      setBusy(false);
    }
  }

  const visible = (documents ?? []).filter((d) => showVoided || d.status === "uploaded");
  const voidedCount = (documents ?? []).filter((d) => d.status === "voided").length;

  return (
    <section className="nmbm-card nmbm-card--dense mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="ds-section-heading">
          Documents
        </h2>
        {writable && record.episodeStatus === "open" && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm"
          >
            Upload a document
          </button>
        )}
      </div>

      {documents && visible.length === 0 && !adding && (
        <p className="mt-3 text-sm text-ds-muted">Nothing on file.</p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {visible.map((doc) => (
          <li key={doc.id} className="ds-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {doc.status === "uploaded" ? (
                <button
                  onClick={() => open(doc)}
                  className="text-left font-medium text-ds-ink underline-offset-2 hover:underline"
                >
                  {doc.description}
                </button>
              ) : (
                <span className="font-medium text-ds-muted line-through">{doc.description}</span>
              )}
              {doc.status === "voided" && <Pill tone="alert">voided</Pill>}
            </div>
            <p className="mt-0.5 text-xs text-ds-muted">
              {doc.originalFilename} · {formatSize(doc.sizeBytes)}
              {doc.uploadedAt && (
                <>
                  {" "}
                  · uploaded <Timestamp at={doc.uploadedAt} />
                </>
              )}{" "}
              by{" "}
              {doc.uploadedByName}
              {doc.consentFormName && ` · scan of “${doc.consentFormName}”`}
            </p>
            {doc.voidReason && (
              <p className="mt-1 text-xs text-state-alert">Voided: {doc.voidReason}</p>
            )}
            {writable && record.canWrite && doc.status === "uploaded" && (
              <button
                disabled={busy}
                onClick={() => voidDoc(doc)}
                className="nmbm-btn nmbm-btn--danger nmbm-btn--sm mt-1"
              >
                Void
              </button>
            )}
          </li>
        ))}
      </ul>

      {voidedCount > 0 && (
        <button
          onClick={() => setShowVoided((v) => !v)}
          className="mt-2 text-xs text-ds-muted underline-offset-2 hover:underline"
        >
          {showVoided ? "Hide voided" : `Show voided (${voidedCount})`}
        </button>
      )}

      {adding && (
        <div className="nmbm-card nmbm-card--dense mt-3">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              File
              <input
                ref={fileInput}
                type="file"
                accept={DOCUMENT_CONTENT_TYPES.join(",")}
                onChange={(e) => {
                  const chosen = e.target.files?.[0] ?? null;
                  setFile(chosen);
                  if (chosen && !description) setDescription(chosen.name.replace(/\.[^.]+$/, ""));
                }}
                className="text-sm"
              />
            </label>
            {fileProblem && <p className="text-xs text-state-alert">{fileProblem}</p>}
            <label className="flex flex-col gap-1 text-sm">
              What is it?
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Photo ID, proof of address"
                className="nmbm-control"
              />
            </label>
            {record.consents.length > 0 && (
              <label className="flex flex-col gap-1 text-sm">
                Scan of a consent form? (optional)
                <select
                  value={consentId}
                  onChange={(e) => setConsentId(e.target.value)}
                  className="nmbm-control nmbm-select"
                >
                  <option value="">No — a different document</option>
                  {record.consents.map((consent) => (
                    <option key={consent.id} value={consent.id}>
                      {consent.formName} (signed <DateText value={consent.signedDate} />)
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="text-xs text-ds-muted">
              PDF or photo, up to 10 MB. Opening a document is recorded in the audit log.
            </p>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              disabled={busy || !file || !!fileProblem || !description.trim()}
              onClick={upload}
              className="nmbm-btn nmbm-btn--dark nmbm-btn--md"
            >
              {busy ? "Uploading…" : "Upload"}
            </button>
            <button
              disabled={busy}
              onClick={reset}
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
