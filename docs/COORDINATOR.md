# Coordinator workflow

Kanzo stores the plan and review evidence. The external Codex/Accretion harness
owns execution, worktrees, credentials and resource limits. Planning dates and
effort estimates are proposals until the owner adopts them; they do not reserve
an executor or authorize a provider run.

1. Discover projects, then read `get_project_context` for the selected project.
   Default task discovery includes active projects only. Choose another
   visibility explicitly to inspect archived or review-needed work.
2. Use `search_tasks` before creating tasks. Keep source task IDs and tracker
   references so an intake gate does not duplicate an existing product backlog.
3. Read `get_task_context` and the referenced live source. References are selected
   paths, not imported file contents or proof of successful execution.
4. Use `create_subtask` for concrete deliverables, then `update_task_plan` for
   dependencies, owner, estimate, proposed start/end/due dates, allowed scope,
   acceptance and budget. Read before replacing a full plan/profile.
5. Apply short, meaningful tags with `update_task`; use `list_tags` to reuse the
   existing vocabulary. Tags describe work; project categories group products.
6. Claim an authorized ready leaf only. Parent summaries and unfinished
   prerequisites are not executable. A proposed date does not bypass a gate.
7. Attach outcome evidence with `add_comment`, then move worker output to
   `review`. The human acceptance action owns accepted Done.

For example, inspect an existing synthetic project before planning:

```json
{"tool":"search_tasks","arguments":{"project":"demo","status":"all","tag":"planning","visibility":"active","limit":20,"offset":0}}
```

Then read a selected task:

```json
{"tool":"get_task_context","arguments":{"id":"demo#12"}}
```

Never infer time spent from a task status, an estimate or a scheduled date.
Human timers/manual entries record actual effort separately. Keep speculative
or blocked work in backlog and name its decision/dependency. A planning-only
request does not start implementation, training, publication or a background
coordinator.

After upgrading the executable, reconnect the MCP client to discover new tools.
Already running stdio helpers keep the tool list loaded when they started.
Both stdio and the local HTTP `/mcp` endpoint use the same native Store rules.
