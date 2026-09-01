# Discovery follow-up — open items

Everything below is a question from the NMBM discovery session that wasn't
answered, or was answered by "we're planning this out" / "are we in
agreement" without a decision landing. Send this back before design work
starts on the pieces it touches — each one changes either scope, cost, or
where the system can legally be hosted.

Codes match the original discovery document so replies can reference them
directly.

## Compliance — blocks hosting and contract decisions (Part 3)

These are the highest priority. R2 says NMBM is getting a Google Workspace
Business Standard BAA, which is *why* Google-hosted was chosen — but the
rest of Part 3 is open, and R5/R9/R10 each independently change what the
system has to do.

- **R3** — Who signs the BAA on NMBM's side, and how long does that take?
  Needed before a hosting/build timeline can be set.
- **R4** — Does NMBM need a BAA covering *this system specifically* and
  whoever hosts/operates it (separate from the Workspace BAA)? If a
  contractor or hosting vendor other than Google touches the data, this
  is a second signature, not a formality.
- **R5** — Does 42 CFR Part 2 apply to any program? Substance use
  treatment records carry stricter consent and re-disclosure rules than
  HIPAA. Anger Management and DV programs sometimes touch this depending
  on referral source — needs a definite yes/no per program, not a guess.
- **R6** — Any student records or other data with its own rulebook
  (FERPA, etc.)?
- **R7** — What data leaves the system on a schedule, to whom, in what
  format, how often? (Distinct from M22/M23 billing exports — this is
  everything else: funder reports, HMIS, county.)
- **R8** — Does any payer or funder require a specific file layout, a
  portal upload, or manual entry into their system? Directly shapes the
  reporting/export module.
- **R9** — Bring the actual security/data clauses from contracts that
  have them. "Do any of your contracts carry security or data terms" was
  asked but no contract was produced.
- **R10** — Retention period, and what happens at the end of it (destroy,
  archive, hand off)? Nothing in this system is hard-deleted by design,
  so this mostly determines *when something moves out of active view*,
  not when it's destroyed.
- **R11** — Named incident-response owner if data leaks. Has anything
  like that happened before?

## Billing — the single biggest cost driver (Part 2)

- **M23** — What line/file layout does Full Circle Health Net (and any
  direct Medi-Cal/Medicare submission) require, and what's the current
  process when a line gets rejected? M22 already confirms billing is
  in scope; **M23 is what turns that into an estimate.** Nothing else on
  the discovery doc swings scope as much as this one answer.

## Reporting

- **M25** — Which report currently takes the longest to put together,
  and where does the time actually go? Answered for M26 (what a director
  wants Monday morning) but M25 itself — the pain point that justifies
  building a report builder instead of a fixed dashboard — wasn't.

## Decision, ownership, timing (Part 4) — all six open

- **D1** — Who approves this going ahead? Board vote? When does the
  board next meet?
- **D2** — Budget to build, and separately, budget to run per year after
  launch (hosting + support are ongoing, not one-time).
- **D3** — Target live date, and what's actually driving that date
  (a grant start date, a funder deadline, an audit)?
- **D4** — Who owns the system after launch, by name? What else is on
  their plate, and who trains new hires? (The doc flags this as the
  single most informative answer on the page — a shrug here is itself
  useful information.)
- **D5** — Who owns the software, and who owns the data?
- **D6** — One year out, what would make this a failure?

## Smaller loose ends inside otherwise-answered items

- **U1/U3** — "Dayna, can you please review and change this information?"
  and "are we missing anything?" are open inside the answer itself —
  the department/role list should be confirmed as final before
  permissions are designed against it (per the doc's own U5 framing:
  cheap now, expensive later).
- **M1** — "Clients" vs. "cases" as the record name — needs one answer,
  used consistently in the UI.
- **M3** — Never answered: what has to be known before intake can
  proceed, and which of those items a funder specifically requires.
- **M12** — The 3/5/9/12-month follow-up cadence is described but marked
  "are we all in agreement" — confirm before it's built as a fixed
  schedule.
- **M16** — One-year consent expiry marked "are we in agreement" —
  confirm.

## What to bring to the next meeting

Per the discovery doc itself:
1. Last quarter's report to NMBM's biggest funder, as sent.
2. A blank intake packet and each consent form.
3. One funder contract, with the reporting and data clauses (this also
   answers R9).
4. An export from Exym/current system, or a screenshot.
5. A list of positions and who reports to whom.
6. A second meeting with someone who does the daily work — not a
   manager describing it.

No price or date should go out before M22/M23 and D2/D3 land — the
document is explicit that M22 alone swings the estimate more than
everything else combined.
