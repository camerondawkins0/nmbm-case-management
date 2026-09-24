# Support & feedback workflow

NMBM has no dedicated IT or development staff (discovery M31: "Dayna and
myself until we get an IT"), so triage can't rely on someone at NMBM
reading a ticket queue and deciding what to build. This doc is what
replaces that.

The maintainer is external to NMBM as an organisation, but is being
given an account in their Google Workspace. That means they can sign in
to this system like any other user and hold `feedback.manage` directly —
which is simpler than the out-of-band route this doc originally
assumed. Both paths are described below; prefer the in-app one once the
account exists.

## How a report gets in

Any logged-in user can submit a report from **Report an issue** in the
app header, or `/feedback` directly. They pick a category (bug, feature
request, question, other), write a subject and description, and it lands
in the `feedback_items` table (`packages/db/src/schema/feedback.ts`).
They can see the status of their own past reports on the same page —
nothing more granular than "received / in review / resolved / not
planned," since they're not the ones triaging it.

Submission requires the `feedback.submit` permission, which every role
gets by default (`packages/shared/src/permissions.ts`) — reporting a
problem shouldn't require asking for access first.

## Who looks at it, and how

There's a raw queue at `/admin/feedback`, gated server-side by the
`feedback.manage` permission (`system_administrator` by default — NMBM's
own admin, and the maintainer once their Workspace account is assigned
that role). That view is for reading the queue and moving statuses, not
for deciding what to build.

**Deciding what to build is a separate, Claude-assisted step.** Ask
Claude to pull the open and in-review items — via `GET /api/feedback`
signed in as an account holding `feedback.manage`, or a direct Cloud SQL
query — and produce a summary: grouped by category, duplicates
collapsed, anything that looks like a data or security issue first. The
maintainer reads that and decides. Nothing here auto-implements a change
from a ticket. Submitters learn something happened when the status
moves, not because a decision is explained back to them individually.

Whether NMBM's own admin should also see this queue, or whether it
should be the maintainer's channel alone, is still an open choice — it's
one line in `DEFAULT_ROLE_PERMISSIONS`.

## Why not email or a notification pipeline

Wiring up outbound email (SES/SendGrid, DNS, deliverability) or a
Slack/Teams webhook is real infrastructure work with its own cost. The
in-app queue plus an on-demand Claude summary covers the actual need —
periodic review, not real-time alerting — without that build-out. If
NMBM later wants live notification (e.g. a P1 bug should page someone
immediately), that's a deliberate scope addition, not a default.

## What's not built here

- No attachments/screenshots on a report yet — the form asks the
  submitter to describe what they saw instead.
- No categorization beyond the four categories, no priority field, no
  assignment. Keep this simple until real volume shows it's needed —
  don't build a full ticketing system for a 10-person org preemptively.
- No de-duplication at submission time — that's part of what the
  Claude-assisted summary step is for.
