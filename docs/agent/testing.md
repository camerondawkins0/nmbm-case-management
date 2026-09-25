# Testing

83 tests in `packages/api/test/`, run by vitest against a real Postgres.
CI runs them on every push with a Postgres 16 service.

```bash
TEST_DATABASE_URL=postgres://user:pass@host:port/any_db npm test
```

Each run creates a fresh database on that server (`nmbm_test_<time>_<pid>`),
builds it with the real migrations and the real reference seed, and
drops it at the end. The database named in the URL is only used to issue
`CREATE DATABASE`; nothing is written to it. `DATABASE_URL` works too if
`TEST_DATABASE_URL` isn't set. Build `@nmbm/shared` and `@nmbm/db` first —
tests import them from `dist` like everything else.

## Why a real database

The rules that matter most live partly in SQL: caseload scoping is a
query, the no-contact run is a view, and one-open-episode-per-person is a
partial unique index. A mocked database would test the mock. So tests go
through `app.inject()` against the real server, signed in through the real
dev-login route, and assert on HTTP responses.

## Layout

| File | Covers |
|---|---|
| `rules.test.ts` | Pure functions, no database: the M6 ladder, M9 clocks, participation outcome, consent status, sign-in return path |
| `authorization.test.ts` | 401/403, read-all vs read-own, U5 caseload scoping, not-found for another worker's id |
| `no-contact.test.ts` | M6 close gate, Molina letter, the run resetting on contact, other exits unblocked |
| `consents-referrals.test.ts` | M16 expiry from enrolment; M17 release gate and its three refusal reasons |
| `disenrolment.test.ts` | R10: off the caseload on close, closed-record access (intake, last worker, window and its 90-day cap), readmission starting a fresh run |
| `attendance.test.ts` | M14 whole-roster marking, correction not duplication, off-roster refusal, recorder names, disenrolled people flagged not withdrawn |
| `sign-off.test.ts` | U6 notes and care plans reviewed by someone other than the author |
| `sign-in.test.ts` | OAuth state, refusal reasons, session regeneration, idle timeout, form-post sign-out, audit |

`test/support/fixtures.ts` builds people through the real services
(`admit()` goes through intake), with unique names, so tests don't depend
on each other or on the demo seed. Files run one at a time because a few
tests change the former-worker window setting; each restores it.

## Every test has been proved by breaking the code

Hard rule 8. Each rule below was broken on purpose, the suite run, and the
change reverted. A test that still passes against broken code is not a
test.

| Rule broken | Caught by |
|---|---|
| Close no longer ends the assignment | disenrolment: deactivation, former-worker window, readmission |
| Active list stops filtering on open episode | disenrolment: read-all list (added after this first went uncaught) |
| No-contact view counts per person, not per episode | disenrolment: readmission starts a fresh run |
| Referral release gate skipped | all three refusal-reason tests |
| Consent expiry anchored to signing date | consent expiry from enrolment |
| M6 five-attempt gate / Molina letter gate removed | no-contact |
| Former-worker access not tied to the worker, or to any past worker rather than the last | disenrolment |
| `read.closed` reaching active cases | disenrolment: intake gets nothing active |
| Notes on a closed episode; reassigning a closed record | disenrolment |
| Readmission not linked to the previous episode | disenrolment |
| Former-worker ceiling back to 365 | disenrolment: cap |
| `read.all` not accepted on caseload routes | authorization |
| Caseload scoping dropped | authorization |
| Participation outcome back to pass/fail | rules: perfect attendance part-way is in progress |
| Re-marking inserts a second row; off-roster marks accepted; roster flag never set | attendance |
| OAuth state unchecked; session not regenerated; idle timeout ignored; return path unsanitised; sign-out form parser removed | sign-in, rules |
| CHW note not queued; note returned without a reason | sign-off |

The first pass of this found one gap — removing the open-episode filter
went unnoticed, because closing also ends the assignment so a worker's
list was still right. A supervisor's list is where the filter is the only
guard, and there was no test of it.

## What isn't covered

- **The web app.** No component or browser tests; the pages have been
  checked by driving them with Playwright by hand.
- **The Google token exchange itself.** Tests stop at the redirect; nobody
  can reach Google from CI, and the verification is Google's library.
- **Migration 0006's repair of stale assignments.** Rehearsed by hand
  against a staged copy; not in the suite, because a fresh test database
  never has the stale state.
- **Smaller paths:** feedback, role grant/revoke and the last-administrator
  guard, referral outcome recording, the dashboard's referral chasing,
  care-plan editing and resubmission.

When adding a test: build what it needs with the fixtures, assert on the
response, then break the rule and watch it fail before trusting it.
