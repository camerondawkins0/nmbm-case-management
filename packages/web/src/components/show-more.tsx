import { useState } from "react";

// A long list on the record shows its latest entries and says how many more
// there are, so the page stays short without anything being out of reach.
export function useShowMore<T>(items: T[], first = 10, startOpen = false) {
  const [all, setAll] = useState(startOpen);
  const shown = all ? items : items.slice(0, first);
  const hidden = items.length - shown.length;
  const toggle =
    items.length > first ? (
      <button type="button" onClick={() => setAll((a) => !a)} className="nmbm-btn nmbm-btn--quiet nmbm-btn--sm mt-2 self-start">
        {all ? `Show the latest ${first}` : `Show all ${items.length} (${hidden} more)`}
      </button>
    ) : null;
  return { shown, toggle, showAll: () => setAll(true) };
}
