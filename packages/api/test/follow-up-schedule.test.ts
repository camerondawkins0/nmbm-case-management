import { describe, it, expect } from "vitest";
import { addMonths, followUpSchedule, type CallRecord } from "../src/lib/follow-ups.js";

const call = (milestoneMonths: number, outcome: CallRecord["outcome"], day = "2026-04-01"): CallRecord => ({
  id: `${milestoneMonths}-${outcome}`,
  milestoneMonths,
  outcome,
  note: null,
  servicesFeedback: null,
  calledAt: new Date(`${day}T12:00:00Z`),
  calledByName: "QA",
});

const stateOf = (months: number, endDate: string, calls: CallRecord[], today: string) =>
  followUpSchedule(endDate, calls, today).find((m) => m.months === months)!;

describe("M12 schedule arithmetic", () => {
  it("counts calendar months, clamped to a short month's last day", () => {
    expect(addMonths("2026-01-15", 3)).toBe("2026-04-15");
    expect(addMonths("2025-08-31", 3)).toBe("2025-11-30");
    expect(addMonths("2025-11-30", 3)).toBe("2026-02-28");
    expect(addMonths("2026-10-10", 5)).toBe("2027-03-10");
  });

  it("puts the four calls at 3, 5, 9 and 12 months", () => {
    const due = followUpSchedule("2026-01-10", [], "2026-01-11").map((m) => [m.months, m.dueDate]);
    expect(due).toEqual([
      [3, "2026-04-10"],
      [5, "2026-06-10"],
      [9, "2026-10-10"],
      [12, "2027-01-10"],
    ]);
  });
});

describe("M12 milestone states", () => {
  const end = "2026-01-10"; // 3-month call due 2026-04-10

  it("is upcoming until two weeks before the due date", () => {
    expect(stateOf(3, end, [], "2026-03-26").state).toBe("upcoming");
    expect(stateOf(3, end, [], "2026-03-27").state).toBe("due");
  });

  it("stays due for two weeks after, then is overdue", () => {
    expect(stateOf(3, end, [], "2026-04-24").state).toBe("due");
    expect(stateOf(3, end, [], "2026-04-25").state).toBe("overdue");
  });

  it("lapses when the next call falls due, and the last one at 15 months", () => {
    expect(stateOf(3, end, [], "2026-06-09").state).toBe("overdue");
    expect(stateOf(3, end, [], "2026-06-10").state).toBe("lapsed");
    expect(stateOf(12, end, [], "2027-04-10").state).toBe("lapsed");
  });

  it("isn't settled by an unanswered attempt", () => {
    expect(stateOf(3, end, [call(3, "no_answer")], "2026-04-12").state).toBe("due");
  });

  it("is settled by a reached, declined or wrong-number call — and only for its own milestone", () => {
    for (const outcome of ["reached_doing_well", "reached_wants_services", "declined", "wrong_number"] as const) {
      const schedule = followUpSchedule(end, [call(3, outcome)], "2026-06-12");
      expect(schedule[0].state).toBe("completed");
      expect(schedule[1].state).toBe("due");
    }
  });

  it("keeps every attempt, oldest first, and the result", () => {
    const m = stateOf(3, end, [call(3, "reached_doing_well", "2026-04-20"), call(3, "no_answer", "2026-04-11")], "2026-04-21");
    expect(m.attempts.map((a) => a.outcome)).toEqual(["no_answer", "reached_doing_well"]);
    expect(m.result?.outcome).toBe("reached_doing_well");
  });
});
