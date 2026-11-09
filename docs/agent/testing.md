# Testing

217 tests in `packages/api/test/`, run by vitest against a real Postgres.
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
| `consents-referrals.test.ts` | M16 expiry from enrollment; M17 release gate and its three refusal reasons |
| `disenrollment.test.ts` | R10: off the caseload on close, closed-record access (intake, last worker, window and its 90-day cap), readmission starting a fresh run |
| `attendance.test.ts` | M14 whole-roster marking, correction not duplication, off-roster refusal, recorder names, disenrolled people flagged not withdrawn |
| `sign-off.test.ts` | U6 notes and care plans reviewed by someone other than the author; a returned note listed to its author only, revised back into the queue without the old reason, by its author only, never once approved |
| `program-setup.test.ts` | Who can set programs up; duplicate program names; dates in order; dates, roster and withdrawal keeping attendance; enrollment scoped to who the enroller can see; the cohort status table, closed cohorts refusing people and dates, reopening, canceled final, audit |
| `follow-up-schedule.test.ts` | M12 date arithmetic and milestone states, no database |
| `follow-ups.test.ts` | M12 queue, recording calls, one result per milestone, re-enrollment requests, readmission stopping the schedule |
| `search.test.ts` | R10 search scoping, wildcard escaping, intake's duplicate refusal and its audited override |
| `deployment.test.ts` | Sessions shared across instances and hashed at rest; the web build served with app routes and JSON 404s; security headers; production refusing a missing secret and dev sign-in; the Secure cookie behind a trusted proxy |
| `assessments.test.ts` | The show-if evaluator and publish checks (no database), then over HTTP: who can build, published versions frozen, drafts keeping stable ids, one draft, type changes refused, current version on start, answer validation and clearing, required-when-shown, hidden answers dropped on completion, completed final, void, caseload scoping, retired forms, closed episodes |
| `self-serve.test.ts` | The participant's link: nothing stored in plain, passcode before anything, cookie tied to its own link, lockout, the participant's answers filed as theirs with a null audit actor, idle timeout, expiry and closure, staff kept out of a participant's form, replace and withdraw, caseload scoping |
| `incoming-referrals.test.ts` | The queue's permission; notes and closing; admitting through intake and readmission settling the referral in the same transaction (and rolling back if it was already dealt with); the queue permission on both admit routes; linking only to a visible, open record; when the referrer is owed an outcome, and recorded once; audit |
| `record-export.test.ts` | Who can export; purpose required; the audit line with the purpose; the whole record with answers in words; scoping through a role that can export but only sees its own caseload |
| `documents.test.ts` | Upload, confirm and open through the local storage stand-in; confirm refused until the file arrives; opaque keys; views audited; consent scans same-person only; type and size refused; tampered links refused; other workers' documents 404; void keeps the row and stops it opening |
| `csv.test.ts` | The formula-injection guard and RFC 4180 quoting, no database |
| `routes-authorized.test.ts` | Reads `packages/api/src` and fails on any route with neither `authorize()` nor a `PUBLIC_BY_DESIGN` entry, and on entries that are no longer open; no database |
| `sign-in.test.ts` | OAuth state, refusal reasons, session regeneration, idle timeout, form-post sign-out, audit |

