import {
  FOLLOW_UP_MONTHS,
  FOLLOW_UP_COMPLETING,
  FOLLOW_UP_EARLY_DAYS,
  FOLLOW_UP_FINAL_LAPSE_MONTHS,
  type FollowUpMonths,
  type FollowUpOutcome,
} from "@nmbm/shared";

export type MilestoneState = "upcoming" | "due" | "overdue" | "completed" | "lapsed";

export type CallRecord = {
  id: string;
  milestoneMonths: number;
  outcome: FollowUpOutcome;
  note: string | null;
  servicesFeedback: string | null;
  calledAt: Date;
  calledByName: string;
};

export type Milestone = {
  months: FollowUpMonths;
  dueDate: string;
  // First day a call counts toward this milestone.
  opensOn: string;
  // After this, a milestone that never got a result drops out of the
  // queue — the next call is the one worth making.
  lapsesOn: string;
  state: MilestoneState;
  result: CallRecord | null;
  attempts: CallRecord[];
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Calendar months, clamped to the end of a short month: a case closed on
// 31 August has its 3-month call on 30 November, not 1 December.
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// M12's schedule for one closed episode, worked out from its end date
// every time it's asked for — nothing about it is stored, so it can't
// disagree with the episode. "Due" is two weeks either side of the date;
// after that it's overdue until the next milestone arrives.
export function followUpSchedule(endDate: string, calls: CallRecord[], today = todayIso()): Milestone[] {
  return FOLLOW_UP_MONTHS.map((months, index) => {
    const dueDate = addMonths(endDate, months);
    const opensOn = addDays(dueDate, -FOLLOW_UP_EARLY_DAYS);
    const next = FOLLOW_UP_MONTHS[index + 1];
    const lapsesOn = addMonths(endDate, next ?? FOLLOW_UP_FINAL_LAPSE_MONTHS);
    const attempts = calls
      .filter((c) => c.milestoneMonths === months)
      .sort((a, b) => a.calledAt.getTime() - b.calledAt.getTime());
    const result = attempts.find((c) => FOLLOW_UP_COMPLETING.includes(c.outcome)) ?? null;

    let state: MilestoneState;
    if (result) state = "completed";
    else if (today >= lapsesOn) state = "lapsed";
    else if (today < opensOn) state = "upcoming";
    else if (today <= addDays(dueDate, FOLLOW_UP_EARLY_DAYS)) state = "due";
    else state = "overdue";

    return { months, dueDate, opensOn, lapsesOn, state, result, attempts };
  });
}
