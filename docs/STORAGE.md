# Storage choice

Kanzo Harness keeps SQLite as its current canonical private store. The local
single-owner app and its MCP clients share one application data directory;
short transactions, bounded result windows and consistent backups fit this
deployment. Feedback reports and review history live beside tasks in the same
database, rather than creating another service or independent task ledger.

SQLite permits one writer at a time. Its own guidance recommends a client/server
database when many clients write over a network or substantial concurrent writing
is required. These are reasons to revisit the choice when they are observed,
not reasons to add a server to the current local setup. See
[SQLite's deployment guidance](https://www.sqlite.org/whentouse.html) and
[network-file considerations](https://www.sqlite.org/useovernet.html).

PostgreSQL is a possible future backend for a shared multi-server deployment.
It has a documented [concurrency model](https://www.postgresql.org/docs/current/mvcc.html),
but this repository does not currently implement a PostgreSQL Store. Supporting
it requires a scoped design and migration: connection lifecycle, SQL/JSON and
schema differences, transactional guards, immutable review history, concurrency
tests, backup/restore and an exact cutover/rollback plan. It is not a configuration
toggle or a claim that existing SQLite acceptance automatically transfers.

Keep the live SQLite file on a qualified local filesystem. Access a shared
instance through its application API rather than opening the same DB file over
a network share. Back up the complete consistent database and executable before
migrations, and reconcile later writes before restoring an older copy. Do not
publish the DB, private feedback, evidence paths or backups with source tags.

No PostgreSQL service, credential, cloud resource or migration is required for
the feedback workflow delivered here. Revisit storage from measured workload
and operational requirements, without claiming a concurrency benchmark that
has not been run.