`staffWith(db, [permissions])` in `test/support/fixtures.ts` makes a
role for the test — for rules no seeded role reaches (an exporter with
an ordinary caseload; an admitter without the referrals queue).

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
| Close no longer ends the assignment | disenrollment: deactivation, former-worker window, readmission |
| Active list stops filtering on open episode | disenrollment: read-all list (added after this first went uncaught) |
| No-contact view counts per person, not per episode | disenrollment: readmission starts a fresh run |
| Referral release gate skipped | all three refusal-reason tests |
| Consent expiry anchored to signing date | consent expiry from enrollment |
| M6 five-attempt gate / Molina letter gate removed | no-contact |
| Former-worker access not tied to the worker, or to any past worker rather than the last | disenrollment |
| `read.closed` reaching active cases | disenrollment: intake gets nothing active |
| Notes on a closed episode; reassigning a closed record | disenrollment |
| Readmission not linked to the previous episode | disenrollment |
| Former-worker ceiling back to 365 | disenrollment: cap |
| `read.all` not accepted on caseload routes | authorization |
| Caseload scoping dropped | authorization |
| Participation outcome back to pass/fail | rules: perfect attendance part-way is in progress |
| Re-marking inserts a second row; off-roster marks accepted; roster flag never set | attendance |
| OAuth state unchecked; session not regenerated; idle timeout ignored; return path unsanitized; sign-out form parser removed | sign-in, rules |
| CHW note not queued; note returned without a reason | sign-off |
| Unanswered call settling a milestone; milestones never lapsing; no early window; unclamped month arithmetic | follow-up-schedule, follow-ups |
| Second result allowed; calls allowed before due; schedule continuing after readmission; re-enrollment request surviving readmission | follow-ups |
| Queue open to any reader; Today counts shown to everyone | follow-ups |
| Search returning everything; intake seeing active records; wildcards unescaped | search |
| Duplicate guard off, or ignoring first name; override not audited | search |
| Sessions back in memory; ids stored unhashed; expired rows honored; sign-out not deleting the row; anonymous sessions saved | deployment |
| Proxy never trusted; API 404s answered with the app; app routes not served; assets uncached; framing allowed; API responses cacheable; no HSTS | deployment |
| Production starting without a secret; dev sign-in in production | deployment (the second first went uncaught — see below) |
| Confirm not checking storage; pending rows listed; views not audited; voided file still opening; consent scan on another person; download not caseload-scoped | documents |
| Upload signature ignoring type; size not enforced; signature not checked; key carrying the participant id; any file type accepted | documents (the key mutation was first written as a no-op and redone) |
| Production falling back to local disk; CSP blocking uploads to Cloud Storage | deployment |
| Published version editable; new draft with fresh stable ids; two drafts; type change, forward reference or stale option allowed at publish; start on the oldest version | assessments |
| Answers unchecked; unknown questions accepted; clearing ignored; required ignoring visibility; hidden answers kept; completion unaudited; start or read not caseload-scoped; retired form or closed episode startable | assessments |
| Hidden answers still driving a chain; unanswered satisfying "is not"; multiple choice compared as text; a CHW able to build forms | assessments |
| A completed assessment editable | assessments — only with both guards broken: the save also refuses at the `UPDATE`, so breaking the first alone changes nothing |
| Passcode unchecked; never locking; a locked, expired, voided or closed-enrollment link still opening; idle timeout ignored; token stored or looked up in plain; old link surviving a replacement; link not spent on submit | self-serve |
| Cookie not tied to its link | self-serve — missed at first: the test reused a cookie on a link nobody had unlocked, which refused for another reason. It now unlocks the second link first |
| A submitted link still opening | self-serve — only with both guards broken: the form is no longer in progress either |
| Staff able to edit a participant's form; the view leaking the participant; cookie Lax or site-wide; a lock blamed on staff; participant audit rows hidden from the admin; link routes not caseload-scoped | self-serve |
| Queue open to every worker; a note not marking it in hand; notes on or closing a dealt-with referral; intake or readmission not settling it; admitting from a dealt-with referral; either admit route ignoring the queue permission; linking unscoped or onto a closed record; outcome owed for a self-referral or entered-in-error; referred-by missing from the record; close unaudited | incoming-referrals |
| Outcome reported twice | incoming-referrals — only with both guards broken: "is an outcome owed" refuses first, the update's `outcome_reported_at is null` is the race guard |
| Workers able to export; "other" without words; export unaudited or audited without the purpose; answers as stored codes; export unscoped; notes left out | record-export |
| Outbound referral outcome not caseload-scoped | consents-referrals — a real gap found while building referrals in; fixed with this test |
| Any status change allowed; canceled reopenable; running → running; no reopening; dates on a closed cohort; a cohort ending before it starts; status change unaudited; enrollment unscoped; workers setting up programs; withdrawal losing its reason | program-setup |
| Returned list showing everyone's; revision keeping the old reason or not requeueing; anyone revising; approved notes revisable | sign-off |
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
  checked by driving them with Playwright by hand. One thing found that
  way: participant search left the previous results on screen while a
  new search ran, so an "Add to roster" button could act on the wrong
  person. Results now clear as soon as the text changes.
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
