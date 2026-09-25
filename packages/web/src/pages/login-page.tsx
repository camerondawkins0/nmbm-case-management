import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { SIGN_IN_ERRORS, type SignInError } from "@nmbm/shared";
import { BrandMark } from "../components/brand-mark.js";

type Notice = { tone: "alert" | "info"; title: string; body: string };

// Each refusal says what to do next, because the person reading it is a
// CHW at a front desk, not whoever configured Google. "Sign-in failed"
// with no next step turns into a phone call.
const ERROR_NOTICES: Record<SignInError, Notice> = {
  cancelled: {
    tone: "info",
    title: "Sign-in was cancelled",
    body: "Nothing was changed. Choose your NMBM account when you're ready.",
  },
  expired: {
    tone: "alert",
    title: "That sign-in attempt expired",
    body: "It took too long, or was started in another tab. Please try again from this page.",
  },
  wrong_domain: {
    tone: "alert",
    title: "That isn't an NMBM account",
    body:
      "Only NMBM Google Workspace accounts can sign in — the one you use for NMBM email, not a personal Gmail. Sign in again and pick your work account.",
  },
  unverified: {
    tone: "alert",
    title: "Google hasn't verified this account's email",
    body: "Ask NMBM's system administrator to check the account in Google Workspace.",
  },
  deactivated: {
    tone: "alert",
    title: "This account has been deactivated",
    body:
      "Your records and notes are kept, but the account can no longer sign in. If you think this is a mistake, speak to your supervisor.",
  },
  not_configured: {
    tone: "alert",
    title: "Sign-in isn't set up yet",
    body:
      "Google sign-in hasn't been configured for this installation. This is a setup step, not a problem with your account — let NMBM's system administrator know.",
  },
  google_failed: {
    tone: "alert",
    title: "Google didn't complete the sign-in",
    body: "This is usually temporary. Wait a moment and try again.",
  },
};

const SESSION_ENDED: Notice = {
  tone: "info",
  title: "Your session ended",
  body: "You were signed out after a period without activity. Sign in again to carry on where you were.",
};

const SIGNED_OUT: Notice = {
  tone: "info",
  title: "You've signed out",
  body: "On a shared computer or tablet, close the browser too.",
};

function isSignInError(value: string | null): value is SignInError {
  return value !== null && (SIGN_IN_ERRORS as readonly string[]).includes(value);
}

