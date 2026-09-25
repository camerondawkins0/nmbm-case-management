import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { SearchResult } from "../lib/types.js";

// Accepts what people actually type for a birthday: 1981-04-03, or
// 4/3/1981 as it's written on US forms.
export function parseSearch(text: string): { q?: string; dob?: string } | null {
  const trimmed = text.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { dob: trimmed };
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return { dob: `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` };
  return trimmed.length >= 2 ? { q: trimmed } : null;
}

// R10 readmission search. The server returns only records the person
// searching could open, so what's shown here is never a leak.
export function useParticipantSearch(query: { q?: string; dob?: string } | null) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const key = query ? `${query.q ?? ""}|${query.dob ?? ""}` : "";

  useEffect(() => {
    if (!query) {
      setResults(null);
      return;
    }
    let cancelled = false;
    // Wait for a pause in typing rather than querying every keystroke.
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (query.q) params.set("q", query.q);
      if (query.dob) params.set("dob", query.dob);
      api<SearchResult[]>(`/api/participants/search?${params}`)
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return results;
}

export function SearchResults({ results, compact = false }: { results: SearchResult[]; compact?: boolean }) {
  if (results.length === 0) {
    return <p className="py-3 text-sm text-nmbm-ink/50">No matching records you can open.</p>;
  }
  return (
    <ul className="divide-y divide-nmbm-ink/5 rounded border border-nmbm-ink/10">
      {results.map((r) => (
        <li key={r.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 ${compact ? "py-2" : "py-3"} text-sm`}>
          <span>
            <Link to={`/participants/${r.id}`} className="font-medium text-nmbm-ink hover:underline">
              {r.firstName} {r.lastName}
            </Link>
            <span className="ml-2 text-xs text-nmbm-ink/50">born {r.dateOfBirth}</span>
          </span>
          <span className="text-xs text-nmbm-ink/60">
            {r.active
              ? `Active${r.workerName ? ` · ${r.workerName}` : ""}`
              : `Closed ${r.lastEndDate ?? ""} · open to readmit`}
          </span>
        </li>
      ))}
    </ul>
  );
}
