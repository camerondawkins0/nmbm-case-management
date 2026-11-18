import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { applyTheme, storedTheme, THEMES, type ThemeId } from "../lib/theme.js";
import { BrandMark } from "./brand-mark.js";
import { SignOutButton } from "./sign-out-button.js";
import { can } from "../lib/use-me.js";
import { PARTICIPANT_LABEL_PLURAL } from "@nmbm/shared";
import type { Me } from "../lib/types.js";

type NavLink = { to: string; label: string };
type NavEntry = NavLink | { label: string; links: NavLink[] };

// A page and the pages under it: a client's record keeps Clients lit, a form
// being built keeps Forms lit.
const isActive = (pathname: string, to: string) =>
  to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);

// Two or more links of a kind fold into one menu, so the widest role (an
// administrator, a clinical director) fits the bar on one line; one link of a
// kind is just a link, since a menu holding one item hides it for nothing.
function group(label: string, links: NavLink[]): NavEntry[] {
  return links.length > 1 ? [{ label, links }] : links;
}

export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const only = (permission: boolean, link: NavLink) => (permission ? [link] : []);

  const entries: NavEntry[] = [
    { to: "/", label: "Today" },
    { to: "/participants", label: PARTICIPANT_LABEL_PLURAL },
    { to: "/programs", label: "Programs" },
    ...only(
      ["housing.write", "housing.authorizations", "housing.deposits.approve", "housing.export"].some((p) => can(me, p)),
      { to: "/housing", label: "Housing" },
    ),
    ...only(can(me, "incoming_referrals.manage"), { to: "/referrals-in", label: "Referrals in" }),
    ...only(can(me, "follow_ups.record") || can(me, "participants.read.closed"), {
      to: "/follow-ups",
      label: "Follow-ups",
    }),
    ...group("Review", [
      ...only(can(me, "care_plans.approve"), { to: "/care-plans/review", label: "Care plans" }),
      ...only(can(me, "notes.approve"), { to: "/notes/review", label: "Notes" }),
    ]),
    ...group("Admin", [
      ...only(can(me, "assessments.manage"), { to: "/admin/forms", label: "Forms" }),
      ...only(can(me, "admin.users.manage"), { to: "/admin/users", label: "Staff" }),
      ...only(can(me, "feedback.manage"), { to: "/admin/feedback", label: "Feedback" }),
      ...only(can(me, "admin.roles.manage"), { to: "/admin/permissions", label: "Permissions" }),
      ...only(can(me, "admin.settings.manage"), { to: "/admin/settings", label: "Settings" }),
    ]),
  ];

  return (
    <div className="nmbm-shell min-h-screen">
      {/* Printed pages — a participation record, an exported file — are
          documents in their own right; the app's navigation isn't part
          of them. */}
      <header className="nmbm-shell__bar print:hidden">
        <Link to="/" className="nmbm-shell__brand" aria-label="NMBM Case Management, home">
          <BrandMark size={40} />
          {/* The product's name, not "NMBM" again: the logo already says that.
              It shows from 1440px, where the widest role's links still fit
              beside it; below that the logo stands alone. */}
          <span className="nmbm-shell__product hidden min-[1440px]:inline">Case Management</span>
        </Link>

        <nav aria-label="Main" className="nmbm-shell__nav">
          {entries.map((entry) =>
            "links" in entry ? (
              <Menu
                key={entry.label}
                trigger={entry.label}
                triggerClassName={`nmbm-shell__link${entry.links.some((l) => isActive(pathname, l.to)) ? " is-active" : ""}`}
              >
                {entry.links.map((link) => (
                  <NavItem key={link.to} link={link} className="ds-menu__item" pathname={pathname} />
                ))}
              </Menu>
            ) : (
              <NavItem key={entry.to} link={entry} className="nmbm-shell__link" pathname={pathname} />
            ),
          )}
        </nav>

        <div className="nmbm-shell__end">
          {/* In the bar from 1280px; narrower, it moves into the name menu
              so the widest role still fits on one line at 1024px. */}
          <Link to="/feedback" className="nmbm-shell__link hidden whitespace-nowrap xl:inline">
            Report an issue
          </Link>
          <Menu
            align="end"
            triggerClassName="ds-account"
            trigger={
              <span className="nmbm-shell__user">
                <span className="nmbm-shell__name">{me.displayName}</span>
                <span className="nmbm-shell__roles hidden sm:block">{me.roles.map((r) => r.label).join(", ")}</span>
                <span className="nmbm-sr">, account menu</span>
              </span>
            }
          >
            <Link to="/feedback" className="ds-menu__item xl:hidden">
              Report an issue
            </Link>
            <ThemePicker />
          </Menu>
          {/* Kept out of the menu: on a shared computer, signing out should
              never be a step someone has to go looking for. */}
          <SignOutButton className="nmbm-btn nmbm-btn--secondary nmbm-btn--sm" />
        </div>
      </header>
      <main className="nmbm-shell__main print:p-0">{children}</main>
    </div>
  );
}

function NavItem({ link, className, pathname }: { link: NavLink; className: string; pathname: string }) {
  const active = isActive(pathname, link.to);
  return (
    <Link
      to={link.to}
      aria-current={active ? "page" : undefined}
      className={`${className}${active ? " is-active" : ""}`}
    >
      {link.label}
    </Link>
  );
}

// A disclosure (a button that shows and hides a panel), not an ARIA menu:
// the panel holds ordinary links and a select, which Tab reaches as anywhere
// else on the page. It closes on Escape, on a click or focus outside, and when
// the page changes.
function Menu({
  trigger,
  triggerClassName,
  align = "start",
  children,
}: {
  trigger: React.ReactNode;
  triggerClassName: string;
  align?: "start" | "end";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    // On a phone the bar wraps and a menu can sit at the right edge; nudge
    // the panel back on screen rather than let the page scroll sideways.
    const el = panel.current;
    if (el) {
      el.style.translate = "";
      const overflow = el.getBoundingClientRect().right - (window.innerWidth - 8);
      if (overflow > 0) el.style.translate = `${-overflow}px 0`;
    }
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={root} className={`ds-menu${align === "end" ? " ds-menu--end" : ""}`}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`ds-menu__trigger ${triggerClassName}`}
      >
        {trigger}
        <svg className="ds-menu__chevron" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <div ref={panel} id={id} className="ds-menu__panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

// Light, dark (the brand's gold-on-black) or high contrast, for this browser.
function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(storedTheme);
  return (
    <label className="ds-field ds-menu__field">
      Theme
      <select
        value={theme}
        onChange={(e) => {
          const next = e.target.value as ThemeId;
          setTheme(next);
          applyTheme(next);
        }}
        className="nmbm-control"
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
