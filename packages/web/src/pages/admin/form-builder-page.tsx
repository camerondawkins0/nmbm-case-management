import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CHOICE_TYPES,
  QUESTION_TYPES,
  YES_NO_OPTIONS,
  visibleQuestionIds,
  type AnswerValue,
  type Answers,
  type QuestionType,
  type ShowIfCondition,
} from "@nmbm/shared";
import { api, ApiError } from "../../lib/api.js";
import { QUESTION_TYPE_LABELS } from "../../lib/labels.js";
import type { AssessmentFormDetail, FormQuestion, FormVersion } from "../../lib/types.js";
import { Pill } from "../../components/flags.js";
import { QuestionField } from "../../components/question-field.js";

const inputClass = "rounded border border-nmbm-ink/20 px-2 py-1.5 text-sm";

// Option values are made here, once, and never shown. Rewording an
// option's label keeps its value, so answers and rules that name it
// survive the edit.
const newValue = () => crypto.randomUUID().slice(0, 8);

function blankQuestion(section: string | null): FormQuestion {
  return {
    stableId: crypto.randomUUID(),
    sortOrder: 0,
    type: "short_text",
    prompt: "",
    helpText: null,
    section,
    required: false,
    options: [],
    showIf: null,
  };
}

// The one kind of rule the builder writes: show this question when an
// earlier one has a particular answer. The API takes more (several
// conditions, any/all); a rule like that is shown read-only here.
function simpleRule(q: FormQuestion): ShowIfCondition | null | "complex" {
  if (!q.showIf) return null;
  if (q.showIf.conditions.length !== 1) return "complex";
  return q.showIf.conditions[0];
}

function optionsOf(q: FormQuestion) {
  return q.type === "yes_no" ? YES_NO_OPTIONS : q.options;
}

function describeRule(c: ShowIfCondition, questions: FormQuestion[]) {
  const target = questions.find((x) => x.stableId === c.questionId);
  if (!target) return "Depends on a question that has been removed";
  const name = `“${target.prompt || "untitled question"}”`;
  if (c.op === "answered") return `Shown when ${name} is answered`;
  if (c.op === "not_answered") return `Shown when ${name} is not answered`;
  const label = (v: string | number) => optionsOf(target).find((o) => o.value === String(v))?.label ?? String(v);
  const values = Array.isArray(c.value) ? c.value.map(label).join(" or ") : label(c.value ?? "");
  const verb = { eq: "is", ne: "is not", in: "is", not_in: "is not", gt: "is more than", lt: "is less than" }[c.op];
  return `Shown when ${name} ${verb} ${values}`;
}

