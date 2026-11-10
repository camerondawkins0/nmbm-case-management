# Invariants

Rules that come from NMBM's own discovery answers, not from convention.
Breaking one of these isn't a style issue — it's building the wrong thing.

## Void, not delete (M30)

Every domain table that represents something a user can "remove" gets a
status/void pattern instead of a `DELETE`. Matches WSL's hard rule, and
NMBM confirmed it directly: "I like the voiding of it to be able to get
the information."

## Caseload is server-side scoped (U5)

"Own assignments" means the `repository.ts` query filters by the caller's
assignments — never a client-side filter on a full list. A front-line CHW
who can, in principle, fetch another worker's participant by guessing an
ID is a bug here, not an edge case.

## Sign-off chains are real gates, not just visibility (U6)

- Clinical Director reviews/approves care plans for CHWs.
- CHW supervisor or Program Manager approves CHW notes, or returns them
  for revision.
- Clinical Director reviews notes and treatment plans for APCC/ACSW
  interns.

"Return for revision" is a state, not a delete-and-redo — the note or
plan stays, gets a status, and the original author can see why it bounced.

## No-contact counting is payer-conditional (M6)

Three consecutive failed contact attempts → prompt the CHW to prepare
exit documentation; two more non-contacts after that before disenrollment
is allowed. For Molina clients specifically, the 3rd attempt also
requires sending a specific disenrollment-warning letter. This is not a
generic "3 strikes" rule — the Molina branch is a distinct, required
step, not an optional notification.

Both halves are a gate on the close action, not a banner next to it:
`closeEpisode` refuses and says how many attempts are still needed, or
that the letter has to be recorded first. The gate binds **only the
`no_contact` closure reason** — somebody who completes the program,
moves away or asks to leave exits without any of this, and blocking
those would be inventing a rule NMBM never asked for.

## Care plan has two independent clocks (M9)

1. A 30-day completion countdown starting at enrollment.
2. A recurring review nudge every 2 weeks while the plan is still open.

These don't collapse into one clock — a plan can be late on the
completion deadline and still be due for its next 2-week review, and the
UI has to be able to say both at once.

## Consents expire a year after enrollment, not after signing (M16)

NMBM's words were "our consents can expire at a year after the client is
enrolled" — the anchor is the episode's start date, not the signature.
The two differ for anything signed mid-episode, and the earlier scaffold
had this wrong. `recordConsent` computes the expiry from the open
episode and stores which episode it counted from, so the working can be
shown. Still marked "are we in agreement" in discovery.

Whether a consent has expired is **derived at read time** from that
date, never read off the stored status column. A row saying "active"
next to a date in the past is precisely the bug that lets an expired
authorization release someone's information, and nothing here runs a job
to keep a stored status honest. `status` only carries a decision a
person made: revoked.

## A referral needs a signed release, and that one blocks (M15/M17)

M15 asked whether a signature "unlocks something else, like a referral".
It does, and unlike other consent gates this one refuses rather than
warns: sending a participant's information to an outside agency without
a current release isn't NMBM's preference to weigh, because there is
nothing authorizing the disclosure. The refusal distinguishes *no
release on file*, *expired* and *revoked*, because those lead to
different next actions.

The open half of M16 — whether a missing form should stop other work in
general — stays open. This rule doesn't settle it and shouldn't be read
as having settled it.

Revoking a release stops new referrals but leaves existing ones pointing
at it. What was authorized at the time is a fact about the past, and the
referral records which consent authorized it.

## Disenrollment archives immediately, but never hides the record (R10)

When an episode closes, the participant drops out of the active caseload
*right away* — not on a nightly job, not eventually. NMBM's framing: they
want "active" to stay accurate without checking by hand. The record
itself stays fully retrievable, for a returning participant or a
contractor/grantor request.

How that's held, and what must not be undone:

- **Active means an open episode**, decided in the query
  (`participants/repository.ts`), never by the page hiding rows. The
  dashboard and caseload counts follow from it.
- **Closing ends the assignment in the same transaction.** An assignment
  is responsibility for an active case, so nobody holds a closed one —
  which is also what keeps U9's "reassign before deactivating" check
  from being blocked by people who have already left. Ended, not
  deleted: who held the case stays answerable.
- **The M6 run belongs to an episode.** `v_no_contact_counts` (0006)
  counts notes within the open episode only, and a note can only be
  filed against the open episode. Counted per person, somebody
  disenrolled for no contact would come back already at three strikes.
