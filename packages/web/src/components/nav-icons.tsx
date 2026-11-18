// Line icons for the side navigation, drawn on a 24px grid with a 1.5px
// stroke so they sit with Public Sans at 14px. The design system has no
// icon set; these are plain shapes, kept here so a collapsed rail still
// tells one destination from another.
const PATHS = {
  today: "M3 10.5 12 3l9 7.5M5.5 9v11h13V9M10 20v-6h4v6",
  clients: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8",
  programs: "M4 5h16v15H4zM4 9.5h16M8.5 3v4M15.5 3v4M8 13h3M8 16.5h3M13.5 13h3",
  housing: "M4 20V10l8-6 8 6v10M4 20h16M9.5 20v-5.5h5V20",
  referrals: "M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z",
  followUps: "M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z",
  carePlans: "M9 4h6v3H9zM9 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-3M8.5 12.5l2 2 4-4.5",
  notes: "M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM14.5 3v4.5H19M8.5 12h7M8.5 15.5h7",
  forms: "M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4",
  staff: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7.5 17a4.5 4.5 0 0 1 9 0",
  feedback: "M4 5h16v11H9l-5 4Z",
  permissions: "M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6Zm-2.5 9 2 2 4-4.5",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5l1.6 1.2-2 3.5-1.9-.7a7 7 0 0 1-1.9 1.1L15 20.5h-4l-.3-1.9a7 7 0 0 1-1.9-1.1l-1.9.7-2-3.5 1.6-1.2a7 7 0 0 1 0-3l-1.6-1.2 2-3.5 1.9.7a7 7 0 0 1 1.9-1.1L11 3.5h4l.3 1.9a7 7 0 0 1 1.9 1.1l1.9-.7 2 3.5-1.6 1.2a7 7 0 0 1 0 3Z",
  report: "M5 21V4M5 4h11l-2 4 2 4H5",
  signOut: "M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10",
  collapse: "M15 6l-6 6 6 6",
  expand: "M9 6l6 6-6 6",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
} as const;

export type IconName = keyof typeof PATHS;

export function NavIcon({ name, className = "ds-side__icon" }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
