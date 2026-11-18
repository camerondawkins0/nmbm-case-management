import { useRef } from "react";

export type TabDef = { id: string; label: string; badge?: React.ReactNode };

// Tabs as the ARIA pattern has them: arrow keys, Home and End move between
// tabs and open the one they land on, and only the open tab is in the Tab
// order, so the keyboard reaches the panel in one press, not one per tab.
export function TabList({
  tabs,
  active,
  onChange,
  idPrefix,
  label,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  idPrefix: string;
  label: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === active);
    const next =
      e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  }

  return (
    <div className="ds-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-selected={t.id === active}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={t.id === active ? 0 : -1}
          onClick={() => onChange(t.id)}
          className="ds-tab"
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

// Every panel stays mounted and the closed ones are hidden, so a note half
// written on one tab is still there after a look at another.
export function TabPanel({
  id,
  active,
  idPrefix,
  children,
}: {
  id: string;
  active: string;
  idPrefix: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      hidden={id !== active}
      tabIndex={0}
      className="ds-tabpanel"
    >
      {children}
    </div>
  );
}