- **One open episode per participant**, enforced by a partial unique
  index rather than by every writer remembering to check.
- **Closed records are a separate question**, answered three ways
  (`lib/caseload.ts`):
  - `participants.read.all` sees everything, closed included.
  - `participants.read.closed` (intake) sees every *closed* record and
    no active one — enough to find a returning participant and readmit
    them, without sight of every caseload.
  - The **last** assigned worker keeps read-only sight of a closed case
    for `former_worker_access_days` — at most 90 days, which is also
    the default; the Settings page can shorten it, never extend it.
    Changes are audited. Only the last: someone who handed the case on
    before it closed gets nothing. Readmission ends it, because the
    case is active again and belongs to whoever holds it now.
  The same rules decide both the Closed list and the by-id lookup, so a
  record can't be listed and then refuse to open, or the reverse.
- **Readmission, not a second intake.** `POST /api/episodes` opens a new
  episode linked to the last one, with a named worker, in one
  transaction — the same one act as intake. Reassignment on a closed
  record is refused: readmission is the way back.

Disenrollment does not withdraw anyone from a program cohort. NMBM:
disenrollment "means they are no longer receiving or participating in
services with the provider" — a court-ordered class may carry on
regardless. The roster flags them with the date services ended and
leaves the enrollment and its attendance alone.

Retention is separately confirmed at 7 years (R6, California state
requirement) — that governs when a closed record eventually leaves
storage, not when it leaves the active view.

## Work is reviewed by someone other than its author (U6)

Both halves of the sign-off chain now exist — care plans and notes —
and they behave the same way on purpose:

- Submitting and approving are different permissions. A CHW holding
  `care_plans.write` or `notes.write` cannot sign off their own work.
- Returning requires a reason, and the reason is shown to the author on
  the record they're fixing. A bounce with no explanation just costs
  them another round trip.
- "Returned" is a state, never a deletion. The row keeps its id, its
  author and its history.
- **Two chains, routed by permission.** A note whose author holds
  `notes.reviewed_clinically` (interns, by default) goes to clinical
  review and only a `notes.approve.clinical` holder (the Clinical
  Director) can approve or return it; any other note needs
  `notes.approve`. Each reviewer's queue lists only what they can sign.
  Which chain a note is in is fixed when it's written
  (`notes.clinical_review`), so changing the author's roles later doesn't
  move notes already queued.
- `notes.reviewed_clinically` is a restriction, not access
  (`RESTRICTION_PERMISSIONS`): not holding it doesn't stop a staff
  manager giving a role that has it.
- A note written by someone who could sign off its own chain is approved
  on creation rather than queued. There is nobody above them, so
  queueing it would park it forever. Whether NMBM wants that is flagged
  in `docs/DISCOVERY_FOLLOWUP.md`.

## One care plan per stay, on the client's own stay (M9)

The record, the caseload list and both M9 clocks read "the" plan of an
episode. A plan can only be added to the participant's open episode, and
a unique index on `care_plans.episode_id` refuses a second (two arriving
at once included). Before this, a second plan saved, never showed, and
listed the client twice. A readmission's new episode takes its own plan.

## A case goes only to somebody who can work it (M4/U5)

Admission, readmission and reassignment refuse a worker who can't both
write notes and see clients (`notes.write` plus `participants.read.own`
or `.all`, through an active role — `assertCaseloadWorker`). Otherwise
a case lands on the system administrator or QA, and its no-contact
ladder and care plan clocks run on nobody's screen. The picker offers
the same people (`/api/participants/assignable-workers`);
`?for=facilitator` is everyone active, because running a class isn't
holding a caseload.

## A note's date is when the contact happened (M6)

- `notes.service_date` is the day of the contact; `created_at` is when it
  was written up. Default today, **in Pacific time** (`todayInOrg`) —
  the server runs on UTC, and a 6pm note is still that day's.
- Not in the future, not before the stay began. Correctable when the
  note is returned for revision, within the same limits.
- M6's run (`v_no_contact_counts`, migration 0018) is in order of
  service date, then when written: a missed call logged late doesn't
  count if a contact came after it, and a late-logged earlier contact
  doesn't reset later misses.

## Every consequential action leaves a trail (M30)

