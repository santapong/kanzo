# Kanzo Harness guide

Build with Rust (at least Cargo.toml's rust-version):

```sh
git clone https://github.com/santapong/kanzo.git
cd kanzo
git switch develop
cargo build --release --locked
./target/release/kanzo --no-open --home ./local-data --port 4242
```

The native binary embeds the UI and bundled SQLite. There is no Node build,
external chart library, CDN, external database or automatic worker dispatcher.
The fork's updater points to this fork's releases; no release is created by a
source push. Do not use the upstream installer to update a fork board.

## Planning and time

Dashboard, Board, Timeline, Calendar and Time read the same task/planning rows.
All-day schedules use nullable YYYY-MM-DD dates in the labeled planning timezone.
Undated tasks stay visible. Estimates are seconds, separate from recorded effort.
Human timers are persisted and limited to one active interval per actor across
tabs. Manual entries have explicit durations. Agent-run duration is not inferred
from a task's doing status. Parent containers and actionable leaves are separate
chart denominators, and child completion does not automatically accept a parent.

History begins when this fork starts recording events. No past work, dates,
completion history or working hours are invented from updated_at timestamps.

The dashboard returns recent 500-entry/event windows with explicit truncation
metadata and separate all-history time totals. Open timers stay accessible
outside that window. Context packets have 16-ancestor/50-related-row windows
and a 256KiB output ceiling. The portfolio snapshot checks a 4MiB stored-payload
and 10,000 project/task-record budget before materializing; oversized knowledge
should be referenced through selected task/project endpoints instead.

## Selected Codex context

Point Codex's existing MCP configuration at the absolute fork executable with
`--home /path/to/private/board mcp`. HTTP MCP is at the running board's `/mcp`.

New tools:

| Tool | Purpose |
| --- | --- |
| get_task_context | Selected project/task/ancestor/child/dependency, schedule/time and skill/memory references |
| update_task_plan | Replace the full structured task plan after reading context |
| create_subtask | Create a real task under a parent in the same project |
| update_project_context | Replace the full project brief and selected references |
| search_tasks | Search full history with shared filters and bounded pagination; active projects by default |
| list_tags | Reuse exact tag names and full matching-set counts |
| get_project_context | Read a compact project brief, selected references and status counts |

The matching HTTP routes are GET `/api/harness`, GET/PUT
`/api/projects/:slug/profile`, GET/PUT `/api/tasks/:id/plan`, GET
`/api/tasks/:id/context`, POST `/api/tasks/:id/subtasks`, POST
`/api/tasks/:id/timer`, POST `/api/time/:id/stop`, POST `/api/tasks/:id/time`
and POST `/api/tasks/:id/accept` (human review). Original task/comment routes remain.
The Store enforces relationships/readiness/timers for both HTTP and MCP clients.

## Search, filters and tags

The task filter bar combines text, state, project type, exact tag, owner and
scheduled/unscheduled filters. It persists across portfolio views and resets
when selecting an individual project. Tags on board cards are clickable; the
task details tag field suggests existing names. Categories describe projects;
tags describe tasks. Clearing a filter does not edit task data.

Global search is separate from view filters. It searches full history, including
completed work, with an explicit Active / Needs review / Inactive / Alias / All
visibility choice. Active is the default. Results load in pages of 30.

GET `/api/tasks/query` and GET `/api/tags` use the same filters as the MCP
`search_tasks` and `list_tags` tools:

| Parameter | Meaning |
| --- | --- |
| q | Literal search words across key, project name, title, description and tags; at most 300 characters |
| project | Project slug; omitted or `all` spans projects |
| status | Exact configured state; omitted or `all` includes all states |
| category / tag / owner | Exact selected value; tag matching uses normalized native tag names |
| visibility | `active` (default), `inactive`, `review`, `alias`, or explicit `all` |
| scheduled | `yes`, `no`, or `all` (default); any start/end/due date counts as scheduled |
| limit / offset | 1–100 rows (default 30); offset 0–10000 |

Task replies contain `tasks,total,limit,offset,has_more`. Tag replies contain
`tags:[{tag,count}],total,limit,offset,has_more`; facet counts cover the complete
matching set before pagination. Selected task payload is checked before loading
and replies are capped at 1MiB. Tag input is capped at 1MiB / 10000 occurrences;
tag replies at 64KiB. Narrow the filters when a budget is exceeded.
GET `/api/projects/:slug/context` returns the same selected project brief as MCP.
No new database migration, external index or background service is required.

See [the coordinator workflow](COORDINATOR.md) for deduplication, proposed dates,
subtasks, selected context and the boundary between planning and execution.

Context packets emit explicit selected references. They do not read arbitrary
local files into replies, ingest all memory, train weights, start background
learning or establish shared sessions with another agent runtime. External
Codex/Accretion owns execution, worktrees, budgets and verification. Retrieve
relevant skills, check source, do scoped work, then attach supported outcome and
lesson references under the owner's existing learning rules. Attribution fields
and evidence links are not authenticated identity or certified evidence.

## Migration and rollback

Stop all writers and back up the complete private data folder before migration.
Additive tables preserve existing task IDs/content/comments; new events start
at migration. The minimum compatible schema is raised so old upstream binaries
refuse a board whose invariants they cannot enforce. Upgrade every stdio MCP
executable together with the web service; reconnect old running MCP clients for
the new tools. A connection-local writer marker in migration triggers rejects
writes from old connections that are still running. This is a compatibility
boundary, not authentication; arbitrary trusted local code can implement it too.

To roll back, stop fork writers and restore both the pre-migration database and
the previous executable/service. Do not downgrade in place or restore an old
backup over later work without reconciling that work.

The optional importer previews a reviewed local manifest and organization overrides:

```sh
python3 tools/import-portfolio.py /private/projects.json --overrides /private/portfolio-settings.json
python3 tools/import-portfolio.py /private/projects.json --overrides /private/portfolio-settings.json --apply
```

It preserves existing brief/context fields, imports explicit category/visibility
and source references, and does not clone or read referenced repository files.
Import only authoritative reviewed inputs. Never publish those private inputs.

## Validation

```sh
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked -- --test-threads=1
node --check src/app.js
node --test tests/theme.test.cjs
python3 tests/http_acceptance.py --binary ./target/debug/kanzo
```

The HTTP suite uses a temporary synthetic board on loopback. Browser acceptance
should exercise theme persistence, mobile/tablet/desktop, real subtasks,
schedule/calendar consistency, timers across tabs, context and user review.
Keep test screenshots containing private project names outside public Git.

System is the default theme. The sidebar selector offers System, Light and Dark;
manual choices persist where browser storage is available. The small protected
`/theme.js` bootstrap resolves the choice before styles load, follows OS changes
in System mode and preserves an in-memory choice if storage is unavailable.
On phones and short windows, advanced filters collapse behind Filters without
clearing their values. Project notes expand separately and the workspace remains
scrollable so task cards and actions stay reachable.

The app retains upstream Host/Origin/CSP protections. This is a single-owner
local app without account authentication. Actor/reviewer strings are attribution,
not access control. Keep loopback or an explicitly trusted private deployment;
this fork does not add multi-user authorization or external calendar writes.

## License

AGPL-3.0-only, retaining upstream notices. Make modified source available to
users of a network-hosted modified instance. Public source and private runtime
data remain separate.
