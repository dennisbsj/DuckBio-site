# Workspace native identity recovery: private TWO-SNAPSHOT consistency audit

**This is a diagnostic for an offline operator. It does not back up or restore any database; it does NOT grant a login, subscription, native permission, verified identity, or release approval.**

## Purpose

After a crash, rollback or independently timed restore, the identity SQLite database may still contain a verified native user/tenant link while the Workspace organization SQLite database shows that the central user is disabled, removed from a tenant, unassigned from an app, or no longer backed by enough current LIVE-shaped capacity. The new [private audit source](shared-auth/native-link-recovery-audit.mjs) discovers **visible structural drift**, but cannot claim to prove there was never an in-flight cross-store transaction.

This complements #144's identity-only `VACUUM INTO` snapshot rehearsal, #158's short-lived dual-DB write fence, #155's durable session epochs and #141's canonical audited org-scoped identity mapping. It introduces no writes and requires no native app change.

## Running against private, quiescent copies

An operator first stops native linking and all writers, and separately creates consistent `VACUUM INTO` copies for **each** source SQLite database using the already reviewed backup procedure. Name the copies `identity.snapshot.sqlite` and `organization.snapshot.sqlite`; place them in a private directory with `0600` file permissions. Do not use a plain live `.sqlite` copy in WAL mode. Preserve the original source files and their `-wal`/ `-shm` files as required by a full disaster-recovery process. Back up identity audit **even if no active links remain**; legacy portable v1 cannot represent its provenance.

The unmounted library entry point is:

```js
import {auditNativeScopedRecoverySnapshots} from
 './shared-auth/native-link-recovery-audit.mjs';
const report=auditNativeScopedRecoverySnapshots({
 identitySnapshotPath:'/private/rehearsal/identity.snapshot.sqlite',
 organizationSnapshotPath:'/private/rehearsal/organization.snapshot.sqlite',
 now:Date.now()
});
```

All paths must be absolute, non-symlink, **existing** private 0600 files ending `.snapshot.sqlite`; the input files must differ. The function opens both with SQLite `readOnly:true` and `PRAGMA query_only=ON`; it checks identity and organization schema, database integrity, foreign keys and 5,000-link safety limit. **It does not create, migrate, copy, repair, rekey, write, or delete anything.** No HTTP endpoint is registered.

## Findings

For each canonical org-scoped native link, the utility examines:

- active central account and latest canonical **bound/migrated** audit generation, with no fallback to unscoped legacy grants;
- Workspace tenant existence, active organization membership and explicit app assignment;
- subscription seat allocation count, including pending reservations; and current active `stripe_live`-shaped paid term seat coverage **as stored in the snapshot**;
- app ID restricted to the six original apps; DataDuck is unreleased.

It returns only counts, last audit cursors and a truncated SHA-256 fingerprint of each link with reason codes (no names, email, native user ID or organization identifier). A consistent snapshot returns `structurallyConsistent:true`, but **ALWAYS** `recoveryApproved:false`, `loginEnabled:false`, `accessGranted:false` and `licensesGranted:false`.

## Non-negotiable limitations and follow-ups

A clean structural scan does **not** demonstrate that the snapshots were captured atomically as a pair, that a concurrent transaction did not commit between snapshots, that native signing keys and accounts remain valid, that the Stripe payment remains current, or that native resource permissions match Workspace roles. It cannot automatically repair tenant mismatches, infer an organization from an email, validate the native application database, or reconcile restored sessions by timestamp alone.

Before any staged rollback approval: establish a secure *coordinated* backup generation and restore ledger; independently verify fresh Stripe LIVE entitlements, native user/organization ownership and all per-resource ACLs; invalidate stale parent sessions and app proofs; manually review structural findings; rehearse crash injection with all six real native backends over the eight intended HTTPS origins. **Never auto-enable SSO from this report.**

The seven tests use disposable **real SQLite** identity and org databases, synthetic operator/native trust callbacks, and fake LIVE-shaped seat events. They verify clean counts are still non-authorizing, mismatched snapshot member suspension, app unassignment, expired paid terms, retained audit after revoke, private file/path checks, schema drift and no source modification.

Keep this PR **draft, unmerged, undeployed**. Related blockers #140, #26. No native app repositories or DataDuck were modified.
