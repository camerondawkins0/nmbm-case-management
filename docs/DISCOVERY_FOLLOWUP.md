# Discovery follow-up — status

NMBM replied to the compliance/billing follow-up (Part 3 + M23) inline on
the doc we sent. Answers below are recorded as given; codes still match
the original discovery document.

This doc tracks what is **unanswered**. For what has been **built**
against the answers that did arrive, see "What is built" in
`docs/ARCHITECTURE.md` — as of migration `0007` that covers sign-in, intake,
episodes and readmission, notes and the M6 ladder, care plans and the M9 clocks,
consents, referrals, programmes and attendance, staff administration
and the audit log.

## Answered — Part 3 compliance

- **R2 / R3** — The Google Workspace Business Standard BAA is **signed and
  obtained**. Dayna Moore (CEO) signed it. This clears the hosting
  question that R2/R3 were blocking — Google Cloud hosting can proceed.
- **R5** — 42 CFR Part 2 is a real requirement, not a hypothetical: NMBM
  expects SUD referrals soon (mental health referrals generally already
  happen; DV-specific referrals are on hold pending LA County approval).
  NMBM asked directly whether this can be built and acknowledged it may
  cost extra. **Answer: yes, plan for it** — Part 2 needs its own
  consent/re-disclosure handling, separate from standard HIPAA-level
  consent, scoped as additional work once billing (M23) sets the
  baseline estimate. Exact activation timing still depends on the LA
  County DV approval.
- **R6** — Client records are kept per California's 7-year retention
  requirement. No other rulebook (FERPA, etc.) applies — contracts just
  require the system to be state/federal PHI-compliant generally.
- **R10** — Disenrollment should **immediately** move a participant out
  of the active-caseload view (so "who's active right now" stays
  accurate without manual cleanup), while the record stays fully
  retrievable — for a returning participant (the readmission-date case
  already discussed) or for a contractor/grantor request. This is a
  behavior requirement, not just a retention window. **Built**:
  closing an episode ends the assignment in the same transaction, the
  caseload and dashboard count only people with an open episode, closed
  records are listed separately, and readmission opens a fresh episode
  whose no-contact count starts at zero. The questions it raised are
  answered below. See `docs/agent/invariants.md`.
