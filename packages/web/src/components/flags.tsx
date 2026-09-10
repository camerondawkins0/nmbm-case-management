import { Link } from "react-router-dom";
import type { CarePlanFlags, NoContactFlags } from "../lib/types.js";

export function Pill({
  tone,
  children,
}: {
  tone: "alert" | "warn" | "ok" | "muted";
  children: React.ReactNode;
}) {
  const tones = {
    alert: "bg-state-alert-bg text-state-alert",
    warn: "bg-state-warn-bg text-state-warn",
    ok: "bg-state-ok-bg text-state-ok",
    muted: "bg-nmbm-ink/5 text-nmbm-ink/60",
  } as const;
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

// M6: the count on its own doesn't tell a worker what to do next, so
// the pill says where they are on the ladder.
export function NoContactPill({ flags }: { flags: NoContactFlags }) {
  if (flags.count === 0) return null;
  if (flags.disenrollmentEligible) {
    return <Pill tone="alert">{flags.count} missed · disenrolment allowed</Pill>;
  }
  if (flags.warning) {
    return (
      <Pill tone="warn">
        {flags.count} missed · {flags.attemptsUntilDisenrollment} more before disenrolment
      </Pill>
    );
  }
  return <Pill tone="muted">{flags.count} missed</Pill>;
}

export function MolinaLetterPill({ flags }: { flags: NoContactFlags }) {
  if (!flags.molinaLetterRequired) return null;
  return <Pill tone="alert">Molina letter due</Pill>;
}

// M9: both clocks can be saying something at once, so this renders a
// list rather than picking a single "worst" status.
export function CarePlanPills({ flags }: { flags: CarePlanFlags }) {
  const pills: React.ReactNode[] = [];

  if (flags.missing) {
    if (flags.completionOverdue) {
      pills.push(
        <Pill key="overdue" tone="alert">
          No care plan · {flags.completionDueDate} passed
        </Pill>,
      );
    } else if (flags.daysUntilCompletionDue !== null) {
      pills.push(
        <Pill key="due" tone="warn">
          Care plan due in {flags.daysUntilCompletionDue} days
        </Pill>,
      );
    }
  } else {
    if (flags.awaitingApproval) pills.push(<Pill key="review" tone="muted">Awaiting approval</Pill>);
    if (flags.needsRevision) pills.push(<Pill key="revise" tone="warn">Returned for revision</Pill>);
    if (flags.reviewOverdue) pills.push(<Pill key="rev" tone="warn">Review due</Pill>);
    if (!flags.awaitingApproval && !flags.needsRevision && !flags.reviewOverdue) {
      pills.push(<Pill key="ok" tone="ok">Plan current</Pill>);
    }
  }

  return <div className="flex flex-wrap gap-1.5">{pills}</div>;
}

export function ParticipantLink({
  id,
  firstName,
  lastName,
}: {
  id: string;
  firstName: string;
  lastName: string;
}) {
  return (
    <Link to={`/participants/${id}`} className="font-medium text-nmbm-ink hover:underline">
      {firstName} {lastName}
    </Link>
  );
}
