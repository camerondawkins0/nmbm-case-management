import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { applyTheme, storedTheme, THEMES, type ThemeId } from "../lib/theme.js";
import { BrandMark } from "./brand-mark.js";
import { SignOutButton } from "./sign-out-button.js";
import { can } from "../lib/use-me.js";
import { PARTICIPANT_LABEL_PLURAL } from "@nmbm/shared";
import type { Me } from "../lib/types.js";

export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const { pathname } = useLocation();

  const links = [
    { to: "/", label: "Today" },
    { to: "/participants", label: PARTICIPANT_LABEL_PLURAL },
    { to: "/programs", label: "Programs" },
    ...(["housing.write", "housing.authorizations", "housing.deposits.approve", "housing.export"].some((p) => can(me, p))
      ? [{ to: "/housing", label: "Housing" }]
      : []),
    ...(can(me, "incoming_referrals.manage") ? [{ to: "/referrals-in", label: "Referrals in" }] : []),
    ...(can(me, "follow_ups.record") || can(me, "participants.read.closed")
      ? [{ to: "/follow-ups", label: "Follow-ups" }]
      : []),
    ...(can(me, "care_plans.approve") ? [{ to: "/care-plans/review", label: "Care plans" }] : []),
    ...(can(me, "notes.approve") ? [{ to: "/notes/review", label: "Notes" }] : []),
    ...(can(me, "assessments.manage") ? [{ to: "/admin/forms", label: "Forms" }] : []),
    ...(can(me, "admin.users.manage") ? [{ to: "/admin/users", label: "Staff" }] : []),
    ...(can(me, "feedback.manage") ? [{ to: "/admin/feedback", label: "Feedback" }] : []),
    ...(can(me, "admin.roles.manage") ? [{ to: "/admin/permissions", label: "Permissions" }] : []),
    ...(can(me, "admin.settings.manage") ? [{ to: "/admin/settings", label: "Settings" }] : []),
  ];

  return (
    <div className="nmbm-shell min-h-screen">
      {/* Printed pages — a participation record, an exported file — are
          documents in their own right; the app's navigation isn't part
          of them. */}
      <header className="nmbm-shell__bar print:hidden">
        <Link to="/" className="nmbm-shell__brand">
          <BrandMark size={40} />
          <span className="nmbm-shell__product">NMBM</span>
        </Link>

        <nav aria-label="Main" className="nmbm-shell__nav">
          {links.map((link) => {
            const active = pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                aria-current={active ? "page" : undefined}
                className={`nmbm-shell__link${active ? " is-active" : ""}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="nmbm-shell__end">
          <Link to="/feedback" className="nmbm-shell__link whitespace-nowrap">
            Report an issue
          </Link>
          <ThemePicker />
          <span className="nmbm-shell__user hidden sm:flex">
            <span className="nmbm-shell__name">{me.displayName}</span>
            <span className="nmbm-shell__roles">{me.roles.map((r) => r.label).join(", ")}</span>
          </span>
          <SignOutButton className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm" />
        </div>
      </header>
      <main className="nmbm-shell__main print:p-0">{children}</main>
    </div>
  );
}

// Light, dark (the brand's gold-on-black) or high contrast, for this browser.
function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(storedTheme);
  return (
    <label>
      <span className="nmbm-sr">Theme</span>
      <select
        value={theme}
        onChange={(e) => {
          const next = e.target.value as ThemeId;
          setTheme(next);
          applyTheme(next);
        }}
        className="nmbm-control nmbm-select"
        style={{ width: "auto", minHeight: 28, paddingTop: 3, paddingBottom: 3 }}
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
