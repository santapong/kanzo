# Kanzo Harness fork

Use plain Git, never `gh`. `develop` is the integration branch; `main` retains
the upstream line. Do not push to `upstream` or tag/release without a request.
Keep upstream AGPL notices and provenance intact.

The accepted frontend is the light portfolio workspace with detailed task
inspection, plus an equivalent dark theme. Dashboard, Board, Timeline,
Calendar and Time use the same native SQLite records through HTTP and MCP.
Keep the UI responsive and dependency-free; no invented task dates or hours.

Task IDs, comments and history survive additive migrations. Enforce dependency,
parent/child, eligibility and timer invariants in Store transactions so clients
cannot bypass them. Older binaries must refuse an incompatible fork database.
Use synthetic fixtures for writes/tests; back up the real database before an
authorized cutover. Keep rollback instructions and scoped acceptance evidence.

Context packets include selected project/task fields and explicit instruction,
skill and memory references. Do not read arbitrary local files into API replies,
index all local knowledge, start agents automatically or claim model training.
Execution, credentials, worktrees and resource budgets belong to the external
agent harness. Acceptance remains a human review operation.

Never commit databases, real portfolio manifests, local context/memory, backups,
credentials, generated build output or personal screenshots. Documentation and
tests use synthetic projects. Run one bounded build/test phase at a time.