`writeAudit` is called by the service that performs the action, inside
the same transaction where there is one. There is no write endpoint for
the log and no way to edit it through the app — `/api/admin/audit` is
read-only. Adding a new action that changes participant data, staff
access or case ownership means adding an audit line with it.

## Nobody is deactivated out from under a caseload (U9)

Deactivating a user is refused while they hold open assignments, and
the refusal names the participants so the supervisor knows what to
reassign. The account is never deleted — past notes keep their author.

## Attendance is evidence, not a tally (M14)

NMBM's answer named the audience: "The PO's or whomever, will need
proof the person participated in the class." That makes three things
non-negotiable:

- Every mark records who made it and when, and the participation record
  shows those names. A count nobody can trace is worth nothing to a
  probation officer.
- "Excused" is a separate status from "absent", because the reader
  cares which it was.
- Withdrawing somebody from a cohort never removes their marks. The
  classes they did attend still happened.

Re-marking a session corrects the existing row rather than adding a
second one — a person cannot be both present and absent for one class.
Marks are refused for anyone not on that cohort's roster, which would
otherwise put a class in someone's record they were never enrolled in.

A cohort's status is a decision a person makes, so it's stored:
planned → running or canceled; running → completed or canceled;
completed → running (reopened, for a class closed too early). Canceled
is final — run it again as a new cohort, so the rosters stay apart. The
server holds the table (`COHORT_STATUS_CHANGES` in `@nmbm/shared`), the
change is conditional on the status it was read as, and it's audited.
A completed or canceled cohort takes no new people and no new class
dates; attendance can still be corrected after the fact.

What completing a program takes is NMBM's to set, per program:
present always counts, absent never does, and whether late and excused
count are switches (`late_counts` on, `excused_counts` off to start;
`countedStatuses` in `@nmbm/shared` is the one place that decides).
The program's default number of classes is copied to each new cohort,
which can change its own. Changing a rule recounts every enrollment
in the program, past ones included, so the change is audited with
before and after, and the participation record states the rule in words.
A retired program keeps its cohorts and records and takes no new cohorts.

A completion threshold is optional because NMBM may leave it blank. Where it exists, the record reports four states rather than
a pass/fail: a person with perfect attendance in week 7 of 12 has not
failed anything, and must not be described to a court as though they
had.

## Intake is one act, not three screens (M3/M4)

Admission writes the participant, the episode that starts the M9 clock,
and the named worker in a single transaction. A participant can never
exist in the half-state of being enrolled with nobody responsible for
them, because that state is what a person falls through. The same
transaction is where the care plan due date is computed, so the clock
starts from the episode NMBM actually recorded rather than from whenever
someone next opened the record.

Intake also takes contact details, address, Medi-Cal CIN, plan member ID
and an emergency contact, all optional while M3 is unanswered. Phones are
stored as ten digits; the CIN is checked as eight digits and a letter.
A Medi-Cal CIN is unique across records (partial unique index): the same
CIN is the same person or a typo, so unlike a name match it can't be
confirmed past. Details are changed afterward with
`participants.update`, and the audit line names the fields changed,
never their values.

## State a person could be wrong about is derived, not stored

Three things are computed at read time rather than kept in a column:
whether a consent has expired, how long the current run of failed
contacts is, and where somebody stands against a program's completion
threshold. All three share a failure mode — a stored value drifts
silently, and nothing here runs a job to keep it honest, so the row
would go on asserting something false until a person noticed. An
expired release that still reads "active" is how information leaves the
building without authorization.

Stored status columns carry only decisions a person made: revoked,
returned, closed, withdrawn. Those don't drift, because nothing but a
human action changes them.

## Authorization is a permission code, never a role name

Route code checks `authorize("notes.approve")`, never "is this user a
Program Manager". Roles are a bundle of codes in
`packages/shared/src/permissions.ts`, and NMBM's role list is explicitly
still unconfirmed (U1/U3). When it changes, the grid changes and no
route does. Two consequences worth keeping:

- `participants.read.all` does not imply `participants.read.own`. A
  route that accepts either uses `authorizeAny(CAN_READ_PARTICIPANTS)`.
- Hiding a nav link or a button is a convenience for the person using
  the app, never the control. The check that matters is on the endpoint.


**NMBM own the grid.** `DEFAULT_ROLE_PERMISSIONS` is the starting point;
the Permissions page (`admin.roles.manage`) changes it.

