# Workspace native recovery — quarantined two-database candidate

**Private, UNMOUNTED rehearsal. NO automatic production restore, SSO cutover or live backup activation.**

This draft stacks on #163's coordinated SQLite snapshot-pair manifest, #159's read-only inventory auditor and #160's real OS SIGKILL recovery tests. It adds `shared-auth/native-quarantine-restore.mjs` and nine disposable real-SQLite integration tests. The six original native app repositories, DataDuck, production Workspace broker and Stripe are **untouched**.

## Why quarantining a restored database matters

A clean, hash-matched snapshot from #163 may still contain a valid old Workspace browser session, password account, global legacy grant, current-looking LIVE-shaped subscription, or selected organization lock. Restoring it directly into a live server could resurrect access **without fresh native ownership, paid entitlement or resource ACL verification**. An offline inventory report alone cannot prevent this.

`createPrivateNativeQuarantineCandidate({batchDirectory,outputDirectory,now})` accepts only a verified, completed two-source snapshot bundle and an existing private destination directory. It copies the files to a unique private staging directory, leaves the original snapshots **byte-for-byte untouched**, and then performs the following isolated copy-only mutations:

| Database | Quarantine of copied data | Preserved for investigation |
|---|---|---|
| Central identity | Delete ALL parent sessions, global legacy app grants, pending account invites and bootstrap tokens. Disable ALL central users and advance their `auth_version`. | Scoped native user/tenant mapping rows, append-only mapping audit, user records, credential hashes (not usable while disabled) |
| Organization | Clear ALL session-selected tenant locks, pending organization invites and purchased app-seat counts. Disable ALL members and cancel active LIVE-shaped entitlement rows in the **candidate only**. | Organization identities, app/role assignments, permission history, original Stripe event/revision records, audit history, monotonic session-lock epochs |

The copies are checked for SQLite integrity, foreign keys and ten separate zero-authority conditions (no active user/member, session, grant, invite, bootstrap token, seat or active term). Only then are both quarantined DBs and one `quarantine.json` written under a private `quarantine-UUID` directory through a single local directory rename. The manifest has the source bundle ID, copy checksums and non-authorizing flags. Failure before publication cleans up the private pending directory.

This is **deliberately destructive to the disposable candidate's authorization state**. Do not mistake the candidate for a fully restored production database. The source #163 backup, canonical native link audit and historic billing event ledger are preserved. Operators must separately review how to recover legitimate users/subscriptions from their authoritative systems.

## Two user-facing APIs — neither authorizes access

```js
import {createPrivateNativeQuarantineCandidate,verifyPrivateNativeQuarantineCandidate}
 from './shared-auth/native-quarantine-restore.mjs';

const staged=createPrivateNativeQuarantineCandidate({
 batchDirectory:'/private/backup/batch-<uuid>',
 outputDirectory:'/private/isolated-recovery',
 now:Date.now()
});
const report=verifyPrivateNativeQuarantineCandidate({
 candidateDirectory:staged.candidateDirectory
});
```

Both functions require private absolute canonical, non-symlink paths, with the snapshot pair validated against its SHA-256 manifest. The verifier independently reopens the quarantined copies read-only and refuses changed hashes, added files, any active authentication surface, a damaged SQLite database, or invalid metadata. Its positive result means only that the two **copied** DBs remain quarantined: `restoreApproved:false`, `loginEnabled:false`, `accessGranted:false`, `licensesGranted:false` are always forced false.

## Real SQLite regression coverage

Nine tests independently create two native-enabled disposable SQLite databases with synthetic operator and native trust, synthetic verified-LIVE-shaped subscription rows, current sessions, organization locks and an explicit **legacy global app grant**. After snapshot capture, they reopen the staged central account service and organization store to check that:

- both old parent sessions and a previously valid cookie/token are gone;
- a previous valid password cannot log in, a fresh session cannot be created, and old global grants are absent;
- native mapping and append-only provenance remain visible for audit **without enabling SSO**;
- selected tenant and paid-seat evidence no longer qualify for app use;
- changed files, manifest fields, re-enabled account state, invalid/expired bundles, untrusted paths, extra files and incomplete staging are rejected;
- the published original snapshot pair remains valid and byte-for-byte identical.

## Limitations before any real restore

- No claimed cross-database power-loss atomicity, filesystem crash consistency, signed backup provenance, multi-host coordination or backup encryption/retention.
- A candidate **cannot** be started as a functioning Workspace; central accounts and organization memberships are intentionally disabled. Fresh operator-approved recovery, authenticated native attestation, independent Stripe LIVE reconciliation and downstream native resource ACL mapping must precede any production service.
- The verifier is not called by the production runtime. Even after a successful rehearsal, there is no automatic way to bring a quarantined candidate live; new runtime release/activation gates and staged HTTPS evidence require separate security review.
- Backup and candidate manifests are not signed and do not attest to trusted remote origin or freshness.
- The project still requires eight genuine HTTPS service origins and app-by-app release acceptance under #140 and #26. No app repositories or DataDuck were modified.

**Keep draft/unmerged/undeployed**. Do not run against production or treat the rehearsal as customer disaster recovery.
