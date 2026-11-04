# Workspace — coordinated TWO-source SQLite snapshot pair rehearsal

**Private opt-in, unmounted source, not a production backup/restore system or SSO activation.**

This proposal builds on draft #160, #159 and #158. It introduces a small offline library at `shared-auth/native-snapshot-pair.mjs` and eight disposable real-SQLite tests. It does **not** alter the active Workspace broker/runtime, native repositories, DataDuck, Stripe or customer database files.

## Snapshot capture

An operator must first independently quiesce normal Workspace writers and native linking and make a copy of the original source files/associated WAL data using an established and reviewed operational runbook.

```js
import {createPrivateNativeSnapshotPair,verifyPrivateNativeSnapshotPair}
  from './shared-auth/native-snapshot-pair.mjs';

const made=createPrivateNativeSnapshotPair({
 identityDatabasePath:'/private/workspace/identities.sqlite',
 organizationDatabasePath:'/private/workspace/organizations.sqlite',
 outputDirectory:'/private/offline-snapshots'
});
const report=verifyPrivateNativeSnapshotPair({
 batchDirectory:made.batchDirectory,
 now:Date.now()
});
```

**Safety contract:**

- Requires two **existing, distinct, regular, private (0600) SQLite files** with absolute canonical paths and no symlinks/hardlinks, and a preexisting private **0700 output directory**. Both source files and the output directory must be on the *same* local filesystem. No production HTTP route or automatic scheduler calls this.
- Opens a separate SQLite connection for each authoritative source; obtains `BEGIN IMMEDIATE` write reservations for **both** before copying either source, with `busy_timeout=0` and deterministic path ordering. If one source is busy, it releases any first lock and publishes no backup.
- While both reservations are held, creates two independently consistent **`VACUUM INTO`** copies into a unique private `.pending-UUID` directory. Ordinary writers cannot commit changes to either local SQLite file during the snapshot window.
- Runs #159's read-only reconciliation auditor against the copies and **aborts** if canonical native links disagree with the member, app assignment, audited link, or snapshot paid-seat-shaped ledger. This diagnostic is not native identity attestation or proof of real paid billing.
- Stores SHA-256 digests for both copies, one pair UUID, creation time and their append-only audit cursors in `manifest.json`; fsyncs files and attempts local directory sync.
- Publishes the complete three-file bundle by a **single same-filesystem directory rename** into `batch-UUID`. On failure, removes the unfinished staging directory and releases both DB locks. Existing published bundles remain untouched.

This establishes an *application-level single-directory publication boundary for two local file snapshots*, **not** a distributed transaction or power-fail-atomic guarantee across source SQLite databases. A split transaction committed **before** both reservations were acquired may still require external reconciliation.

## Private verification

`verifyPrivateNativeSnapshotPair({batchDirectory,now})` never modifies a file. It demands exactly the two snapshot files and manifest, checks path/file permissions and non-symlink status, validates manifest version and generation, verifies both SHA-256 digests and checks that #159's live-time structural audit still matches the recorded audit cursors/counts.

A backup with an expired paid term, swapped database, corrupted file, renamed generation, tampered manifest or structurally inconsistent link **fails closed**. A clean result **still returns** `restoreApproved:false`, `accessGranted:false`, `licensesGranted:false`, `loginEnabled:false`.

SHA-256 here catches accidental corruption or accidental mixing of generations. The manifest is **not signed** and can be forged by someone who controls both the manifest and the backup files. It is not external provenance, native ownership, verified Stripe LIVE entitlement, or a substitute for a separately audited backup policy.

## Tests and unresolved release gates

The eight tests use real, disposable SQLite identity+organization databases, synthetic native/operator proof callbacks and fake LIVE-shaped seat entries. They exercise a normal paired capture, competing writers in either source, split-store inconsistency before capture, mixing snapshots across generations, manifest modification, expired payment at audit time, and unsafe source/output paths.

**Before any production use:** finish operational quiescence, native proof revalidation, live Stripe re-reconciliation, key management, coordinated session invalidation, durable manifest provenance, disk/power-loss recovery procedures, release-safe backups, encryption/retention, restore rollback and eight-origin HTTPS staging including native app-level resource ACLs. The test suite does not implement or verify those steps.

**Keep draft, unmerged, undeployed.** Related issue #140 and umbrella #26; parallel #161 crash work is separate and should not be duplicated.
