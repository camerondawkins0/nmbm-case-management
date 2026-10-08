import { z } from "zod";

// M11: NMBM use no licensed instruments ("we will use paper copies"), so
// this is a form engine for their own forms — the registration form and
// the comprehensive needs assessment — not a scored-questionnaire engine.
// WSL's scales, scoring rules and packages are left out until somebody
// asks for a score.

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "single_choice",
  "multi_choice",
  "yes_no",
  "date",
  "number",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CHOICE_TYPES: ReadonlySet<QuestionType> = new Set(["single_choice", "multi_choice"]);

export const FORM_VERSION_STATUSES = ["draft", "published"] as const;
export type FormVersionStatus = (typeof FORM_VERSION_STATUSES)[number];

export const ASSESSMENT_STATUSES = ["in_progress", "completed", "voided"] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

// How the answers got into the system. NMBM do all three today (M13):
// a worker asking the questions, a paper copy typed up afterwards, and
// the participant filling it in on a tablet or from a link. Reports
// need to tell a self-report from a transcription.
export const ASSESSMENT_MODES = ["with_staff", "from_paper", "self"] as const;
export type AssessmentMode = (typeof ASSESSMENT_MODES)[number];

/* ------------------------------------------------------------------ *
 * Show-if rules, ported from WSL's branching engine.
 *
 * A condition hangs off the question that might be hidden ("show this
 * if Q4 is Yes"), not off the answer that causes a jump. The staff page
 * shows the whole form, a paper transcription is the whole form, and a
 * tablet shows one question at a time; hiding means the same thing on
 * all three, a jump only makes sense on the last.
 *
 * Conditions name a question by its stable id, which carries over when
 * a published form is edited into a new version — so a rule written on
 * version 1 still points at the same question on version 3.
 * ------------------------------------------------------------------ */

export const SHOW_IF_OPERATORS = ["eq", "ne", "in", "not_in", "gt", "lt", "answered", "not_answered"] as const;
export type ShowIfOperator = (typeof SHOW_IF_OPERATORS)[number];

const VALUELESS: ReadonlySet<ShowIfOperator> = new Set(["answered", "not_answered"]);
const LIST_VALUED: ReadonlySet<ShowIfOperator> = new Set(["in", "not_in"]);

const conditionValue = z.union([z.string().max(200), z.number()]);

export const showIfConditionSchema = z
  .object({
    questionId: z.string().uuid(),
    op: z.enum(SHOW_IF_OPERATORS),
    value: z.union([conditionValue, z.array(conditionValue).min(1).max(50)]).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (VALUELESS.has(c.op)) {
      if (c.value !== undefined) issue(`${c.op} takes no value`);
      return;
    }
    if (c.value === undefined) issue(`${c.op} needs a value`);
    else if (LIST_VALUED.has(c.op) !== Array.isArray(c.value)) {
      issue(LIST_VALUED.has(c.op) ? `${c.op} takes a list of values` : `${c.op} takes a single value`);
    }
  });
export type ShowIfCondition = z.infer<typeof showIfConditionSchema>;

// "all" by default: shown-when-it-shouldn't-be asks somebody a question
// that doesn't apply to them; hidden-when-it-shouldn't-be is a gap a
// worker notices.
export const showIfSchema = z
  .object({
    mode: z.enum(["all", "any"]).default("all"),
    conditions: z.array(showIfConditionSchema).min(1).max(10),
  })
  .strict();
export type ShowIf = z.infer<typeof showIfSchema>;

// What an answer can be: text (also dates, and the chosen option's value
// for single choice and yes/no), a list of option values for multiple
// choice, or a number.
export const answerValueSchema = z.union([
  z.string().max(5000),
  z.array(z.string().max(100)).max(50),
  z.number().finite(),
]);
export type AnswerValue = z.infer<typeof answerValueSchema>;
export type Answers = Record<string, AnswerValue>;