- **R11** — No prior incident. Response owner is QA/HR, who would notify
  affected participants by mail to the address on file. NMBM suggested
  signing that correspondence with a role name ("Quality Assurance
  Team") rather than an individual's name — use that as the default
  sender identity for any breach-notification template.

## Answered — R10 follow-ups (given by Cameron on NMBM's behalf)

- **Can the Intake Specialist readmit?** Yes — "especially if a
  directive is given to do so." Built as a new permission,
  `participants.read.closed`, granted to intake: it finds and opens any
  closed record and nothing active. Readmission itself was already
  `episodes.write`, which intake holds.
- **Does the worker keep sight after closing?** Yes, "especially if
  they are the last assigned case manager", capped at 90 days and
  adjustable. Built as: only the *last* assigned worker, read-only,
  for a window NMBM's system administrator sets on the Settings page.
  90 days is both the default and the maximum (confirmed); it can be
  shortened to anything down to 0. Changes are audited.
- **Does disenrolment withdraw someone from their classes?** No —
  "disenrollment typically means they are no longer receiving or
  participating in services with the provider." The roster flags them
  ("Services ended <date>") and leaves them enrolled; attendance can
  still be recorded.
- **Idle sign-out** — 60 minutes is sufficient. No change.

## Still needed

- **R4** — NMBM is still deciding whether a BAA is needed covering this
  system specifically (separate from the Workspace BAA), given a
  contractor other than Google will touch the data during build/hosting.
  Their answer: "we would look into that" — not yet resolved, and now
  more pressing: NMBM is adding the maintainer to their Workspace as a
  **super admin**, which reaches every user's mail and Drive, not just
  this application. That is a much wider boundary than "a contractor who
  builds the software", and it should be settled before real
  participant data exists rather than after. See `docs/GOOGLE_SETUP.md`.
- **R7** — KPIs are due out of the system by the 5th of every month for
  one contract, believed to be Full Circle Health Net. The exact fields
  are "in the contract" — **not yet delivered**, promised same-day as
  the reply.
- **R8** — Confirmed multiple distinct submission channels, not one:
  Kaiser ILS, Medicare, Medi-Cal, and Molina each have their own format
  or portal; Kaiser Medi-Cal, Blue Shield, and LA Health Net go through
  FCHN's Exym instead. Exact due dates per channel still to be gathered.
  **This means M23 is really several formats, not one** — see the
  updated billing note in `docs/ARCHITECTURE.md`.
- **R9** — NMBM confirmed they'll send the funder contract with the
  security/data clauses ("Ok") — **not yet received**.
- **M23** — Still open. NMBM named Dayna Moore as the person who can
  answer the payer file-layout/rejection-handling question. This is
  still the single biggest scope driver — nothing beyond the schema
  placeholder should be built until it lands.

## M22 — funding picture is more complex than first described

NMBM's expanded answer, worth carrying into billing design once M23
unblocks it:

- Medicare and Medi-Cal are billed **directly** by NMBM.
- Kaiser Independent Living Services (ILS) is billed under a separate
  **MCP contract**, for ILS/Community Supports work only — this is not
  routed through Full Circle Health Net.
- Full Circle Health Net (FCHN) is the billing channel for Kaiser
  Medi-Cal, Molina, Blue Shield, and **LA Health Net** (not previously
  named — add to the payer list).
- Molina, despite going through FCHN, appears to require NMBM to handle
  its own billing separately — NMBM flagged this as still unclear on
  their own end ("we are still navigating how to do each thing
  effectively").

Net effect: FCHN is a billing intermediary for *some* payers, not a
payer itself, and at least one of those (Molina) may not actually follow
the FCHN path in practice. Don't model "payer" and "billing channel" as
the same thing when M23 work starts.

## Reporting

- **M25** — Still unanswered: which report currently takes longest to
  put together, and where the time goes.

## Decision, ownership, timing (Part 4) — all six still open

- **D1** — Who approves this going ahead? Board vote? When does the
  board next meet?
- **D2** — Budget to build, and separately, budget to run per year after
  launch.
- **D3** — Target live date, and what's driving it?
- **D4** — Who owns the system after launch, by name?
- **D5** — Who owns the software, and who owns the data?
- **D6** — One year out, what would make this a failure?

## Smaller loose ends inside otherwise-answered items

- **U1/U3** — Department/role list still needs final confirmation before
  permissions are designed against it.
- **Who closes an episode?** Surfaced while building the disenrolment
  gate, not from the original discovery. As the grid stands, a CHW can
  log the failed attempts and see the three-strike prompt, but cannot
  disenrol or record the Molina warning letter — only the Clinical
  Director and Intake Specialist hold `episodes.write`. That may well be
  right (a supervisor executes the exit), but M6 is worded as though the
  CHW drives it. Confirm before the grid is signed off, because it
  changes who sees which buttons on the participant record.
- **Who is told about a Molina letter?** The system can require the
  letter before closing, and records that it was sent. It does not
  generate or send it — confirm whether NMBM wants the letter text
  produced here or kept in their own templates.
- **Does every note need review, and whose?** U6 says a supervisor
  approves CHW notes and the Clinical Director reviews APCC/ACSW notes.
  Built as: every note starts awaiting review, except one written by
  somebody who can approve — theirs is approved on the spot, since
  nobody is above them in the chain. Two things to confirm: whether
  every routine contact note really needs a signature (it's currently
  ~20 queued items from eight participants' seed history, which hints
  at the real volume), and whether the Clinical Director's own notes
  should be reviewed by anyone.
- **Which consent forms do you actually use?** M15 said "we have
  consent forms" without listing them, and the blank intake packet is
  still outstanding. Built with four types (general services, release of
  information, photo/media, other) — the release is the one the referral
  gate keys on. The real list should replace this.
- **Expiry: a year from enrolment, or from signing?** M16 says "a year
  after the client is enrolled", which is what's built — so a release
  signed eleven months into an episode is valid for one month, not
  twelve. That may be exactly right, or it may be a slip in how the
  answer was phrased. Worth one sentence of confirmation, since it
  changes when every form on file lapses.
- **Do referrals come in as well as go out?** M17 asked and the answer
  only covered outbound. Inbound referrals aren't modelled. R5's answer
  mentions expecting SUD referrals, which suggests they do arrive —
  who sends them and what needs recording is unknown.
- **A partner directory?** Referrals name the partner agency as free
  text, because NMBM hasn't given their list of partners. Once they do,
  a directory makes outcomes reportable by agency ("how many did we send
  to X, and how many were seen").
- **Should an accepted referral keep nagging?** A referral stays on the
  home screen until it reaches a terminal status, so "partner accepted"
  keeps appearing until someone records that the service happened. That
  matches M17's "what happened with the client", but it means more
  chasing. Flag set at 14 days, which is a guess.
- **How many sessions complete a programme?** Anger Management and
  Domestic Violence are typically court-mandated with a set number, and
  M14 didn't give one. A cohort can carry a threshold and the seed uses
  12 as a placeholder; without a real number the record reports
  attendance and leaves the judgement to the reader. Needed per
  programme, and possibly per referral source.
- **What does a probation officer actually need on the page?** The
  participation record shows dates, topics, attendance and who marked
  each class. If POs or the courts expect a particular wording, a
  signature block, or a letterhead, that's worth seeing an example of
  before anyone relies on this.
- **Does an excused absence count toward completion?** Currently it
  doesn't, and it's reported separately from an unexcused one. Court
  programmes often treat these differently and NMBM will know the rule.
- **Who runs the classes?** `attendance.record` is granted to the
  Clinical Director, Program Manager, CHWs, interns and the health
  educator; `programs.manage` only to the Clinical Director, Program
  Manager and admin. Worth confirming alongside the other who-does-what
  questions below.
- **Who may admit a participant?** Intake currently needs
  `participants.write`, held by the Intake Specialist and Clinical
  Director — a CHW cannot admit. Consistent with U3, worth confirming
  alongside the episode-closing question above.
- **M1** — "Clients" vs. "cases" as the record name — still needs one
  answer.
- **M3** — What has to be known before intake can proceed, and which of
  those a funder specifically requires — never answered.
- **M12** — 3/5/9/12-month follow-up cadence — still marked "are we all
  in agreement," not confirmed.
- **M16** — One-year consent expiry — still marked "are we in
  agreement," not confirmed.

## What to bring to the next meeting

1. The funder contract with the reporting and data clauses (R9 — NMBM
   said yes, still pending delivery).
2. The FCHN KPI reporting spec (R7 — promised, still pending).
3. Payer file-layout/rejection documentation for Kaiser ILS, Medicare,
   Medi-Cal, Molina, and FCHN/Exym (M23 — Dayna Moore).
4. A blank intake packet and each consent form.
5. An export from Exym/current system, or a screenshot.

No price or date should go out before M23 and D2/D3 land.