- A change takes effect on the next request (permissions are read per
  request) and is audited.
- It's stored as a difference from the default in
  `role_permission_overrides`. Setting a box back to its default removes
  the difference, so later changes to the defaults reach that role again.
- The release job applies defaults *with* the differences, so a deploy
  never undoes NMBM's choice, and a permission new to the code still
  reaches the roles it's meant for.
- A change is refused if it would leave no *active* person holding
  `admin.roles.manage` or `admin.users.manage` (`LOCKOUT_PERMISSIONS`):
  nobody could undo it from the app.
- Only the nine built-in roles are managed this way.

**NMBM add roles of their own** (`roles.builtin = false`).

- A custom role holds exactly what it was given; it has no default, so
  no stored differences, and the release job never touches it.
- Its code is generated (`custom_<slug>_<hex>`), never typed, so it
  can't take a built-in role's code or one the code adds later.
- Names are unique among active roles, ignoring capitals.
- Built-in roles can't be renamed or retired: they're named in NMBM's
  discovery answers and in these docs.
- A role is **retired**, not deleted, and only once nobody holds it, so
  retiring is never a way to take access from people. A retired role
  grants nothing (`getPermissions` joins on `roles.active`), counts for
  nothing in the lockout check, and can't be given or changed.

**Guardrails on who can do what** (`admin/permissions.ts`).

- The lockout check runs inside the transaction of *every* change that
  could remove the last holder — a grid change, taking a role from
  someone, deactivating someone — and counts active people holding an
  active role. It's by permission, not by role name, because any role
  can now carry the administrative permissions.
- **No giving access you don't have.** Giving someone a role, or
  reactivating someone, is refused if the role carries a permission the
  actor lacks (`assertActorHoldsRole`). Without it, `admin.users.manage`
  would be a route to every permission. Holders of `admin.roles.manage`
  are exempt: they could add the permission to their own role anyway,
  in the open on the Permissions page.
- Only permissions the code defines can be granted. A row in
  `permissions` the code doesn't know is refused: nothing would check it.
- The page's warnings (`permissionWarnings`, e.g. "Write notes" with no
  way to see a client) are advice, not rules: the server already
  refuses each action on its own terms.
## Follow-up calls are derived from the closure, and settle once (M12)

- **Nothing about the schedule is stored.** Due dates come from the
  episode's end date, every time they're asked for
  (`lib/follow-ups.ts`). Only the calls are rows. A stored "due" column
  would disagree with a corrected end date and nobody would notice.
- **Every attempt is a row.** "Tried three times, no answer" is on the
  record, not collapsed into the eventual result.
- **A milestone is settled once** — by a reached, declined or
  wrong-number call. An unanswered call leaves it owed. The database
  enforces one settling result per milestone, because a second
  "reached" would double-count in any report built on this.
- **Readmission stops the old schedule.** Only a participant's latest,
  closed episode is followed up; once they're back in services there's
  nobody to call. The new episode gets its own schedule when it ends.
- **"Wants services again" is a list, not a task to check off.** It's derived
  — anyone reached who asked to come back and hasn't been readmitted
  since — so readmitting them is what clears it.
- A missed milestone drops out of the queue when the next one falls due
  (the last one at 15 months). That rule is ours, not NMBM's, and is
  flagged in `docs/DISCOVERY_FOLLOWUP.md`.

## A returning participant is found, not re-created (R10)

- Search returns only records the searcher could open, under the same
  three rules as the record itself. It must never be a way to learn
  that someone is on another worker's caseload.
- Intake refuses a new record with the same date of birth and the same
  first *or* last name — loose on purpose, so a changed last name doesn't
  slip through. The refusal doesn't say whose record matched, since the
  person at the desk may not be allowed to open it. They can override it
  by confirming it's a different person, and the override is written to
  the audit log.

## Sign-in says why it refused, and never trusts the browser's word (M27)

- The Google round trip carries a one-use `state` token bound to the
  session. Without it, anyone could complete sign-in in a victim's
  browser with the attacker's own authorization code, and the victim
  would enter participant notes into the attacker's account.
- The domain is checked on the verified token, not trusted from the
  `hd` hint, and there is no default domain: unset means refuse.
- A fresh session id is issued at sign-in, so an id planted beforehand
  never becomes an authenticated one.
- `returnTo` is re-checked on the server as a same-origin path. The
  login page passes it; it is not trusted from there.
