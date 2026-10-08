import { YES_NO_OPTIONS, type AnswerValue } from "@nmbm/shared";
import type { FormQuestion } from "../lib/types.js";

const inputClass = "rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm";

// One question as the person filling the form sees it. The same
// component renders the staff page, the builder's preview, and — when
// it's built — the participant's own link, so a question can't look one
// way to the author and another to the person answering.
export function QuestionField({
  question,
  value,
  onChange,
  disabled,
}: {
  question: FormQuestion;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue | null) => void;
  disabled?: boolean;
}) {
  const id = `q-${question.stableId}`;
  const options = question.type === "yes_no" ? YES_NO_OPTIONS : question.options;

  let control;
  switch (question.type) {
    case "short_text":
      control = (
        <input
          id={id}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className={inputClass}
        />
      );
      break;
    case "long_text":
      control = (
        <textarea
          id={id}
          rows={3}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className={inputClass}
        />
      );
      break;
    case "date":
      control = (
        <input
          id={id}
          type="date"
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className={`${inputClass} w-44`}
        />
      );
      break;
    case "number":
      control = (
        <input
          id={id}
          type="number"
          disabled={disabled}
          value={typeof value === "number" ? String(value) : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className={`${inputClass} w-32`}
        />
      );
      break;
    case "yes_no":
    case "single_choice":
      control = (
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-col gap-1">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={id}
                disabled={disabled}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          ))}
          {/* A radio can't be unticked, and "I picked the wrong one and
              they didn't answer" is a real thing to need. */}
          {value !== undefined && !disabled && !question.required && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="self-start text-xs text-nmbm-ink/50 underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      );
      break;
    case "multi_choice": {
      const chosen = Array.isArray(value) ? value : [];
      control = (
        <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-1">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={chosen.includes(o.value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...chosen, o.value]
                    : chosen.filter((v) => v !== o.value);
                  onChange(next.length === 0 ? null : next);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;
    }
  }

  const grouped = question.type === "yes_no" || question.type === "single_choice" || question.type === "multi_choice";
  const prompt = (
    <>
      {question.prompt}
      {question.required && <span className="text-state-alert"> *</span>}
    </>
  );

  return (
    <div className="flex flex-col gap-1.5">
      {/* A group of radios or boxes has no single input to point a
          <label> at; the group names itself from this heading instead. */}
      {grouped ? (
        <span id={`${id}-label`} className="text-sm font-medium text-nmbm-ink">
          {prompt}
        </span>
      ) : (
        <label id={`${id}-label`} htmlFor={id} className="text-sm font-medium text-nmbm-ink">
          {prompt}
        </label>
      )}
      {question.helpText && <p className="text-xs text-nmbm-ink/60">{question.helpText}</p>}
      {control}
    </div>
  );
}

// Answers as text, for a completed assessment and the print view.
export function answerText(question: FormQuestion, value: AnswerValue | undefined): string | null {
  if (value === undefined) return null;
  const options = question.type === "yes_no" ? YES_NO_OPTIONS : question.options;
  const label = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  if (Array.isArray(value)) return value.map(label).join(", ");
  if (question.type === "yes_no" || question.type === "single_choice") return label(String(value));
  return String(value);
}

// Consecutive questions under the same heading print together.
export function bySection<Q extends { section: string | null }>(questions: Q[]) {
  const groups: { section: string | null; questions: Q[] }[] = [];
  for (const q of questions) {
    const last = groups[groups.length - 1];
    if (last && last.section === q.section) last.questions.push(q);
    else groups.push({ section: q.section, questions: [q] });
  }
  return groups;
}
