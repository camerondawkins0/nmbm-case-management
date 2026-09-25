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
`no_contact` closure reason** — somebody who completes the programme,
moves away or asks to leave exits without any of this, and blocking
those would be inventing a rule NMBM never asked for.

## Care plan has two independent clocks (M9)

1. A 30-day completion countdown starting at enrollment.
2. A recurring review nudge every 2 weeks while the plan is still open.

These don't collapse into one clock — a plan can be late on the
completion deadline and still be due for its next 2-week review, and the
UI has to be able to say both at once.

## Consents expire a year after enrolment, not after signing (M16)

NMBM's words were "our consents can expire at a year after the client is
enrolled" — the anchor is the episode's start date, not the signature.
The two differ for anything signed mid-episode, and the earlier scaffold
had this wrong. `recordConsent` computes the expiry from the open
episode and stores which episode it counted from, so the working can be
shown. Still marked "are we in agreement" in discovery.

Whether a consent has expired is **derived at read time** from that
date, never read off the stored status column. A row saying "active"
next to a date in the past is precisely the bug that lets an expired
authorisation release someone's information, and nothing here runs a job
to keep a stored status honest. `status` only carries a decision a
person made: revoked.

## A referral needs a signed release, and that one blocks (M15/M17)

M15 asked whether a signature "unlocks something else, like a referral".
It does, and unlike other consent gates this one refuses rather than
warns: sending a participant's information to an outside agency without
a current release isn't NMBM's preference to weigh, because there is
nothing authorising the disclosure. The refusal distinguishes *no
release on file*, *expired* and *revoked*, because those lead to
different next actions.

The open half of M16 — whether a missing form should stop other work in
general — stays open. This rule doesn't settle it and shouldn't be read
as having settled it.

Revoking a release stops new referrals but leaves existing ones pointing
at it. What was authorised at the time is a fact about the past, and the
referral records which consent authorised it.

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
- **Closed records are a separate question.** `?status=closed` lists
  them for callers who hold `participants.read.all`; a front-line
  worker's caseload is their open assignments, so there is nothing
  closed on it. The direct lookup by id still reaches a closed record
  for anyone who could see it.
- **Readmission, not a second intake.** `POST /api/episodes` opens a new
  episode linked to the last one, with a named worker, in one
  transaction — the same one act as intake. Reassignment on a closed
  record is refused: readmission is the way back.

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
- A note written by someone who holds `notes.approve` is approved on
  creation rather than queued. There is nobody above them in the chain,
  so queueing it would park it forever. Whether NMBM wants that is
  flagged in `docs/DISCOVERY_FOLLOWUP.md`.

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

A completion threshold is optional on a cohort because NMBM hasn't
given one. Where it exists, the record reports four states rather than
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

## State a person could be wrong about is derived, not stored

Three things are computed at read time rather than kept in a column:
whether a consent has expired, how long the current run of failed
contacts is, and where somebody stands against a programme's completion
threshold. All three share a failure mode — a stored value drifts
silently, and nothing here runs a job to keep it honest, so the row
would go on asserting something false until a person noticed. An
expired release that still reads "active" is how information leaves the
building without authorisation.

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

## Sign-in says why it refused, and never trusts the browser's word (M27)

- The Google round trip carries a one-use `state` token bound to the
  session. Without it, anyone could complete sign-in in a victim's
  browser with the attacker's own authorisation code, and the victim
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

## Money is a string end to end

`numeric` Postgres columns, string in Zod schemas, string across the API
boundary. Applies to stipends (M18/M19) and, once built, billing (M22).
A float turns a currency amount into something like 450.09999999999997.
