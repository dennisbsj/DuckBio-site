# Workspace native identity final-commit write fence — unmounted draft

This source-only follow-on to [draft #155](https://github.com/dennisbsj/DuckBio-site/pull/155) improves the **short window between a trusted native proof and the final canonical identity SQLite mutation**. It does not activate native provisioning, SSO, user seats or any real subscription.

## Problem

Workspace's canonical organization-scoped native link is stored in its private **identity SQLite database**. The authoritative selected tenant, operator role, target effective permissions and verified-live-shaped paid seats are stored in a **separate organization SQLite database**. Drafts #153 and #155 check monotonic organization policy and selected session epochs, before and after a native network challenge. But without a final lock, a separate process might change entitlements between the last organization read and the identity SQLite commit.

## Private final-commit fence

Only the existing explicit `nativeProvisioningSessionEpochs:true` private organization-store configuration makes the new **unmounted** method `nativeProvisioningAcquireCommitFence({organizationId,accountId,sessionId,organizationAuditRevision,sessionLockEpoch})` eligible.

The method checks the session-selected tenant and both durable policy/session epochs, then opens a second SQLite connection to the **exact existing organization database** and executes `BEGIN IMMEDIATE`. The connection uses `PRAGMA busy_timeout=0`, so contention **fails immediately** rather than blocking the Node.js event loop. After acquiring the SQLite write reservation, it **rechecks** both versions to detect any write that committed immediately before lock acquisition. It returns only an idempotent `release()` lease; it never modifies roles, subscriptions or native links. On failure it releases the handle.

In the private native provisioner:
- The signed native ownership verification runs **before** the write fence is acquired; there is no remote HTTPS, Stripe or network call while the organization DB is write-locked.
- After the native response, a valid `BEGIN IMMEDIATE` lease fences concurrent writes by **other SQLite connections and processes using the same organization database file**. The operator session, tenant epochs, active target app permission and covered paid seats are re-read while locked.
- The identity store runs its existing final private authorization check and synchronous canonical SQLite insert **before releasing** that organization write reservation. Every error path releases the lock in a `finally` block.
- An organization admin may still *revoke* a stale native mapping after a target account or paid term expired. Revocation acquires the same fence just before its identity SQLite deletion, and does not require an external native signing call.

Concurrent organization writers, including separate service processes using the same SQLite file, must wait or receive `SQLITE_BUSY` until this tiny identity commit completes. With this opt-in implementation the competing write attempts are intentionally denied by the fence. Any caller unable to obtain the fence must fail closed, and retry with a **new** signed native challenge.

## Synthetic integration verification

`tests/session-native-link-provisioning.test.mjs` adds real SQLite second-connection contention tests. A separate connection attempts `BEGIN IMMEDIATE` during the fenced canonical identity commit and must fail with `database is locked`. After the operation, the competing writer must succeed. Tests also cover:

- Preexisting writer contention denying the signed bind without writing identity mapping/audit, followed by successful fresh signed retry.
- Identity commit conflict in the second tenant, proving the final lock is released even when the identity transaction fails.
- Secure native mapping revocation under the same cross-process write fence after target suspension and paid term expiry.

An extra test launches an **independent Node.js process** while the parent holds the write fence. The child runs SQLite `BEGIN IMMEDIATE` against the same private organization file, observes `SQLITE_BUSY`, and immediately succeeds when tried again after the fenced identity commit finishes. This supplements the same-process separate-connection contention tests and is still purely local disposable CI verification.

The tests use only disposable **real** identity/organization SQLite databases, synthetic current-paid-shaped allocations, ephemeral Ed25519 test keys and an intercepted native transport.

A further regression creates a detached promise **inside** an authenticated `AsyncLocalStorage` operator scope, but resumes it **after** the canonical SQLite commit and fence release. The controller now permanently marks each operation scope as closed in `finally` and rejects both late authorization callbacks and late native ownership proof requests. This prevents an inherited async context from being reused as a stale operator capability after the originally requested mutation finished. They do not contact real native apps or a payment processor.

## Limitations and release blockers

**This is SQLite writer serialization, not a crash-atomic multi-database transaction**: WAL-mode transactions spanning two independent database files do not guarantee durable all-or-nothing rollback across power loss. Reconciliation, verified backups and recovery procedures remain mandatory.

This fence only protects writers that use the **same actual organization SQLite file and compatible filesystem locks**. Deployments using divergent replicas, remote caches, multiple hosts without shared safe SQLite locking, or out-of-band entitlement authorities require a separate distributed consistency design. The existing org store's central policy operations still must be the only authoritative way to change roles or paid seats. A fresh authorization can be revoked immediately after commit; each subsequent native request must independently check its own active access and paid entitlement.

The lease is deliberately limited to the synchronous final identity commit; never add arbitrary awaited network I/O under it. Audit the final integration against process crashes and filesystem restore, and verify lock behavior under actual staging deployment. This branch is **draft, unmerged, undeployed, no real customers**.

The native app teams must still implement the independent signed HTTPS ownership endpoint, native-account/tenant controls and per-resource authorization. Real LIVE Stripe evidence, secure authenticated browser-admin UI/CSRF and complete HTTPS multi-origin SSO/E2E testing remain outstanding.

Other workstreams #154 and #157 own the independent **deny-only** broker rehearsal and should not be merged redundantly; they are untouched here. DataDuck remains unreleased.
