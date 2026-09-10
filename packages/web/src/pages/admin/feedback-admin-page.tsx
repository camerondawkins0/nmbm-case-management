import { useEffect, useState } from "react";
import type { FeedbackCategory, FeedbackStatus } from "@nmbm/shared";

type FeedbackItem = {
  id: string;
  category: FeedbackCategory;
  subject: string;
  description: string;
  status: FeedbackStatus;
  resolutionNote: string | null;
  createdAt: string;
};

const STATUS_OPTIONS: FeedbackStatus[] = ["open", "in_review", "resolved", "wont_fix"];

// Requires feedback.manage server-side (packages/api/src/modules/feedback/routes.ts)
// — a 403 here means the account isn't the queue's admin, not a bug.
// This is a raw internal queue, not the external triage workflow itself:
// see docs/SUPPORT.md for how Cameron reviews and summarizes this list.
export default function FeedbackAdminPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/feedback", { credentials: "include" });
    if (res.status === 403) {
      setError("You don't have access to the feedback queue.");
      return;
    }
    if (res.ok) setItems(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function updateStatus(id: string, status: FeedbackStatus) {
    setSavingId(id);
    try {
      await fetch(`/api/feedback/${id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await load();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold text-nmbm-ink">Feedback queue</h1>
      <div className="mt-6">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-nmbm-ink/10 text-left text-xs uppercase tracking-wide text-nmbm-ink/50">
                <th className="py-2 pr-4">Subject</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Submitted</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-nmbm-ink/5 align-top">
                  <td className="py-2 pr-4">
                    <div className="font-medium text-nmbm-ink">{item.subject}</div>
                    <div className="max-w-md text-nmbm-ink/60">{item.description}</div>
                  </td>
                  <td className="py-2 pr-4">{item.category}</td>
                  <td className="py-2 pr-4">{new Date(item.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">
                    <select
                      value={item.status}
                      disabled={savingId === item.id}
                      onChange={(e) => updateStatus(item.id, e.target.value as FeedbackStatus)}
                      className="rounded border border-nmbm-ink/20 px-2 py-1"
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
