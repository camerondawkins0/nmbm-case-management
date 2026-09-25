// Why a sign-in was refused, carried back to the login page as
// `/login?error=<code>`. Declared once so the server can't send a code
// the page has no words for. Each maps to a different next step for the
// person at the screen, which is the reason they're distinguished at
// all — "sign-in failed" leaves them nowhere to go.
export const SIGN_IN_ERRORS = [
  "cancelled", // they backed out at Google's account chooser
  "expired", // the attempt went stale, or was started in another tab
  "wrong_domain", // a Google account outside NMBM's Workspace
  "unverified", // Google hasn't verified the account's email
  "deactivated", // U9: the account exists here and has been switched off
  "not_configured", // the OAuth client isn't set up yet — docs/GOOGLE_SETUP.md
  "google_failed", // Google or the network didn't complete the exchange
] as const;
export type SignInError = (typeof SIGN_IN_ERRORS)[number];

// Signed out after this long without a request. A shared tablet left
// on a desk with a participant's record open is the case this exists
// for; long enough that a worker writing up a visit isn't thrown out
// mid-note. Overridable with SESSION_IDLE_MINUTES — NMBM haven't been
// asked what they want here.
export const DEFAULT_SESSION_IDLE_MINUTES = 60;

// A hard ceiling regardless of activity: one working day.
export const SESSION_MAX_HOURS = 10;
