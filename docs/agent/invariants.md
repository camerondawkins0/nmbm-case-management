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

## Care plan has two independent clocks (M9)

1. A 30-day completion countdown starting at enrollment.
2. A recurring review nudge every 2 weeks while the plan is still open.

These don't collapse into one clock — a plan can be late on the
completion deadline and still be due for its next 2-week review, and the
UI has to be able to say both at once.

## Consents expire at 1 year (M16)

Every consent record needs an expiry computed from its signed date, not
just a boolean flag. What happens when a required consent is missing or
expired (does the gated action block, or just warn) is still open per
`docs/DISCOVERY_FOLLOWUP.md` — don't hardcode a hard block until that's
confirmed.

## Disenrollment archives immediately, but never hides the record (R10)

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

## Money is a string end to end

`numeric` Postgres columns, string in Zod schemas, string across the API
boundary. Applies to stipends (M18/M19) and, once built, billing (M22).
A float turns a currency amount into something like 450.09999999999997.
