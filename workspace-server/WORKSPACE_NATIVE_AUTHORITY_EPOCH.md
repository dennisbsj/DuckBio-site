# Dormant six-app native preflight: monotonic Workspace authority generation

**Status: review-only, non-authorizing.** This branch builds on draft #166 (broker binding revision), #149 (non-authorizing broker adapter), #145 (canonical native preflight) and #141 (canonical scoped identity). No native app repository, DataDuck code, production runtime or live customer data is changed.

## Problem addressed

A native user's identity and organization tuple can remain identical after:

- an assigned app role or permission is revoked and restored;
- a member loses and regains an app seat;
- a custom or baseline organization role is edited and restored;
- a live subscription transitions to a new verified billing revision;
- an exact scoped native link is revoked and rebound.

Comparison of the final role, paid-through timestamp and user/tenant identifiers alone cannot detect these **ABA transitions**. An asynchronous native ownership verifier must not approve a preflight evaluated before a temporary revocation.

## Implemented diagnostic-only contract

The real, private organization store now derives `authorityAuditRevision` from the latest matching **monotonic SQLite AUTOINCREMENT audit ID** for the requested account, app and Workspace organization:

- Account/member assignments: membership create/update/remove/suspend/reactivate, accepted invitation for the exact account.
- App-specific, account-specific permission overrides.
- App-wide role policy create/edit/delete for the exact app.
- Verified-live subscription transitions for the selected organization (conservative: a transition for another app in the same organization can also invalidate the candidate).

Unrelated account changes and unrelated app role edits do not change the requested candidate revision. The revision is only computed on the existing **verified live** paid-seat, currently assigned app-role, currently allowed effective-permission path. Historic receipts, TEST candidates and DataDuck remain denied.

The dormant inspector rejects missing/invalid revision values and compares two reads across the awaited trusted native verifier. It also checks the canonical native mapping's `linkRevision` from its separate monotonic audit, and changes to the selected role and verified paid-through time. An ABA mutation during the await returns `access_changed_during_verification`.

A positive preflight now exposes a **private, non-authorizing** 64-character SHA-256 `preflightBindingRevision`. Its inputs include the exact Workspace org/account/app/permission, native user/org tuple, monotonic native link generation, monotonic relevant Workspace authority audit generation, role and verified paid-through time.

**A preflight binding is NOT an SSO grant, token, payment verification or authorization.** The #149 native broker adapter still **always returns `null` from `getAccess`**. In particular, never replace `null` with a `candidateReady`-derived local identity. The broker's optional `bindingRevision` in #166 is reserved for a separately reviewed **authoritative** adapter that verifies native backend enforcement and live billing.

## Rehearsal coverage

Eight real two-store SQLite tests verify: stable scoped fingerprint for unchanged authority; no cross-account/app role invalidation; permission revocation/restoration with identical final values and timestamp; app assignment remove/regrant; native mapping revoke/rebind; role ABA *during* an awaited native verifier; verified LIVE subscription renewal; missing audit generation denied. Tests continue to assert `accessGranted:false` and no active SSO.

From `workspace-server/`:

```sh
npm run check
node --test tests/workspace-native-canonical-cross-store.test.mjs tests/workspace-native-canonical-unit.test.mjs tests/native-broker-deny-adapter.test.mjs tests/shared-auth-broker-binding-revision.test.mjs
npm test
```

## Release blockers

- Trusted, real server-to-server native ownership verifiers, per-request app permission and resource enforcement, and a reviewed native app tenancy model for all six apps.
- Independently verified LIVE paid subscription evidence and sealed/canonical authority adapters; no client-issued grant or preview-derived entitlement.
- Atomic cross-store rollback, off-host encrypted backup / restore validation and a guarantee that restoring an earlier SQLite audit cannot resurrect old proofs. Audit IDs alone do NOT survive rollback as a global monotonic epoch; storage restoration must revoke all outstanding broker proofs or rotate an independent deployment generation.
- Strict native SSO opt-in cutover, coordinated migration from old global grants, HTTPS staging with all required origins, negative end-to-end tenant/PKCE/session tests, and code/security review.

**Keep all stacked PRs draft, unmerged, unactivated, and undeployed.**
