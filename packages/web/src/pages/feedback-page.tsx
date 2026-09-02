import { useEffect, useState } from "react";
import type { FeedbackCategory, FeedbackStatus } from "@nmbm/shared";
import { BrandMark } from "../components/brand-mark.js";

type FeedbackItem = {
  id: string;
  category: FeedbackCategory;
  subject: string;
  description: string;
  status: FeedbackStatus;
  createdAt: string;
};

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Something's broken",
  feature_request: "Feature request",
  question: "Question",
  other: "Other",
};

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "Received",
  in_review: "In review",
  resolved: "Resolved",
  wont_fix: "Not planned",
};

// Submission form + the submitter's own ticket history. There's no
// in-app queue for triage — NMBM has no dedicated IT/dev staff (M31),
// so review happens externally. See docs/SUPPORT.md.
export default function FeedbackPage() {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<FeedbackItem[]>([]);

  async function loadMine() {
    const res = await fetch("/api/feedback/mine", { credentials: "include" });
    if (res.ok) setMine(await res.json());
  }

  useEffect(() => {
    loadMine();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subject, description }),
      });
      if (!res.ok) throw new Error(`Submit failed (${res.status})`);
      setSubject("");
      setDescription("");
      await loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-nmbm-paper">
      <header className="flex items-center gap-3 border-b border-nmbm-ink/10 px-6 py-4">
        <BrandMark size={36} />
        <span className="font-semibold tracking-wide text-nmbm-ink">
          Report an issue or leave feedback
        </span>
      </header>

      <main className="mx-auto max-w-xl px-6 py-8">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-nmbm-ink">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
              className="rounded border border-nmbm-ink/20 px-3 py-2"
            >
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-nmbm-ink">
            Subject
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              maxLength={200}
              className="rounded border border-nmbm-ink/20 px-3 py-2"
              placeholder="Short summary"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-nmbm-ink">
            Details
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={6}
              className="rounded border border-nmbm-ink/20 px-3 py-2"
              placeholder="What happened, or what you'd like to see? Screenshots aren't attachable here yet — describe what you saw."
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded bg-nmbm-ink px-6 py-2 text-sm font-medium text-nmbm-paper transition hover:bg-nmbm-ink/80 disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Send"}
          </button>
        </form>

        {mine.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-nmbm-ink/60">
              Your reports
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {mine.map((item) => (
                <li
                  key={item.id}
                  className="rounded border border-nmbm-ink/10 px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-nmbm-ink">{item.subject}</span>
                    <span className="text-xs uppercase tracking-wide text-nmbm-gold-dark">
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <span className="text-xs text-nmbm-ink/50">
                    {CATEGORY_LABELS[item.category]} ·{" "}
                    {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
