import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { SELF_SERVE_PASSCODE_LENGTH, visibleQuestionIds, type AnswerValue, type Answers } from "@nmbm/shared";
import { BrandMark } from "../components/brand-mark.js";
import { QuestionField, bySection } from "../components/question-field.js";
import type { FormQuestion } from "../lib/types.js";

type View = { formName: string; questions: FormQuestion[]; answers: Answers };
type Screen = "loading" | "passcode" | "form" | "gone" | "done" | "offline";

class Refused extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Not lib/api: that one sends a 401 to the staff sign-in page, and a 401
// here only means "enter the passcode".
async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/self-serve/${encodeURIComponent(token)}${path}`, {
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch {
      // The status says enough.
    }
    throw new Refused(res.status, message);
  }
  return res.json() as Promise<T>;
}

// What a participant sees from the link their case manager gave them:
// the passcode screen, then one form. Nothing else of the system, and
// nothing about them — whoever holds the link and passcode learns only
// which form it is.
export default function SelfServePage() {
  const { token = "" } = useParams();
  const [screen, setScreen] = useState<Screen>("loading");
  const [view, setView] = useState<View | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [passcode, setPasscode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState<"saved" | "unsaved" | "saving">("saved");
  const [busy, setBusy] = useState(false);
  const dirty = useRef(new Set<string>());
  const answersRef = useRef<Answers>({});
  answersRef.current = answers;

  // Anything that isn't a passcode problem ends the same way for the
  // participant: ask the case manager.
  const handle = useCallback((e: unknown) => {
    if (e instanceof Refused) {
      if (e.status === 401) {
        setScreen("passcode");
        return;
      }
      if (e.status === 404 || e.status === 423) {
        setMessage(e.message);
        setScreen("gone");
        return;
      }
      setMessage(e.message);
      return;
    }
    setScreen("offline");
  }, []);

  const load = useCallback(async () => {
    try {
      const v = await call<View>(token, "");
      setView(v);
      // Answers typed while signed out are kept and sent once back in.
      setAnswers((local) => ({ ...v.answers, ...Object.fromEntries([...dirty.current].map((k) => [k, local[k]])) }));
      setScreen("form");
      if (dirty.current.size > 0) setSaving("unsaved");
    } catch (e) {
      handle(e);
    }
  }, [token, handle]);

  useEffect(() => {
    load();
  }, [load]);

  const flush = useCallback(async () => {
    if (dirty.current.size === 0) return true;
    const keys = [...dirty.current];
    dirty.current.clear();
    setSaving("saving");
    try {
      await call(token, "/answers", {
        method: "PATCH",
        body: JSON.stringify({ answers: Object.fromEntries(keys.map((k) => [k, answersRef.current[k] ?? null])) }),
      });
      setSaving(dirty.current.size > 0 ? "unsaved" : "saved");
      return true;
    } catch (e) {
      keys.forEach((k) => dirty.current.add(k));
      setSaving("unsaved");
      handle(e);
      return false;
    }
  }, [token, handle]);

  useEffect(() => {
    if (saving !== "unsaved" || screen !== "form") return;
    const timer = setTimeout(flush, 800);
    return () => clearTimeout(timer);
  }, [answers, saving, screen, flush]);

  function change(stableId: string, value: AnswerValue | null) {
    setMessage(null);
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === null) delete next[stableId];
      else next[stableId] = value;
      return next;
    });
    dirty.current.add(stableId);
    setSaving("unsaved");
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await call(token, "/unlock", { method: "POST", body: JSON.stringify({ passcode }) });
      setPasscode("");
      await load();
    } catch (err) {
      if (err instanceof Refused && err.status === 401) setMessage(err.message);
      else handle(err);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm("Send your answers now? You won't be able to change them afterward.")) return;
    setBusy(true);
    setMessage(null);
    try {
      if (!(await flush())) return;
      await call(token, "/submit", { method: "POST" });
      setScreen("done");
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ds-surface px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3">
          <BrandMark size={40} />
          <span className="text-lg font-semibold text-ds-ink">NMBM</span>
        </div>

        {screen === "loading" && <p className="mt-10 text-sm text-ds-muted">Loading…</p>}

        {screen === "passcode" && (
          <form onSubmit={unlock} className="mt-10 max-w-sm">
            <h1 className="ds-display">Enter your passcode</h1>
            <p className="mt-2 text-sm text-ds-secondary">
              Your case manager gave you a {SELF_SERVE_PASSCODE_LENGTH}-digit passcode with this
              link.
            </p>
            <label htmlFor="passcode" className="mt-5 block text-sm font-medium text-ds-ink">
              Passcode
            </label>
            <input
              id="passcode"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={SELF_SERVE_PASSCODE_LENGTH}
              value={passcode}
              onChange={(e) => setPasscode(e.target.value.replace(/\D/g, ""))}
              className="nmbm-control mt-1 w-40 text-lg tracking-[0.3em]"
            />
            {message && <p className="mt-3 text-sm text-state-alert">{message}</p>}
            <button
              type="submit"
              disabled={busy || passcode.length !== SELF_SERVE_PASSCODE_LENGTH}
              className="nmbm-btn nmbm-btn--primary nmbm-btn--md mt-5 block"
            >
              Continue
            </button>
          </form>
        )}

        {screen === "gone" && (
          <div className="mt-10">
            <h1 className="ds-display">This link can't be used</h1>
            <p className="mt-2 text-sm text-ds-secondary">{message}</p>
          </div>
        )}

        {screen === "offline" && (
          <div className="mt-10">
            <h1 className="ds-display">We can't reach the form right now</h1>
            <p className="mt-2 text-sm text-ds-secondary">
              Check your internet connection and try again. Anything you've already answered has
              been saved.
            </p>
            <button
              onClick={() => {
                setScreen("loading");
                load();
              }}
              className="nmbm-btn nmbm-btn--secondary nmbm-btn--md mt-4"
            >
              Try again
            </button>
          </div>
        )}

        {screen === "done" && (
          <div className="mt-10">
            <h1 className="ds-display">Thank you</h1>
            <p className="mt-2 text-sm text-ds-secondary">
              Your answers have been sent to your case manager. You can close this page now.
            </p>
          </div>
        )}

        {screen === "form" && view && (
          <form onSubmit={submit} className="mt-8">
            <h1 className="ds-display">{view.formName}</h1>
            <p className="mt-1 text-sm text-ds-muted">
              Your answers save as you go, so you can stop and come back with the same link and
              passcode. Questions marked <span className="text-state-alert">*</span> need an
              answer.
            </p>
            <div className="mt-6 flex flex-col gap-6">
              {bySection(view.questions.filter((q) => visibleQuestionIds(view.questions, answers).has(q.stableId))).map(
                (group, i) => (
                  <fieldset key={i} className="nmbm-card nmbm-card--dense">
                    {group.section && (
                      <legend className="ds-section-heading px-1">
                        {group.section}
                      </legend>
                    )}
                    <div className="flex flex-col gap-5">
                      {group.questions.map((q) => (
                        <QuestionField
                          key={q.stableId}
                          question={q}
                          value={answers[q.stableId]}
                          onChange={(v) => change(q.stableId, v)}
                        />
                      ))}
                    </div>
                  </fieldset>
                ),
              )}
            </div>
            {message && (
              <p className="nmbm-alert nmbm-alert--alert mt-4">
                {message}
              </p>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy}
                className="nmbm-btn nmbm-btn--primary nmbm-btn--md"
              >
                Send my answers
              </button>
              <span className="text-xs text-ds-muted" aria-live="polite">
                {saving === "saving" ? "Saving…" : saving === "unsaved" ? "Not saved yet" : "Saved"}
              </span>
            </div>
            <p className="mt-6 text-xs text-ds-muted">
              On a shared phone or tablet, close this page when you've finished.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
