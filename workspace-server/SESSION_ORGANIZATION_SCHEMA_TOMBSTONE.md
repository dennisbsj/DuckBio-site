# Session-organization epoch table-loss guard (source-only)

**Draft security follow-up to #192, #197, #203 and #206. No deployment, no live app grant.**

## Confirmed threat
The durable `session_organization_versions` table prevents clear/reselect ABA when an existing Workspace session switches or reselects an organization. However, the preexisting first-open migration treated a **missing table** as an entirely legacy schema and seeded all current selections at revision 1. Deleting the table (or restoring only old tables from a mismatched backup) could therefore reaccept a stale native preflight result from a still-live parent session if an identical selection had previously reached revision 1.

## Guard
`organization-store.mjs` now also records a **persistent schema-establishment marker** using SQLite `PRAGMA user_version=1` inside the **same IMMEDIATE transaction** that creates and seeds the epoch table.

- A genuinely old organization SQLite DB with no epoch table and `user_version=0` is seeded at revision 1 only once, then marked.
- A database with an existing epoch table but an unset marker is marked during the first reviewed open, preserving all existing monotonic revisions.
- If `user_version` is nonzero and the table is missing, startup fails closed with `session_revision_unavailable`; **no epoch re-seed**, no silent authorization restoration.
- Existing rows missing a required epoch remain denied as before. Revocations, stale PKCE codes, native preflight and the independent legacy-grant version marker are unchanged.
- Other higher `user_version` schema values are preserved. Future unrelated organization migrations must coordinate this shared SQLite header; operators must never reset it to zero to force a fresh seed.

## Regression coverage
The existing true-legacy migration test explicitly simulates `PRAGMA user_version=0` in the pre-migration DB. Two new tests verify:
1. an established multi-generation session survives on disk, its epoch table is dropped, and restart **throws** without silently re-creating it; and
2. first setup and later reopened stores retain header marker and the exact epoch sequence.

**Backup safety:** A point-in-time restore must include the full **same-state** SQLite file and WAL/SHM for both session-organization and identity-grant epochs. Resetting `user_version`, dropping only the epoch table, or restoring just a few tables is unsafe. This marker cannot protect against rolling back the **entire database including its header**; restore/recovery must separately expire all outstanding broker proofs and parent sessions.

**Verification:** tests added to `tests/workspace-session-organization-epoch.test.mjs`, which is part of existing `npm test`. No runtime test/Node 22+24 CI has yet run for this new head because GitHub Actions capacity has been exhausted; do not mark it green or merge. PR #202 remains the last fully green baseline. This guard provides no permission or paid seat on its own.