export default function LoginPage({ expired = false }: { expired?: boolean }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const error = params.get("error");

  // Where to go after signing in: the page the person was sent here
  // from, or the one their session ended on. The server re-checks this
  // is a same-origin path; it is not trusted from here.
  const from = (location.state as { from?: { pathname: string; search: string } } | null)?.from;
  const returnTo =
    params.get("returnTo") ?? (from && from.pathname !== "/login" ? from.pathname + from.search : null);

  const notice: Notice | null = isSignInError(error)
    ? ERROR_NOTICES[error]
    : expired || params.get("session") === "ended"
      ? SESSION_ENDED
      : params.get("signed_out")
        ? SIGNED_OUT
        : null;

  const googleHref = returnTo
    ? `/auth/google/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/auth/google/login";

  return (
    <div className="flex min-h-screen flex-col bg-nmbm-paper">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="flex flex-col items-center text-center">
          <BrandMark size={84} />
          <p className="mt-4 text-2xl font-semibold tracking-[0.12em] text-nmbm-ink">NMBM</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-nmbm-gold-dark">
            Make Your Next Move Your Best Move
          </p>
        </div>

        <section
          aria-labelledby="sign-in-heading"
          className="mt-10 w-full max-w-sm rounded-lg border border-nmbm-ink/15 bg-nmbm-paper shadow-[0_1px_2px_rgba(10,10,10,0.04),0_8px_24px_-12px_rgba(10,10,10,0.18)]"
        >
          <div className="px-7 pb-6 pt-7">
            <h1 id="sign-in-heading" className="text-lg font-semibold text-nmbm-ink">
              Sign in
            </h1>
            <p className="mt-1 text-sm text-nmbm-ink/60">Case management for NMBM staff.</p>

            {notice && <NoticeBanner notice={notice} />}

            <a
              href={googleHref}
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-md border border-[#dadce0] bg-white px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition hover:bg-[#f8f9fa] focus:outline-none focus-visible:ring-2 focus-visible:ring-nmbm-gold focus-visible:ring-offset-2"
            >
              <GoogleG />
              Sign in with Google
            </a>
            <p className="mt-3 text-xs leading-relaxed text-nmbm-ink/55">
              Use your NMBM Google Workspace account — the one you use for NMBM email.
            </p>
          </div>

          <div className="flex gap-2.5 border-t border-nmbm-ink/10 bg-nmbm-ink/[0.025] px-7 py-4 text-xs leading-relaxed text-nmbm-ink/60">
            <LockIcon />
            <p>
              This system holds confidential client information. Access is limited to authorised
              staff, and sign-ins and changes are recorded.
            </p>
          </div>
        </section>

        <DevSignIn returnTo={returnTo} />
      </main>

      <footer className="px-4 pb-6 text-center text-xs text-nmbm-ink/45">
        Trouble signing in? Ask your supervisor or NMBM's system administrator.
      </footer>
    </div>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  const styles =
    notice.tone === "alert"
      ? "border-state-alert/25 bg-state-alert-bg text-state-alert"
      : "border-nmbm-ink/15 bg-nmbm-ink/[0.03] text-nmbm-ink";
  return (
    <div role={notice.tone === "alert" ? "alert" : "status"} className={`mt-5 rounded-md border px-3.5 py-3 text-sm ${styles}`}>
      <p className="font-medium">{notice.title}</p>
      <p className={`mt-0.5 ${notice.tone === "alert" ? "" : "text-nmbm-ink/65"}`}>{notice.body}</p>
    </div>
  );
}

type DevAccount = { email: string; displayName: string; roles: string[] };

// Present only when the server has development sign-in switched on,
// which it refuses to do in production. The page asks, and a 404 means
// the panel never appears.
function DevSignIn({ returnTo }: { returnTo: string | null }) {
  const [accounts, setAccounts] = useState<DevAccount[] | null>(null);

  useEffect(() => {
    fetch("/auth/dev-login/accounts", { credentials: "include" })
      .then((res) => (res.ok ? (res.json() as Promise<DevAccount[]>) : null))
      .then(setAccounts)
      .catch(() => setAccounts(null));
  }, []);

  if (!accounts || accounts.length === 0) return null;

  return (
    <section
      aria-labelledby="dev-sign-in-heading"
      className="mt-6 w-full max-w-sm rounded-lg border border-dashed border-state-warn/50 bg-state-warn-bg/60 px-5 py-4"
    >
      <h2 id="dev-sign-in-heading" className="text-xs font-semibold uppercase tracking-wide text-state-warn">
        Development sign-in
      </h2>
      <p className="mt-1 text-xs text-state-warn/90">
        Invented demo staff. Skips Google, and doesn't exist in production.
      </p>
      <ul className="mt-3 flex flex-col gap-1">
        {accounts.map((account) => {
          const query = new URLSearchParams({ email: account.email });
          if (returnTo) query.set("returnTo", returnTo);
          return (
            <li key={account.email}>
              <a
                href={`/auth/dev-login?${query.toString()}`}
                className="flex items-baseline justify-between gap-3 rounded px-2 py-1.5 text-sm text-nmbm-ink hover:bg-nmbm-paper"
              >
                <span className="font-medium">{account.displayName}</span>
                <span className="truncate text-xs text-nmbm-ink/55">
                  {account.roles.join(", ") || "No role"}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Google's own mark, as its sign-in branding guidelines ask for on a
// "Sign in with Google" button — not NMBM's brand, so it keeps its colours.
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
