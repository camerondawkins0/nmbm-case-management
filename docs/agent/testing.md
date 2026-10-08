# Testing

176 tests in `packages/api/test/`, run by vitest against a real Postgres.
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
| `follow-up-schedule.test.ts` | M12 date arithmetic and milestone states, no database |
| `follow-ups.test.ts` | M12 queue, recording calls, one result per milestone, re-enrolment requests, readmission stopping the schedule |
| `search.test.ts` | R10 search scoping, wildcard escaping, intake's duplicate refusal and its audited override |
| `deployment.test.ts` | Sessions shared across instances and hashed at rest; the web build served with app routes and JSON 404s; security headers; production refusing a missing secret and dev sign-in; the Secure cookie behind a trusted proxy |
| `assessments.test.ts` | The show-if evaluator and publish checks (no database), then over HTTP: who can build, published versions frozen, drafts keeping stable ids, one draft, type changes refused, current version on start, answer validation and clearing, required-when-shown, hidden answers dropped on completion, completed final, void, caseload scoping, retired forms, closed episodes |
| `documents.test.ts` | Upload, confirm and open through the local storage stand-in; confirm refused until the file arrives; opaque keys; views audited; consent scans same-person only; type and size refused; tampered links refused; other workers' documents 404; void keeps the row and stops it opening |
| `csv.test.ts` | The formula-injection guard and RFC 4180 quoting, no database |
| `routes-authorized.test.ts` | Reads `packages/api/src` and fails on any route with neither `authorize()` nor a `PUBLIC_BY_DESIGN` entry, and on entries that are no longer open; no database |
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
| Unanswered call settling a milestone; milestones never lapsing; no early window; unclamped month arithmetic | follow-up-schedule, follow-ups |
| Second result allowed; calls allowed before due; schedule continuing after readmission; re-enrolment request surviving readmission | follow-ups |
| Queue open to any reader; Today counts shown to everyone | follow-ups |
| Search returning everything; intake seeing active records; wildcards unescaped | search |
| Duplicate guard off, or ignoring first name; override not audited | search |
| Sessions back in memory; ids stored unhashed; expired rows honoured; sign-out not deleting the row; anonymous sessions saved | deployment |
| Proxy never trusted; API 404s answered with the app; app routes not served; assets uncached; framing allowed; API responses cacheable; no HSTS | deployment |
| Production starting without a secret; dev sign-in in production | deployment (the second first went uncaught — see below) |
| Confirm not checking storage; pending rows listed; views not audited; voided file still opening; consent scan on another person; download not caseload-scoped | documents |
| Upload signature ignoring type; size not enforced; signature not checked; key carrying the participant id; any file type accepted | documents (the key mutation was first written as a no-op and redone) |
| Production falling back to local disk; CSP blocking uploads to Cloud Storage | deployment |
| Published version editable; new draft with fresh stable ids; two drafts; type change, forward reference or stale option allowed at publish; start on the oldest version | assessments |
| Answers unchecked; unknown questions accepted; clearing ignored; required ignoring visibility; hidden answers kept; completion unaudited; start or read not caseload-scoped; retired form or closed episode startable | assessments |
| Hidden answers still driving a chain; unanswered satisfying "is not"; multiple choice compared as text; a CHW able to build forms | assessments |
| A completed assessment editable | assessments — only with both guards broken: the save also refuses at the `UPDATE`, so breaking the first alone changes nothing |
| CSV guard removed; plain numbers guarded; carriage return unquoted; headers unguarded | csv |
| A route with no gate; a stale `PUBLIC_BY_DESIGN` entry; the bracket matcher stopping early | routes-authorized |

One mutation during the M12 work crashed the SQL rather than changing
its meaning, which proves nothing; it was redone as a clean change and
caught. A mutation only counts if the failure is the rule, not a syntax
error.

The deployment work found another kind of miss: the test for "no dev
sign-in in production" signed in as a user who didn't exist, so a
wrongly enabled route answered 404 "no such user" — identical to the
route being absent. It now uses a real account. A refusal test has to
be one the broken code would actually answer differently.

The first pass of this found one gap — removing the open-episode filter
went unnoticed, because closing also ends the assignment so a worker's
list was still right. A supervisor's list is where the filter is the only
guard, and there was no test of it.

## The route guard

`routes-authorized.test.ts` is a static scan, not a runtime check. It
finds `fastify.get(`/`post(`/… calls, matches brackets to get the whole
call, and looks for `authorize(` or `authorizeAny(` inside it. A new
route without one fails until it gets a preHandler or a
`PUBLIC_BY_DESIGN` entry with the reason it's open. The list can only
shrink in the sense that matters: an entry that becomes guarded fails
the stale-entry test until it's removed, so the list never claims a
door is open when it isn't.

## What isn't covered

- **The web app.** No component or browser tests; the pages have been
  checked by driving them with Playwright by hand.
- **Real Cloud Storage.** Tests use the local stand-in. The signed-URL
  code for GCS is Google's library; the bucket's CORS, retention and
  the service account's lack of delete are set by `deploy/setup-gcp.sh`
  and checked by hand after the first deploy (DEPLOY.md).
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
