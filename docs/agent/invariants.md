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

**Not yet enforced in code. This section describes the rule, not the
current behaviour** — see "What is not built" in `docs/ARCHITECTURE.md`.
Closing an episode today sets its status and nothing else: the
assignment stays open, the caseload query keeps the row, and the flags
read the resulting null episode as "no care plan", so a disenrolled
participant shows up needing attention on the worker who just exited
them. Verified by closing a seeded episode: the caseload query still
returns the same eight rows, and the assignment is still open.

`v_no_contact_counts` counts notes since the last successful contact
with no reference to an episode, which has a second consequence aimed
straight at the readmission case NMBM raised: somebody disenrolled for
no contact and later readmitted would begin their new episode already
at three strikes, because the failed attempts from the previous episode
are still the most recent notes on the record.

Fixing it means ending the assignment when the episode closes,
filtering the caseload and dashboard queries to participants with an
open episode, and scoping the view to the episode rather than the
participant.

When an episode closes, the participant has to drop out of the active
caseload view *right away* — not on a nightly job, not eventually.
NMBM's own framing: they want "active" to stay accurate without having
to check by hand. This is a default-query-scope rule, not an access
rule: `repository.ts` queries for caseload/dashboard views should filter
`episodes.status = 'closed'` out by default, but every direct lookup
(the returning-participant case already covered by the readmission date,
or a contractor/grantor record request) still reaches the full record.
Retention is separately confirmed at 7 years (R6, California state
requirement) — that's what eventually governs when a closed record
leaves cold storage, not when it leaves the active view.

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

## Money is a string end to end

`numeric` Postgres columns, string in Zod schemas, string across the API
boundary. Applies to stipends (M18/M19) and, once built, billing (M22).
A float turns a currency amount into something like 450.09999999999997.
