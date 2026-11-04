# Workspace org-native SQLite backup/restore rehearsal

**Draft, synthetic test-only.** This acceptance harness builds on PR #141's opt-in organization-native link registry. It does **not** alter `shared-auth/identity-store.mjs`, the SSO broker, live customer accounts, the six original applications or DataDuck.

## What the test actually verifies

`tests/organization-native-identity-backup-restore.test.mjs` creates private disposable SQLite identity data containing a central account, a parent session, a legacy per-app native mapping, and two independently assigned scoped native identities for the **same** Workspace account under two organizations.

It then takes a consistent SQLite snapshot using **`VACUUM INTO`** while the source database remains open and WAL mode is enabled, verifies `PRAGMA integrity_check`, copies that complete snapshot into a fresh private restore location and creates a new identity store from the copy.

Acceptance checks include:

- Legacy account, existing parent session, old app grant, both scoped identities and both audit entries survive the restore.
- Scoped link metadata remains **non-authorizing**: `accessGranted:false`, `licensesGranted:false`, `loginEnabled:false`.
- A fresh snapshot after one scoped link is revoked restores exactly that revoked state, while the earlier snapshot retains the earlier link. The other organization's link and legacy grant remain intact.
- SQLite `VACUUM INTO` refuses to overwrite an existing snapshot, and snapshot integrity checks succeed.
- Portable account export v1 continues to fail closed with `org_native_links_require_database_backup` when scoped links exist.

## Not covered and mandatory before live rollout

This is NOT a backup service, retention system, encryption solution or disaster-recovery guarantee. It does not test huge databases, disk exhaustion, filesystem crashes, WAL race conditions under production load, cross-database snapshot consistency with the **separate organization SQLite store**, session expiration after restoration, safe restoration on a different server, native app DBs, credential/key rotation or Stripe payments.

The synthetic trusted callbacks always return true and MUST NOT be used outside isolated tests. A secure production design needs access-controlled encrypted off-host snapshots, verified private credentials and secrets, backup rotation, separate organization+identity+native database consistency or coordinated quiescing, periodic restore drills, and an independently reviewed rollback procedure.

**Important:** This rehearsal does not resolve PR #141/#142's duplicated scoped-identity source. One canonical mapping schema and a stable monotonic revocation generation are still required before merging the dormant native inspector. Keep #141, #142 and this PR draft and un-deployed pending that decision.

Run from `workspace-server`: `node --test tests/organization-native-identity-backup-restore.test.mjs` or `npm test`.
