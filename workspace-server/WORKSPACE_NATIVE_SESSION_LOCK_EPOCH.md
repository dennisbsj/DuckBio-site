# Opt-in Workspace session lock generation for native provisioning (DRAFT)

This proposal is **NOT enabled by default**, creates no browser/HTTP routes, issues no native SSO grant, leaves the original six native apps and unreleased DataDuck unchanged, and performs no production migration. It stacks on [draft PR #153](https://github.com/dennisbsj/DuckBio-site/pull/153), which already detects organization-wide **policy** ABA changes through its existing audit table.

## What was still unsafe

A signed native identity proof may be in flight while an authenticated Workspace session's selected organization is cleared and selected again. The original private provisioner rechecked the final organization ID and admin rights, but **A → A** or **A → B → A** in the same session could return to identical apparent state. The existing `session_organizations.selected_at` timestamp has insufficient granularity, and SQLite's rowid can be reused after a delete.

## Optional durable epoch

Only an explicitly configured private store with `createOrganizationStore({...,nativeProvisioningSessionEpochs:true})` creates a separate SQLite table:

```sql
CREATE TABLE native_provisioning_session_epochs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  account TEXT NOT NULL,
  org TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('selected','cleared')),
  recorded_at INTEGER NOT NULL
);
```

A first session organization selection inserts an immutable `selected` event **in the same organization SQLite transaction** as the lock. Clearing the session lock writes a durable `cleared` event in the same transaction as the deletion. Idempotent selection of an already-locked session does not create a new epoch.

`nativeProvisioningAuditRevision({organizationId,accountId,sessionId})` is a **private read-only** interface that requires a current exact session lock and latest matching `selected` event. It returns two distinct safe integer generations:

- `organizationAuditRevision`: the existing AUTOINCREMENT organization policy revision (membership, roles, effective permissions, seat allocation, billing and invitations).
- `sessionLockEpoch`: the latest immutable selected/cleared session event ID.

The unmounted, session-bound operator provisioner from #152 now captures **both** values before any native await and re-reads **both** at every mutation authorization callback. Changed generations cause fail-closed denial, even when both organizations and effective rights return to their original state during a signed proof. Same-clock operations are still different thanks to SQLite AUTOINCREMENT.

## Backward compatibility

With the feature's default `nativeProvisioningSessionEpochs:false`, the legacy Workspace session selection and clearing methods run their original SQL unchanged; no epoch table is created and no session rows or payments are migrated. The private native-provisioning adapter cannot run successfully without a trusted matching epoch.

When the flag is explicitly enabled for a later **reviewed** staging rehearsal, sessions that were selected before the feature was enabled are **not automatically trusted**: they have no selected-event epoch and cannot provision a native mapping until a fresh session organization selection occurs. The original application session and tenant selection can still be used for normal existing functions.

This design is conservative: it may require a new session lock for a native administrator and may reject an otherwise valid provisioning operation if its session lock or organization policy changes during the native proof. A fresh operation must issue a new native challenge.

## Test evidence

- `tests/session-native-link-provisioning.test.mjs`: real disposable identity + organization SQLite, per-app paid-LIVE-shaped synthetic seat, ephemeral Ed25519-signed native response, exact A → A and A → B → A native-call races, unchanged millisecond clock, plus a regression for genuinely idempotent repeated selection. All identity link results remain **metadata-only**.
- `tests/native-provisioning-session-epoch.test.mjs`: old pre-feature session is **not auto-authorized**; a new epoch is durable after closing/reopening the SQLite DB; clearing revokes the epoch; default disabled configuration preserves original session operations.

## Explicit release blockers

This is **not** an atomic cross-database authorization transaction: concurrent edits by different processes between the last organization revision read and the identity-store commit can still create a TOCTOU window. A reviewed cross-database commit/fencing mechanism, native request-level revocation and native backend permission enforcement remain mandatory. Future production rollout also needs a lifecycle plan for accumulating epoch events (secure retention/compaction without sequence reuse), authorized session-lock migration, backup/restore of the organization database, real live payment verification, secure key rotation and native HTTPS E2E testing. No native signing endpoint is deployed.

No real customer data, original native app repositories, current broker/PKCE handler, paid subscription, default organization UI/session behavior or DataDuck release is changed. This PR must remain **draft/unmerged/undeployed** until reviewed alongside #140 and #26.
