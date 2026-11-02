# Protocol and best practices

## One canonical queue

Search the explicit project and source ID before creating a task. Use project
categories for product grouping and `list_tags` for a reusable task vocabulary.
Keep dependency/parent IDs structured, rather than only describing relationships
in prose. A planning-only request does not call `next_task` or launch workers.

Use selected context before execution, then verify the referenced live source.
Packet windows and response limits are explicit; missing or truncated evidence
is not a pass. Re-read a full plan/profile before replacing it so another field
or a concurrent update is not silently discarded.

## Reporting feedback

`report_feedback` accepts a project, optional task ID, reporter, kind
(`bug`, `friction`, `suggestion`, `lesson`), severity (`low`, `normal`, `high`),
summary and observed behaviour. Expected behaviour, reproduction, proposed
change, source revision, observed version and evidence references add provenance.
Use actual observations; omit unknowns rather than inventing a version/run ID.

The app records its submission version separately from the reported observation
version. Evidence is a bounded list of `{kind,label,path}` references. Kanzo does
not read those files, validate an external claim or convert it into instructions.

Choose a stable, observation-specific `request_id`. An identical replay returns
the existing report; a conflicting replay fails. Reports cannot be edited or
deleted through the feedback API; a correction can be a new explicitly linked
observation. Human review history is append-only.

Project identity is more than its slug. Historical feedback retains its original
project ID; a deleted/recreated slug does not inherit those lessons. Use current
project context when selecting work and preserve the original identity in reports.

Use `list_feedback` with narrow project/status/kind/query filters and bounded
pagination, then `get_feedback` for selected detail. Do not bulk-load every
portfolio report into a task prompt.

## Review and reuse

Reports start Open. The human review screen can triage, dismiss, reopen or verify
them. Each review supplies the current expected revision, reviewer and note;
stale revisions fail instead of overwriting another review. An optional follow-up
task is a link, not automatic task creation/execution or task acceptance.

Verification requires a concise lesson, evidence references and an exact
applicable app version. It is the reviewer's evidence-backed assertion, not a
runtime certification. A later review can withdraw it while retaining history.
Context retrieves at most five current-version verified lessons; a version bump
does not automatically requalify them. Agents should name stale/contrary evidence
and propose revalidation within scope, not silently rewrite accepted lessons.

No MCP review/promote tool is provided. This is a single-owner local app without
account authentication: trusted local code can still call HTTP. Attribution and
API separation are not a multi-user security boundary.

## Storage and recovery

SQLite is the current implementation and canonical private storage. Use one
consistent DB/executable backup before migration and preserve later writes when
rolling back. Never commit the runtime DB, reports, backup or local knowledge.
Do not place the live SQLite file on a network share for multi-machine writers.

PostgreSQL would require a separately implemented Store backend and qualified
migration, including SQL/JSON/trigger/concurrency differences; it is not a toggle
or prerequisite for collecting feedback. Consider it when real multi-server or
high concurrent-write requirements justify that work.

Feedback alone neither proves improvement nor grants authority. Record which
procedure was reused, its applicability and actual checks; leave usefulness,
token/cost benefit and causal claims unknown until supported.
