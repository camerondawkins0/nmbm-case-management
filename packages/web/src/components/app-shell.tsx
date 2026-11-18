import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { applyTheme, storedTheme, THEMES, type ThemeId } from "../lib/theme.js";
import { BrandMark } from "./brand-mark.js";
import { NavIcon, type IconName } from "./nav-icons.js";
import { SignOutButton } from "./sign-out-button.js";
import { can } from "../lib/use-me.js";
import { PARTICIPANT_LABEL_PLURAL } from "@nmbm/shared";
import type { Me } from "../lib/types.js";

type NavLink = { to: string; label: string; icon: IconName };
type NavSection = { label: string | null; links: NavLink[] };

// A page and the pages under it: a client's record keeps Clients lit, a form
// being built keeps Forms lit.
const isActive = (pathname: string, to: string) =>
  to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);

// Collapsed or not is a choice for whoever uses this browser, like the theme.
const COLLAPSED_KEY = "nmbm-nav-collapsed";
function storedCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}
function storeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Storage blocked: it still applies for this visit.
  }
}

function sections(me: Me): NavSection[] {
  const only = (permission: boolean, link: NavLink) => (permission ? [link] : []);
  const all: NavSection[] = [
    {
      label: null,
      links: [
        { to: "/", label: "Today", icon: "today" },
        { to: "/participants", label: PARTICIPANT_LABEL_PLURAL, icon: "clients" },
        { to: "/programs", label: "Programs", icon: "programs" },
        ...only(
          ["housing.write", "housing.authorizations", "housing.deposits.approve", "housing.export"].some((p) => can(me, p)),
          { to: "/housing", label: "Housing", icon: "housing" },
        ),
        ...only(can(me, "incoming_referrals.manage"), { to: "/referrals-in", label: "Referrals in", icon: "referrals" }),
        ...only(can(me, "follow_ups.record") || can(me, "participants.read.closed"), {
          to: "/follow-ups",
          label: "Follow-ups",
          icon: "followUps",
        }),
      ],
    },
    {
      label: "Review",
      links: [
        ...only(can(me, "care_plans.approve"), { to: "/care-plans/review", label: "Care plans", icon: "carePlans" }),
        ...only(can(me, "notes.approve"), { to: "/notes/review", label: "Notes", icon: "notes" }),
      ],
    },
    {
      label: "Admin",
      links: [
        ...only(can(me, "assessments.manage"), { to: "/admin/forms", label: "Forms", icon: "forms" }),
        ...only(can(me, "admin.users.manage"), { to: "/admin/users", label: "Staff", icon: "staff" }),
        ...only(can(me, "feedback.manage"), { to: "/admin/feedback", label: "Feedback", icon: "feedback" }),
        ...only(can(me, "admin.roles.manage"), { to: "/admin/permissions", label: "Permissions", icon: "permissions" }),
        ...only(can(me, "admin.settings.manage"), { to: "/admin/settings", label: "Settings", icon: "settings" }),
      ],
    },
  ];
  return all.filter((s) => s.links.length > 0);
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

// The frame of every signed-in page: navigation down the left, the full
// height of the window and scrolling on its own, so it stays put however
// long the page beside it is. It folds to a rail of icons for more room,
// and on a phone it is a drawer behind a menu button.
export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navId = useId();
  const drawerButton = useRef<HTMLButtonElement>(null);

  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrawerOpen(false);
      drawerButton.current?.focus();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [drawerOpen]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      storeCollapsed(!c);
      return !c;
    });
  }

  const roles = me.roles.map((r) => r.label).join(", ");

  return (
    <div className={`ds-app${collapsed ? " is-collapsed" : ""}${drawerOpen ? " is-drawer-open" : ""}`}>
      <a href="#main" className="ds-skip">
        Skip to content
      </a>

      {/* Phone: a bar with the menu button; the side navigation is a drawer. */}
      <header className="ds-topbar print:hidden">
        <button
          ref={drawerButton}
          type="button"
          className="ds-side__button"
          aria-expanded={drawerOpen}
          aria-controls={navId}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <NavIcon name={drawerOpen ? "close" : "menu"} />
          <span className="nmbm-sr">{drawerOpen ? "Close navigation" : "Open navigation"}</span>
        </button>
        <Link to="/" className="ds-topbar__brand" aria-label="NMBM Case Management, home">
          <BrandMark size={32} />
          <span className="ds-side__product">Case Management</span>
        </Link>
      </header>
      <div className="ds-scrim print:hidden" aria-hidden="true" onClick={() => setDrawerOpen(false)} />

      <aside id={navId} className="ds-side print:hidden" aria-label="Navigation">
        <div className="ds-side__head">
          <Link to="/" className="ds-side__brand" aria-label="NMBM Case Management, home" title={collapsed ? "Home" : undefined}>
            <BrandMark size={collapsed ? 36 : 44} />
            {/* The product's name, not "NMBM" again: the logo already says that. */}
            <span className="ds-side__product">Case Management</span>
          </Link>
        </div>

        <nav aria-label="Main" className="ds-side__nav">
          {sections(me).map((section) => (
            <div key={section.label ?? "main"} className="ds-side__section">
              {section.label && <p className="ds-side__label">{section.label}</p>}
              <ul>
                {section.links.map((link) => {
                  const active = isActive(pathname, link.to);
                  return (
                    <li key={link.to}>
                      <Link
                        to={link.to}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? link.label : undefined}
                        className={`ds-side__link${active ? " is-active" : ""}`}
                      >
                        <NavIcon name={link.icon} />
                        <span className="ds-side__text">{link.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="ds-side__foot">
          <Link to="/feedback" className="ds-side__link" title={collapsed ? "Report an issue" : undefined}>
            <NavIcon name="report" />
            <span className="ds-side__text">Report an issue</span>
          </Link>

          <AccountMenu name={me.displayName} roles={roles} collapsed={collapsed} />

          {/* Never inside a menu: on a shared computer, signing out should not
              be a step someone has to go looking for. */}
          <SignOutButton formClassName="block" className="ds-side__link w-full" title={collapsed ? "Sign out" : undefined}>
            <NavIcon name="signOut" />
            <span className="ds-side__text">Sign out</span>
          </SignOutButton>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls={navId}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : undefined}
            className="ds-side__link ds-side__collapse"
          >
            <NavIcon name={collapsed ? "expand" : "collapse"} />
            <span className="ds-side__text">Collapse</span>
          </button>
        </div>
      </aside>

      <main id="main" tabIndex={-1} className="ds-app__main print:p-0">
        {children}
      </main>
    </div>
  );
}

// Who is signed in, and the theme. A disclosure (a button and a panel), not
// an ARIA menu: the panel holds a labelled select that Tab reaches as
// anywhere else. It closes on Escape, a click or focus outside, and when the
// page changes.
function AccountMenu({ name, roles, collapsed }: { name: string; roles: string; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    // Captured, so Escape closes this panel and not the phone drawer
    // it sits in as well.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return (
    <div ref={root} className="ds-account-menu">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${name}, ${roles}: account and theme`}
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? `${name} (${roles})` : undefined}
        className="ds-side__link ds-account"
      >
        <span className="ds-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="ds-side__text ds-account__who">
          <span className="nmbm-shell__name">{name}</span>
          <span className="nmbm-shell__roles">{roles}</span>
        </span>
      </button>
      <div id={id} className="ds-account-menu__panel" hidden={!open}>
        <p className="ds-account-menu__who">
          <span className="nmbm-shell__name">{name}</span>
          <span className="nmbm-shell__roles">{roles}</span>
        </p>
        <ThemePicker />
      </div>
    </div>
  );
}

// Light, dark (the brand's gold-on-black) or high contrast, for this browser.
function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(storedTheme);
  return (
    <label className="ds-field">
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