- Every refusal has its own code in `SIGN_IN_ERRORS` and its own words
  on the login page, because each has a different next step for the
  person at the screen. A deactivated account is refused with its own
  message — it still exists, so Google will vouch for it.
- Sessions end after an idle period (default 60 minutes,
  `SESSION_IDLE_MINUTES`) and after a hard ceiling. A session that ends
  mid-page sends a *load* back through sign-in, but never a *save*:
  navigating away there would discard a note the worker just typed.
- Sign-in, sign-out, refusals and first-time provisioning are audited.
- Sessions live in Postgres, so every instance shares them and a deploy
  signs nobody out. The table is keyed by a SHA-256 of the session id,
  never the id — whoever can read the database still can't become a
  signed-in user. Anonymous requests never write a row.

## A document is on the record only once it's in storage (M15/M30)

Uploading is three steps, and the record changes only on the last:

1. `POST /api/participants/:id/documents` writes a `pending` row and
   returns a signed link, good for 15 minutes, that only accepts the
   declared type at up to 10 MB. The file goes from the browser to
   Cloud Storage directly; it never passes through the app.
2. The browser `PUT`s the file to that link.
3. `POST /api/documents/:id/confirm` asks storage whether the object is
   there, and only then marks the row `uploaded`. It doesn't take the
   browser's word for it, and only the person who started the upload can
   confirm it.

Rules that hold throughout:

- **Pending rows are invisible.** A link that was never used leaves a
  pending row nobody sees, never an entry that opens to nothing.
- **Storage keys are opaque** (`documents/<uuid>`). No name, no
  participant id: a bucket listing, a log line or a leaked link says
  nothing about whose paperwork it is.
- **Only scans and photos.** PDF, JPEG, PNG, HEIC, WebP. Not office
  files, which carry macros, and not HTML or SVG, which a browser runs.
- **Opening is audited.** Every download link issued writes
  `document.viewed`, not only uploads and voids — looking at someone's
  ID is the access event that matters.
- **Voided is kept but not openable.** Void usually means "filed against
  the wrong person"; keeping it openable would leave one client's
  paperwork viewable from another's record. The object stays in the
  bucket under a retention policy, and the runtime service account has
  no delete permission, so the app couldn't remove it if it tried.
- **A consent scan belongs to the same person.** `consentId` must be a
  consent on that participant's record, or the request is refused.
- Every document route applies `canSeeParticipant`, and out of scope
  answers 404, not 403.

## A published form never changes; an answer is read against its own version (M11/M13)

NMBM's forms (the registration form, the needs assessment) are built in
the app, not in code. No scoring: M11 says no licensed instruments.

- **Published is frozen.** `PUT .../questions` and `publish` refuse
  anything but a draft. Editing a form starts a new draft copied from
  the live version, and there is one draft per form at a time (partial
  unique index). The live version is the highest published one —
  derived, never flagged.
- **Every assessment points at the version it was filled in on**, so a
  later edit never puts new wording next to an old answer.
- **Stable ids carry across versions.** Answers and show-if rules key on
  a question's `stable_id`, and options on their `value`, so rewording
  either doesn't orphan anything. A question can't change kind of answer
  (text to number, say) across versions — publish refuses; add a new one.
- **Show-if rules only look backward**, and must name options the
  earlier question still has. Checked at publish, not on save, because
  drafts are written out of order. The evaluator (`visibleQuestionIds` in
  `@nmbm/shared`) is the only answer to "which questions apply", used by
  the API and every screen.
- **An unanswered question satisfies no condition**, not even "is not
  Yes". Somebody who skipped a gate hasn't answered it.
- **Required means required when shown.** A hidden follow-up never
  blocks completion.
