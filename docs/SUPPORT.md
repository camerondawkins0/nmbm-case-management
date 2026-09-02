# Support & feedback workflow

NMBM has no dedicated IT or development staff (discovery M31: "Dayna and
myself until we get an IT"). This system's maintainer is external — not
an NMBM employee — so triage can't rely on someone at NMBM reading a
ticket queue and deciding what to build. This doc is what replaces that.

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

There's a raw admin view at `/admin/feedback`, gated server-side by the
`feedback.manage` permission (currently only `system_administrator` —
i.e. NMBM's own admin, Dayna once assigned). That view is for status
housekeeping, not for deciding what to build.

**The actual review is meant to happen externally, Claude-assisted:**
when the maintainer wants to check in on the queue, ask Claude to pull
the open/in-review items from `feedback_items` (direct Cloud SQL query,
or the `GET /api/feedback` endpoint against an admin account) and
produce a summary — grouped by category, duplicates collapsed, anything
that looks like a data or security issue flagged first. The maintainer
reviews that summary and decides what happens next; nothing in this
system auto-implements a change from a ticket. Submitters find out
something happened when its status moves, not because a decision was
explained back to them individually.

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