export default function FormBuilderPage() {
  const { id } = useParams();
  const [form, setForm] = useState<AssessmentFormDetail | null>(null);
  const [version, setVersion] = useState<FormVersion | null>(null);
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const [changed, setChanged] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<Answers>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (versionId?: string) => {
      try {
        const f = await api<AssessmentFormDetail>(`/api/assessment-forms/${id}`);
        setForm(f);
        // The draft if there is one — that's what there is to work on —
        // otherwise the live version.
        const pick = versionId ?? f.versions.find((v) => v.status === "draft")?.id ?? f.versions[0]?.id;
        if (pick) {
          const v = await api<FormVersion>(`/api/assessment-versions/${pick}`);
          setVersion(v);
          setQuestions(v.questions);
          setChanged(false);
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not load the form");
      }
    },
    [id],
  );
  useEffect(() => {
    load();
  }, [load]);

  function update(index: number, patch: Partial<FormQuestion>) {
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)));
    setChanged(true);
  }

  function move(index: number, by: -1 | 1) {
    setQuestions((qs) => {
      const next = [...qs];
      const [q] = next.splice(index, 1);
      next.splice(index + by, 0, q);
      return next;
    });
    setChanged(true);
  }

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    api(`/api/assessment-versions/${version!.id}/questions`, {
      method: "PUT",
      body: JSON.stringify({
        questions: questions.map(({ sortOrder: _s, ...q }) => q),
      }),
    }).then(() => setChanged(false));

  if (error && !form) return <p className="text-sm text-state-alert">{error}</p>;
  if (!form || !version) return <p className="text-sm text-nmbm-ink/50">Loading…</p>;

  const isDraft = version.status === "draft";
  const hasDraft = form.versions.some((v) => v.status === "draft");
  const ordered = questions.map((q, i) => ({ ...q, sortOrder: i }));
  const visible = visibleQuestionIds(ordered, previewAnswers);

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/admin/forms" className="text-sm text-nmbm-ink/60 underline-offset-2 hover:underline">
        ← Forms
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-nmbm-ink">{form.name}</h1>
          <p className="mt-1 text-sm text-nmbm-ink/60">
            Version {version.versionNumber} · {isDraft ? "draft — not yet in use" : "published"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!form.active && <Pill tone="alert">retired</Pill>}
          <select
            aria-label="Version"
            value={version.id}
            onChange={(e) => load(e.target.value)}
            className={inputClass}
          >
            {form.versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNumber} {v.status === "draft" ? "(draft)" : ""}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setPreview((p) => !p);
              setPreviewAnswers({});
            }}
            className="rounded border border-nmbm-ink/30 px-3 py-1.5 text-sm"
          >
            {preview ? "Back to editing" : "Preview"}
          </button>
        </div>
      </div>

      {notice && (
        <p className="mt-4 rounded border border-state-ok/20 bg-state-ok-bg px-3 py-2 text-sm text-state-ok">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded border border-state-alert/20 bg-state-alert-bg px-3 py-2 text-sm text-state-alert">
          {error}
        </p>
      )}

      {preview ? (
        <div className="mt-6 flex flex-col gap-5 rounded border border-dashed border-nmbm-ink/20 p-4">
          <p className="text-xs text-nmbm-ink/50">
            Try answering — follow-up questions appear and disappear as they will for staff.
            Nothing here is saved.
          </p>
          {ordered
            .filter((q) => visible.has(q.stableId))
            .map((q) => (
              <QuestionField
                key={q.stableId}
                question={q}
                value={previewAnswers[q.stableId]}
                onChange={(v: AnswerValue | null) =>
                  setPreviewAnswers((a) => {
                    const next = { ...a };
                    if (v === null) delete next[q.stableId];
                    else next[q.stableId] = v;
                    return next;
                  })
                }
              />
            ))}
        </div>
      ) : (
        <>
          {!isDraft && (
            <div className="mt-4 rounded border border-nmbm-ink/10 bg-nmbm-ink/[0.03] px-4 py-3 text-sm text-nmbm-ink/70">
              This version is published and can't be changed.{" "}
              {hasDraft ? (
                "There's already a draft of the next version — choose it above."
              ) : (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const draft = await api<{ id: string }>(`/api/assessment-forms/${form.id}/drafts`, {
                        method: "POST",
                      });
                      await load(draft.id);
                    }, "A new draft has been started from this version.")
                  }
                  className="font-medium text-nmbm-ink underline underline-offset-2"
                >
                  Edit as a new version
                </button>
              )}
            </div>
          )}

          <ol className="mt-6 flex flex-col gap-3">
            {ordered.map((q, i) => {
              const rule = simpleRule(q);
              const earlier = ordered
                .slice(0, i)
                .filter((x) => x.type === "yes_no" || CHOICE_TYPES.has(x.type));
              return (
                <li key={q.stableId} className="rounded border border-nmbm-ink/10 p-4">
                  {!isDraft ? (
                    <div>
                      {q.section && (i === 0 || ordered[i - 1].section !== q.section) && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-nmbm-ink/50">
                          {q.section}
                        </p>
                      )}
                      <p className="text-sm font-medium text-nmbm-ink">
                        {i + 1}. {q.prompt}
                        {q.required && <span className="text-state-alert"> *</span>}
                      </p>
                      <p className="text-xs text-nmbm-ink/50">
                        {QUESTION_TYPE_LABELS[q.type]}
                        {optionsOf(q).length > 0 && `: ${optionsOf(q).map((o) => o.label).join(" / ")}`}
                      </p>
                      {rule && rule !== "complex" && (
                        <p className="mt-1 text-xs text-nmbm-ink/60">{describeRule(rule, ordered)}</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-nmbm-ink/50">Question {i + 1}</span>
                        <div className="flex gap-1 text-xs">
                          <button
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                            className="rounded border border-nmbm-ink/20 px-2 py-0.5 disabled:opacity-30"
                            aria-label="Move up"
                          >
                            ↑
                          </button>
                          <button
                            disabled={i === ordered.length - 1}
                            onClick={() => move(i, 1)}
                            className="rounded border border-nmbm-ink/20 px-2 py-0.5 disabled:opacity-30"
                            aria-label="Move down"
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => {
                              setQuestions((qs) => qs.filter((_, j) => j !== i));
                              setChanged(true);
                            }}
                            className="rounded border border-nmbm-ink/20 px-2 py-0.5 hover:text-state-alert"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <label className="flex flex-col gap-1 text-sm">
                        Question
                        <input
                          value={q.prompt}
                          onChange={(e) => update(i, { prompt: e.target.value })}
                          className={inputClass}
                        />
                      </label>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <label className="flex flex-col gap-1 text-sm">
                          Answer
                          <select
                            value={q.type}
                            onChange={(e) => {
                              const type = e.target.value as QuestionType;
                              update(i, {
                                type,
                                options:
                                  CHOICE_TYPES.has(type) && q.options.length === 0
                                    ? [
                                        { value: newValue(), label: "" },
                                        { value: newValue(), label: "" },
                                      ]
                                    : q.options,
                              });
                            }}
                            className={inputClass}
                          >
                            {QUESTION_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {QUESTION_TYPE_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-1 flex-col gap-1 text-sm">
                          Section heading (optional)
                          <input
                            value={q.section ?? ""}
                            onChange={(e) => update(i, { section: e.target.value || null })}
                            className={inputClass}
                          />
                        </label>
                      </div>
                      <label className="flex flex-col gap-1 text-sm">
                        Help text (optional)
                        <input
                          value={q.helpText ?? ""}
                          onChange={(e) => update(i, { helpText: e.target.value || null })}
                          className={inputClass}
                        />
                      </label>

                      {CHOICE_TYPES.has(q.type) && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-sm">Options</span>
                          {q.options.map((o, j) => (
                            <div key={o.value} className="flex gap-2">
                              <input
                                value={o.label}
                                aria-label={`Option ${j + 1}`}
                                onChange={(e) =>
                                  update(i, {
                                    options: q.options.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)),
                                  })
                                }
                                className={`${inputClass} flex-1`}
                              />
                              <button
                                onClick={() => update(i, { options: q.options.filter((_, k) => k !== j) })}
                                className="rounded border border-nmbm-ink/20 px-2 text-xs hover:text-state-alert"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => update(i, { options: [...q.options, { value: newValue(), label: "" }] })}
                            className="self-start text-xs text-nmbm-ink/60 underline underline-offset-2"
                          >
                            Add an option
                          </button>
                        </div>
                      )}

                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={q.required}
                          onChange={(e) => update(i, { required: e.target.checked })}
                        />
                        Required (when shown)
                      </label>

                      {rule === "complex" ? (
                        <p className="text-xs text-nmbm-ink/60">
                          Has a rule with several conditions.{" "}
                          <button onClick={() => update(i, { showIf: null })} className="underline">
                            Remove it
                          </button>
                        </p>
                      ) : earlier.length > 0 || rule ? (
                        <div className="flex flex-col gap-1.5 rounded bg-nmbm-ink/[0.03] p-2 text-sm">
                          <span className="text-xs text-nmbm-ink/60">
                            {rule ? describeRule(rule, ordered) : "Always shown"}
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs">Only show when</span>
                            <select
                              aria-label="Depends on"
                              value={rule?.questionId ?? ""}
                              onChange={(e) => {
                                const target = earlier.find((x) => x.stableId === e.target.value);
                                update(i, {
                                  showIf: target
                                    ? {
                                        mode: "all",
                                        conditions: [
                                          { questionId: target.stableId, op: "eq", value: optionsOf(target)[0]?.value ?? "" },
                                        ],
                                      }
                                    : null,
                                });
                              }}
                              className={`${inputClass} max-w-[14rem]`}
                            >
                              <option value="">— always show —</option>
                              {earlier.map((x) => (
                                <option key={x.stableId} value={x.stableId}>
                                  {x.prompt || "untitled question"}
                                </option>
                              ))}
                            </select>
                            {rule && (
                              <>
                                <select
                                  aria-label="Condition"
                                  value={rule.op === "ne" ? "ne" : "eq"}
                                  onChange={(e) =>
                                    update(i, {
                                      showIf: {
                                        mode: "all",
                                        conditions: [{ ...rule, op: e.target.value as "eq" | "ne" }],
                                      },
                                    })
                                  }
                                  className={inputClass}
                                >
                                  <option value="eq">is</option>
                                  <option value="ne">is not</option>
                                </select>
                                <select
                                  aria-label="Answer"
                                  value={String(rule.value ?? "")}
                                  onChange={(e) =>
                                    update(i, {
                                      showIf: { mode: "all", conditions: [{ ...rule, value: e.target.value }] },
                                    })
                                  }
                                  className={`${inputClass} max-w-[12rem]`}
                                >
                                  {optionsOf(ordered.find((x) => x.stableId === rule.questionId) ?? q).map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label || "(blank option)"}
                                    </option>
                                  ))}
                                </select>
                              </>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {isDraft && (
            <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-2 border-t border-nmbm-ink/10 bg-nmbm-paper py-3">
              <button
                onClick={() => {
                  setQuestions((qs) => [...qs, blankQuestion(qs[qs.length - 1]?.section ?? null)]);
                  setChanged(true);
                }}
                className="rounded border border-nmbm-ink/30 px-3 py-1.5 text-sm"
              >
                Add a question
              </button>
              <button
                disabled={busy || !changed}
                onClick={() => run(save, "Draft saved.")}
                className="rounded border border-nmbm-ink/30 px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Save draft
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Publish this version? New forms will use it from now on, and it can't be edited afterwards.",
                    )
                  )
                    return;
                  run(async () => {
                    if (changed) await save();
                    await api(`/api/assessment-versions/${version.id}/publish`, { method: "POST" });
                    await load(version.id);
                  }, `Version ${version.versionNumber} published.`);
                }}
                className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper disabled:opacity-50"
              >
                Publish
              </button>
              {changed && <span className="text-xs text-nmbm-ink/50">Unsaved changes</span>}
            </div>
          )}

          <div className="mt-8 border-t border-nmbm-ink/10 pt-4">
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/api/assessment-forms/${form.id}/active`, {
                    method: "POST",
                    body: JSON.stringify({ active: !form.active }),
                  });
                  await load(version.id);
                }, form.active ? "Form retired." : "Form back in use.")
              }
              className="text-sm text-nmbm-ink/50 underline-offset-2 hover:underline"
            >
              {form.active ? "Retire this form" : "Bring this form back into use"}
            </button>
            <p className="mt-1 text-xs text-nmbm-ink/50">
              A retired form can't be started. Everything already filled in stays on the record.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