- **Completing keeps only what was asked and answered.** Answers to
  questions that ended up hidden are kept while the form is open (so
  Yes → No → Yes doesn't lose the explanation) and dropped on completion.
- **Completed is final.** A correction is a void, with a reason, and a
  new assessment. Voided ones stay readable.
- Started only on an open episode, filed against it, and saved or
  completed only while that episode is open. Scoped like the record;
  out of scope is 404. Start, complete and void are audited.
- Saves send only the changed questions and merge in SQL, so two people
  on one form don't overwrite each other.

## A participant's link opens one form and says nothing else (M13)

The case manager makes a link and a 6-digit passcode on the record and
passes them on themselves — the app sends nothing, so no SMS or email
provider is involved. They're meant to travel separately, so a forwarded
email alone doesn't open the form.

- **Only hashes are stored.** The link's secret (256 bits) and the
  passcode exist in plain form only in the response that creates them.
  Lost passcode means a new link.
- **Five wrong passcodes lock the link**, counted in SQL so parallel
  guesses can't share a low count. Locked stays locked.
- **The passcode earns a cookie** scoped to `/api/self-serve/<token>`
  (HttpOnly, SameSite=Strict), checked against a hash on the link, and
  it lapses after 30 idle minutes. One browser at a time.
- **Every way a link stops working looks the same to the holder** (404,
  "ask your case manager"): expired (`self_serve_link_days`, 1–30,
  default 7), withdrawn, replaced, locked, submitted, the form voided or
  completed, or the enrollment closed. The record says which.
- **The participant sees the form and nothing else** — no name, no ids,
  no case manager. `participantView` returns three keys.
- **Same rules as staff** for answers and completion: the participant
  path calls the same `saveAnswers` and `complete`.
- **Each side keeps to its own form.** Staff can't edit or complete a
  `self` assessment (they can void it); the link can't touch any other.
  The participant's words stay theirs.
- **Submitting completes it** with `completed_by_id` null, and spends
  the link. Audit rows for what the participant did have a null actor
  and show as "Participant (own link)"; naming the staff member who
  issued the link would say they did it.
- Making, replacing and withdrawing a link are caseload-scoped and
  audited.

## A referral in ends admitted or closed, and the referrer hears (M17, R5)

- **The queue is `incoming_referrals.manage`'s** (intake, Clinical
  Director, Program Manager). It holds names of people who aren't
  participants yet. Once admitted, "referred by" shows on the record to
  anyone who can open it.
- **new → contacting → admitted | closed.** A note marks it in hand.
  Closed needs a reason; "entered in error" is how a mistake goes away.
  Nothing is deleted. DB checks: admitted has a participant and episode,
  closed has a reason.
- **Admitting settles it in the same transaction.** Intake
  (`POST /api/participants/intake`) and readmission (`POST /api/episodes`)
  take `incomingReferralId`. If the referral was already dealt with, the
  whole admission rolls back. Readmission is the path for a returning
  client, because once the record is active again intake can't see it
  to link afterward. `link` is only for somebody already active, and
  needs sight of their record.
- **Using a referral to admit needs the queue permission too**, on both
  routes. No default role admits without it, but grants are NMBM's to
  change.
- **The referrer is owed the outcome** once a referral is admitted or
  closed, unless it was a self-referral or closed as duplicate / entered
  in error. "Referrer told" is recorded once, with who.
- Recorded, closed, admitted and outcome-reported are audited.

## Exporting a whole record is a disclosure (HIPAA right of access)

- **`records.export`** — Clinical Director and QA to start. Separate from
  reading: a worker who can open a record can't export it.
- **A purpose is required** (participant request, legal request,
  transfer of care, funder audit, other — "other" needs words) and goes
  in the audit line with the export, as `record.exported`. Written
  before the export is returned.
- **Scoped like the record**: out of scope is 404, the export permission
  never widens what can be seen.
- **Everything on the record, in words**: episodes, case managers,
  referrals in and out, notes (every status), care plans, consents,
  programs with attendance, assessments with answers as option labels
  against the version's wording, follow-up calls, the documents list.
  `omitted` says what isn't there (document files, the audit log).
- Nothing is stored: the export exists in the response and whatever the
  person prints or saves. It's a POST so a browser never prefetches or
  replays it.
- When 42 CFR Part 2 is built, substance-use records will need
  segmenting out of this unless the consent covers the disclosure.

## Exports neutralize spreadsheet formulas

Every CSV goes through `lib/csv.ts`. A cell starting `=`, `+`, `-`, `@`,
tab or carriage return gets a leading apostrophe, because a spreadsheet
runs it as a formula when the file is opened — on the staff member's
machine, from text a participant may have typed. Plain numbers (`-5`,
`+1.5`) are left alone; they're data, not formulas. Headers are guarded
too.

## Money is a string end to end

`numeric` Postgres columns, string in Zod schemas, string across the API
boundary. Applies to stipends (M18/M19) and, once built, billing (M22).
A float turns a currency amount into something like 450.09999999999997.
