import { Link, useLocation } from "react-router-dom";
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
    { to: "/programs", label: "Programmes" },
    ...(can(me, "follow_ups.record") || can(me, "participants.read.closed")
      ? [{ to: "/follow-ups", label: "Follow-ups" }]
      : []),
    ...(can(me, "care_plans.approve") ? [{ to: "/care-plans/review", label: "Care plans" }] : []),
    ...(can(me, "notes.approve") ? [{ to: "/notes/review", label: "Notes" }] : []),
    ...(can(me, "admin.users.manage") ? [{ to: "/admin/users", label: "Staff" }] : []),
    ...(can(me, "feedback.manage") ? [{ to: "/admin/feedback", label: "Feedback" }] : []),
    ...(can(me, "admin.settings.manage") ? [{ to: "/admin/settings", label: "Settings" }] : []),
  ];

  return (
    <div className="min-h-screen bg-nmbm-paper">
      <header className="border-b border-nmbm-ink/10">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <BrandMark size={34} />
            <span className="font-semibold tracking-wide text-nmbm-ink">NMBM</span>
          </Link>

          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {links.map((link) => {
              const active = pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`rounded px-3 py-1.5 transition ${
                    active
                      ? "bg-nmbm-ink text-nmbm-paper"
                      : "text-nmbm-ink/70 hover:bg-nmbm-ink/5 hover:text-nmbm-ink"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link to="/feedback" className="text-nmbm-ink/60 underline-offset-2 hover:underline">
              Report an issue
            </Link>
            <span className="hidden text-right sm:block">
              <span className="block leading-tight text-nmbm-ink">{me.displayName}</span>
              <span className="block text-xs leading-tight text-nmbm-ink/50">
                {me.roles.map((r) => r.label).join(", ")}
              </span>
            </span>
            <SignOutButton className="rounded border border-nmbm-ink/20 px-3 py-1 text-nmbm-ink/70 transition hover:border-nmbm-ink hover:text-nmbm-ink" />
          </div>
        </div>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  );
}