export type BranchQuestion = { stableId: string; sortOrder: number; showIf?: unknown };

export function parseShowIf(raw: unknown): ShowIf | null {
  if (raw === null || raw === undefined) return null;
  const parsed = showIfSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function isAnswered(value: AnswerValue | undefined): value is AnswerValue {
  if (value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function conditionHolds(c: ShowIfCondition, answer: AnswerValue | undefined): boolean {
  const has = isAnswered(answer);
  if (c.op === "answered") return has;
  if (c.op === "not_answered") return !has;
  // An unanswered question satisfies nothing — not even "is not Yes".
  // Somebody who skipped "do you have children?" hasn't said No.
  if (!has) return false;

  const matches = (target: string | number) =>
    Array.isArray(answer) ? answer.includes(String(target)) : String(answer) === String(target);

  switch (c.op) {
    case "eq":
      return matches(c.value as string | number);
    case "ne":
      return !matches(c.value as string | number);
    case "in":
      return (c.value as (string | number)[]).some(matches);
    case "not_in":
      return !(c.value as (string | number)[]).some(matches);
    case "gt":
    case "lt": {
      const n = typeof answer === "number" ? answer : Number(answer);
      const target = Number(c.value);
      if (Array.isArray(answer) || Number.isNaN(n) || Number.isNaN(target)) return false;
      return c.op === "gt" ? n > target : n < target;
    }
  }
}

// One pass in order is enough because a condition may only look back,
// which publishing enforces. It also makes cascades fall out: a hidden
// question's answer is ignored, so anything hanging off it hides too —
// changing an earlier answer can't leave a follow-up showing on the
// strength of an answer to a question nobody can now see.
export function visibleQuestionIds(questions: BranchQuestion[], answers: Answers): Set<string> {
  const ordered = [...questions].sort((a, b) => a.sortOrder - b.sortOrder);
  const visible = new Set<string>();
  const live: Answers = {};
  for (const q of ordered) {
    const rule = parseShowIf(q.showIf);
    const shown =
      rule === null ||
      (rule.mode === "any"
        ? rule.conditions.some((c) => conditionHolds(c, live[c.questionId]))
        : rule.conditions.every((c) => conditionHolds(c, live[c.questionId])));
    if (shown) {
      visible.add(q.stableId);
      if (q.stableId in answers) live[q.stableId] = answers[q.stableId];
    }
  }
  return visible;
}

/* ------------------------------------------------------------------ *
 * Building a form.
 * ------------------------------------------------------------------ */

// An option keeps its value when its label is reworded, so answers and
// rules that name it survive the edit. The builder makes the value.
export const questionOptionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

export const YES_NO_OPTIONS: QuestionOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export const formQuestionSchema = z.object({
  stableId: z.string().uuid(),
  type: z.enum(QUESTION_TYPES),
  prompt: z.string().trim().min(1).max(1000),
  helpText: z.string().trim().max(1000).nullish(),
  // A heading the question sits under. Consecutive questions with the
  // same section print together.
  section: z.string().trim().max(200).nullish(),
  required: z.boolean().default(false),
  options: z.array(questionOptionSchema).max(50).default([]),
  showIf: showIfSchema.nullish(),
});
export type FormQuestionInput = z.infer<typeof formQuestionSchema>;

export const saveQuestionsSchema = z.object({
  questions: z.array(formQuestionSchema).max(300),
});

export const createFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
});

export const startAssessmentSchema = z.object({
  formId: z.string().uuid(),
  // "self" is started from the participant's own link, never here.
  mode: z.enum(["with_staff", "from_paper"]),
});

export const saveAnswersSchema = z.object({
  // null clears an answer.
  answers: z.record(z.string().uuid(), answerValueSchema.nullable()),
});

export const voidAssessmentSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export type PublishProblem = { stableId: string | null; message: string };

// What has to hold before a version goes live. Checked at publish, not
// on every save: a draft gets written out of order, and refusing a
// follow-up before the question it hangs off exists would make the
// builder unusable.
export function publishProblems(questions: (FormQuestionInput & { sortOrder: number })[]): PublishProblem[] {
  const problems: PublishProblem[] = [];
  if (questions.length === 0) problems.push({ stableId: null, message: "A form needs at least one question" });
  const ordered = [...questions].sort((a, b) => a.sortOrder - b.sortOrder);
  const earlier = new Map<string, FormQuestionInput>();

  for (const q of ordered) {
    const label = `"${q.prompt.slice(0, 60)}"`;
    if (CHOICE_TYPES.has(q.type)) {
      if (q.options.length < 2) problems.push({ stableId: q.stableId, message: `${label} needs at least two options` });
      const values = q.options.map((o) => o.value);
      if (new Set(values).size !== values.length) {
        problems.push({ stableId: q.stableId, message: `${label} has two options with the same value` });
      }
    }
    for (const c of q.showIf?.conditions ?? []) {
      const target = earlier.get(c.questionId);
      if (c.questionId === q.stableId) {
        problems.push({ stableId: q.stableId, message: `${label} can't depend on its own answer` });
      } else if (!target) {
        // A forward reference is a cycle or a question with no answer
        // yet; either way the form would behave differently depending on
        // the order somebody filled it in.
        problems.push({
          stableId: q.stableId,
          message: `${label} depends on a question that doesn't come before it`,
        });
      } else if (c.value !== undefined && (CHOICE_TYPES.has(target.type) || target.type === "yes_no")) {
        // The usual way a rule breaks: an option it names was removed
        // from the earlier question, and the follow-up silently never
        // shows again.
        const known = new Set(
          (target.type === "yes_no" ? YES_NO_OPTIONS : target.options).map((o) => o.value),
        );
        const named = (Array.isArray(c.value) ? c.value : [c.value]).map(String);
        if (named.some((v) => !known.has(v))) {
          problems.push({
            stableId: q.stableId,
            message: `${label} depends on an option the earlier question no longer has`,
          });
        }
      }
    }
    earlier.set(q.stableId, q);
  }
  return problems;
}

// Checks one answer against its question. Returns why it doesn't fit,
// or null.
export function answerProblem(
  q: { type: QuestionType; options: QuestionOption[] },
  value: AnswerValue,
): string | null {
  const values = new Set((q.type === "yes_no" ? YES_NO_OPTIONS : q.options).map((o) => o.value));
  switch (q.type) {
    case "short_text":
    case "long_text":
      return typeof value === "string" ? null : "expects text";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
        ? null
        : "expects a date";
    case "number":
      return typeof value === "number" ? null : "expects a number";
    case "yes_no":
    case "single_choice":
      return typeof value === "string" && values.has(value) ? null : "isn't one of the options";
    case "multi_choice":
      return Array.isArray(value) && value.every((v) => values.has(v)) && new Set(value).size === value.length
        ? null
        : "isn't a list of the options";
  }
}

/* ------------------------------------------------------------------ *
 * The participant's own link (M13).
 *
 * The case manager hands over a link and a passcode themselves — in
 * person, by phone, from their own Workspace email — so nothing here
 * sends a message. The two are meant to travel separately: a forwarded
 * email alone doesn't open the form.
 * ------------------------------------------------------------------ */

export const SELF_SERVE_PASSCODE_LENGTH = 6;
// Wrong passcodes before the link locks. The link itself is a 256-bit
// secret, so this guards a link that has gone astray, not guessing.
export const SELF_SERVE_MAX_ATTEMPTS = 5;
// Idle time before a participant's open form needs the passcode again —
// a shared tablet, or a phone left on a table.
export const SELF_SERVE_IDLE_MINUTES = 30;

export const sendToParticipantSchema = z.object({ formId: z.string().uuid() });
export const unlockSchema = z.object({
  passcode: z.string().trim().regex(/^\d{6}$/, { message: "The passcode is six digits" }),
});
