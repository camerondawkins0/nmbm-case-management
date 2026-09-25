import { describe, it, expect } from "vitest";
import { noContactState, carePlanState, participantFlags, needsAttention, type ParticipantRuleInput } from "../src/lib/rules.js";
import { participationOutcome } from "../src/modules/programs/service.js";
import { effectiveStatus } from "../src/modules/consents/service.js";
import { safeReturnTo } from "../src/plugins/auth.js";
import { isoDaysAgo } from "./support/fixtures.js";

const base: ParticipantRuleInput = {
  episodeId: "episode",
  payer: "medi_cal",
  consecutiveNoContacts: 0,
  carePlanId: "plan",
  carePlanStatus: "approved",
  carePlanDueDate: isoDaysAgo(-20),
  carePlanReviewDue: isoDaysAgo(-7),
  disenrollmentLetterSentAt: null,
};

describe("M6 no-contact ladder", () => {
  it("warns at three consecutive misses, and not before", () => {
    expect(noContactState({ ...base, consecutiveNoContacts: 2 }).warning).toBe(false);
    const three = noContactState({ ...base, consecutiveNoContacts: 3 });
    expect(three.warning).toBe(true);
    expect(three.disenrollmentEligible).toBe(false);
    expect(three.attemptsUntilDisenrollment).toBe(2);
  });

  it("allows disenrolment at five", () => {
    const five = noContactState({ ...base, consecutiveNoContacts: 5 });
    expect(five.disenrollmentEligible).toBe(true);
    expect(five.attemptsUntilDisenrollment).toBe(0);
  });

  it("requires the warning letter for Molina, and only for Molina", () => {
    expect(noContactState({ ...base, payer: "molina", consecutiveNoContacts: 3 }).molinaLetterRequired).toBe(true);
    expect(noContactState({ ...base, payer: "medi_cal", consecutiveNoContacts: 3 }).molinaLetterRequired).toBe(false);
    expect(noContactState({ ...base, payer: "molina", consecutiveNoContacts: 2 }).molinaLetterRequired).toBe(false);
  });

  it("stops requiring the letter once it's recorded", () => {
    const sent = noContactState({ ...base, payer: "molina", consecutiveNoContacts: 4, disenrollmentLetterSentAt: new Date() });
    expect(sent.molinaLetterRequired).toBe(false);
  });
});

describe("M9 care plan clocks", () => {
  it("counts down to the 30-day deadline only while there's no plan", () => {
    const none = carePlanState({ ...base, carePlanId: null, carePlanStatus: null, carePlanDueDate: isoDaysAgo(-5) });
    expect(none.missing).toBe(true);
    expect(none.daysUntilCompletionDue).toBe(5);
    expect(none.completionOverdue).toBe(false);
    expect(carePlanState({ ...base, carePlanId: null, carePlanStatus: null, carePlanDueDate: isoDaysAgo(1) }).completionOverdue).toBe(true);
  });

  it("runs the two-week review clock independently of the deadline", () => {
    const due = carePlanState({ ...base, carePlanReviewDue: isoDaysAgo(0), carePlanDueDate: isoDaysAgo(40) });
    expect(due.reviewOverdue).toBe(true);
    // A plan exists, so the missed completion deadline no longer applies.
    expect(due.completionOverdue).toBe(false);
  });

  // R10: nothing is due on a closed record.
  it("flags nothing when there is no open episode", () => {
    const closed = { ...base, episodeId: null, carePlanId: null, carePlanStatus: null, carePlanDueDate: null, carePlanReviewDue: null };
    const flags = participantFlags(closed);
    expect(flags.carePlan.missing).toBe(false);
    expect(needsAttention(flags)).toBe(false);
  });
});

describe("M14 participation outcome", () => {
  // The case that was once reported as a failure to a court: perfect
  // attendance, part way through the course.
  it("reports perfect attendance part-way through as in progress, not short", () => {
    expect(participationOutcome({ requiredSessions: 12, attended: 7, sessionsHeld: 7 })).toBe("in_progress");
  });

  it("reports short only once enough sessions have been held to know", () => {
    expect(participationOutcome({ requiredSessions: 12, attended: 8, sessionsHeld: 12 })).toBe("short");
    expect(participationOutcome({ requiredSessions: 12, attended: 12, sessionsHeld: 12 })).toBe("met");
  });

  it("makes no judgement when no requirement has been set", () => {
    expect(participationOutcome({ requiredSessions: null, attended: 3, sessionsHeld: 6 })).toBe("no_requirement");
  });
});

describe("M16 consent status", () => {
  it("is expired by date even when nothing has updated the row", () => {
    expect(effectiveStatus({ revokedAt: null, expiresDate: isoDaysAgo(1) })).toBe("expired");
    expect(effectiveStatus({ revokedAt: null, expiresDate: isoDaysAgo(-1) })).toBe("active");
  });

  it("reports a revocation over an expiry date", () => {
    expect(effectiveStatus({ revokedAt: new Date(), expiresDate: isoDaysAgo(-100) })).toBe("revoked");
  });
});

describe("sign-in return path", () => {
  it.each([
    ["/participants/abc", "/participants/abc"],
    ["/programs?x=1", "/programs?x=1"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["/auth/logout", "/"],
    ["/login", "/"],
    [undefined, "/"],
  ])("%j → %j", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
