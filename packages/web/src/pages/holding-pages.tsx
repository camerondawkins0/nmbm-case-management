import { BrandMark } from "../components/brand-mark.js";
import { SignOutButton } from "../components/sign-out-button.js";
import type { Me } from "../lib/types.js";

function HoldingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-nmbm-paper px-4 py-12">
      <BrandMark size={56} />
      <div className="mt-8 w-full max-w-md rounded-lg border border-nmbm-ink/15 px-7 py-6">{children}</div>
    </div>
  );
}

// Anyone in NMBM's Workspace can sign in, and arrives with no role —
// which is no access at all. Without this page they'd land in an app
// where every screen fails, with no idea why or whom to ask.
export function AwaitingAccessPage({ me }: { me: Me }) {
  return (
    <HoldingLayout>
      <h1 className="text-lg font-semibold text-nmbm-ink">Your account is waiting for access</h1>
      <p className="mt-2 text-sm text-nmbm-ink/70">
        You're signed in as <span className="font-medium text-nmbm-ink">{me.email}</span>, but no
        role has been assigned to you yet, so there's nothing you can open.
      </p>
      <p className="mt-3 text-sm text-nmbm-ink/70">
        Ask NMBM's system administrator to assign your role on the Staff page. Once they have,
        reload this page — you won't need to sign in again.
      </p>
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={() => window.location.reload()}
          className="rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper"
        >
          Reload
        </button>
        <SignOutButton className="text-sm text-nmbm-ink/60 underline-offset-2 hover:underline" />
      </div>
    </HoldingLayout>
  );
}

// Distinct from signed out on purpose: an outage shown as a login page
// has people signing in over and over and concluding their account is
// broken.
export function ServerUnavailablePage({ onRetry }: { onRetry: () => void }) {
  return (
    <HoldingLayout>
      <h1 className="text-lg font-semibold text-nmbm-ink">Can't reach the case management system</h1>
      <p className="mt-2 text-sm text-nmbm-ink/70">
        This is a problem with the connection or the server, not with your account. Check your
        internet connection and try again in a minute.
      </p>
      <p className="mt-3 text-sm text-nmbm-ink/70">
        If it keeps happening, use <span className="font-medium">Report an issue</span> once you're
        back in, or let NMBM's system administrator know.
      </p>
      <button
        onClick={onRetry}
        className="mt-6 rounded bg-nmbm-ink px-4 py-1.5 text-sm font-medium text-nmbm-paper"
      >
        Try again
      </button>
    </HoldingLayout>
  );
}
