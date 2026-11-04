# DuckBio Workspace: session-to-organization selection ABA guard

**Status:** source-only security fix stacked on [Workspace integration draft #191](https://github.com/dennisbsj/DuckBio-site/pull/191). No new app access, license, installed staging service, hosted login or production grant.

## Threat model

The previous `session_organizations` table kept only `session_id`, account, organization and a wall-clock `selected_at`. The dormant native preflight read the active session organization on either side of an awaited native ownership verification. `clearSessionOrganization(sessionId)` removed the row, and an authorized selection for the same session/account/organization could recreate **identical visible values** (including the timestamp when the test clock does not advance). An in-flight check could miss this clear/reselect ABA, even when policy, native link, and paid entitlement revisions were unchanged.

## Fix

- Introduce a private SQLite `session_organization_versions(session_id, revision)` table with a strictly positive, JavaScript-safe integer revision that is **retained after clearing the active selection**. It is independent of native identity links and the per-organization authorization audit epoch.
- Select a new session organization and increment/create the revision in **the same `BEGIN IMMEDIATE` transaction**. Re-selecting an already-selected identical session/account/organization is idempotent and does not increment.
- Clear an existing selection and increment the revision in **the same transaction**; an already-cleared session is an idempotent no-op. The retained revision is not deleted. Overflow or missing/corrupted revision refuses the mutation; the transaction rolls back.
- `currentSessionOrganization` requires an existing valid revision and returns it as `sessionSelectionRevision`. The native preflight fails closed on a missing/non-integer revision and compares the original revision against a second fresh read after native verification.
- On first open of a truly **legacy private database without this table**, existing selected sessions are seeded to revision 1. The table creation and seed execute atomically in the same `BEGIN IMMEDIATE` SQLite transaction, with the existence check performed **after acquiring the write lock**. Concurrent processes cannot both decide to seed; interrupted migration rolls back the schema and seed together. Once the table exists, missing individual rows are **never silently reconstructed on startup**: operator intervention is required rather than reintroducing ABA.
- Both the **dormant native preflight** and the separate **dormant SSO broker deny-adapter** require a valid epoch and compare the original session-organization revision to a fresh read after awaited native inspection. The broker adapter still always returns `null` from `getAccess`, never issues codes/proofs, and does not activate native login. A successful preflight remains a diagnostic only: `accessGranted:false`, `licensesGranted:false`, and `loginEnabled:false`.

## Automated regression coverage

`tests/workspace-session-organization-epoch.test.mjs` checks idempotent selection, clear/reselect with the same user/organization/clock, clear during an awaited native callback, stale in-flight denial, missing/tampered epoch denial, one-time legacy migration, refusal of a silent restart repair, integer overflow rollback, persisted epochs after SQLite reopen, a separate live SQLite connection mutating selection during verification, and independent revisions for two sessions belonging to the same account. The separate `tests/native-broker-deny-adapter.test.mjs` suite also verifies the broker's own epoch defense against a deliberately stale positive candidate and a missing selection revision. These tests do **not** simulate crash injection during DDL, nor a real multi-host production deployment.

Run `npm run check && npm test` from `workspace-server`, and require green exact-head Node 22 and 24 CI before even reviewing a merge. These are private synthetic tests, not running native services or real billing evidence.

## Operational restrictions and remaining work

- The table contains no credentials, payments or native user data, but it **must be backed up atomically with `session_organizations` in the same SQLite database**. Restoring only one of these tables or rewinding its revision while native checks are in flight is not supported. Multi-database coordinated recovery (central identity/organizations/native apps) remains a separate blocker.
- Keep session-revision tombstones as long as a session ID might be referenced. Do not recycle `session_id` values, truncate or reseed the table as a storage cleanup shortcut. No general cleanup/retention policy is introduced by this PR.
- Cross-process/host deployment must ensure all Workspace instances read the same durable authoritative SQLite store. This change does not make isolated host replicas or stale snapshots safe sources of authorization.
- [Activation runbook #190](https://github.com/dennisbsj/DuckBio-site/pull/190) still requires verified native permission enforcement, per-app paid entitlement, DataDuck's separately approved native backend, real isolated eight-service staging, restore/rollback and explicit production go/no-go.
