# Agent feedback and reviewed learning

Feedback is a record of experience using the project, not an instruction channel
or an automatic code/skill editor. The external harness retains execution and
verification responsibility. Actor/reviewer labels are attribution in the
single-owner local app, not authenticated multi-user identities.

## Loop

1. Retrieve selected project/task context and the matching source/skill.
2. Do the authorized work and check the actual outcome.
3. Report meaningful observed friction, a bug, suggestion or reusable lesson.
4. A human triages, dismisses or verifies it against selected evidence and an
   explicit applicable app version. Link a bounded follow-up task when useful.
5. Implement authorized improvements and attach actual validation evidence.
6. Recheck later reuse before claiming a lesson improved quality, time or cost.

Reports and review events are immutable. Replays use a stable request ID;
conflicting content rejects. Review writes compare the current revision so a
stale reviewer cannot silently overwrite another decision. Corrections and
withdrawals retain their history. References are stored, not read from disk.

Only the latest verified decision for the current app version can contribute a
selected lesson to context. A report alone, an old-version review or a saved
reference does not qualify. Context carries at most five lessons and explicit
data-only guidance; it cannot override repository instructions or owner scope.
Version bumps preserve old reviews as history and require explicit revalidation.

## MCP

- `report_feedback`: create an attributed observation, with an idempotency key.
- `list_feedback`: find selected reports with project/status/kind/query filters
  and bounded pagination.
- `get_feedback`: retrieve one report and bounded review history.

Human review is in the web UI. There is no MCP verification/promote tool.
Trusted local code can still call HTTP; this separation is not authentication.
No report automatically creates a task, changes a skill/memory or launches a run.

## HTTP and data

POST/GET `/api/feedback`; GET `/api/feedback/:id`; POST
`/api/feedback/:id/review`; GET `/api/projects/:slug/feedback-context`.
The report contains project/optional task, reporter, kind/severity, summary,
observed/expected behaviour, reproduction, proposed change, source/observation
version and selected evidence. The submitting app records its own version and
timestamp separately; a reported observation version is not independently proven.

Limits include 16KiB report payloads, eight evidence references, bounded field
lengths, 1–50 reports per page and a 10,000-report capacity guard. Oversized result
pages reject rather than silently giving incomplete counts. Detail review history
is windowed. Narrow the query or retrieve selected records when a budget is reached.

Feedback shares the existing private SQLite database through an additive schema.
Historical project/task references survive later base-record deletion; creation
validates current project/task identity. Feedback is not a second execution tracker.
Reports also retain the original immutable project ID. Recreating the same slug
does not inherit old context lessons or allow old reports to link replacement tasks.
See [storage choice](STORAGE.md), [the coordinator guide](COORDINATOR.md) and
[the portable agent skill](../skills/kanzo-harness/SKILL.md).

Do not paste credentials, raw private transcripts or unrelated sensitive data.
Keep private reports and evidence out of Git. Product tags version source and
procedure; they do not publish the local feedback database or train a model.
