# Session-epoch-fenced Workspace SSO broker safety rehearsal (draft)

**Development only. Never deploy as a live native SSO adapter.** This work stacks on PR #155 (durable, opt-in session-lock epochs and organization audit ABA), itself stacked on #153, #152, #150, #145 and #141. It integrates the **deny-only** broker test adapter originally developed in PR #149 and signed provision-to-broker synthetic tests in PR #154. Reviewers must consolidate these overlapping test adapters into one authoritative implementation before any merge; do not double-merge sibling PRs.

## Why this incremental gate is needed

A read-only native access inspector (#145) checks session-selected tenant before and after awaiting an authentic native user+tenant verification. If the same session is switched from A to B and back to A (or clears A then re-selects A), all final IDs and permissions can match the original and the inspector's mapping revision can remain unchanged. The separate session-bound provisioner (#155) already captures a monotonic session-lock epoch across such switches. This draft extends that stable generation requirement to the **broker-facing diagnostic seam**, without modifying the already-owned inspector or the production broker.

## Implementation

The source-only `shared-auth/native-broker-deny-adapter.mjs` now requires the **opt-in** `organizationStore.nativeProvisioningAuditRevision({sessionId,accountId,organizationId})`. Before and after every awaited native inspection it validates BOTH:

- `sessionLockEpoch` from append-only `native_provisioning_session_epochs`, which changes on clear/reselect regardless of timestamp.
- `organizationAuditRevision` from audited member, role, permission, invitation and paid-capacity changes. This changes even when a policy is briefly removed and reinstated.

Missing, malformed, old pre-opt-in or changed revisions **fail closed**. Tenant IDs are always looked up from the private authoritative parent session's organization lock, not from browser assertions. The adapter does NOT issue authorization or broker proofs: `getAccess` returns `null` for **every** native app, even after a positive, unchanged signed ownership inspection. DataDuck stays denied.

## Real stores, fake external services

Existing seven tests from #149 and five signed tests from #154 are ported to the opt-in epoch configuration of the actual Workspace **organization SQLite** store. Four more cross-module tests exercise:

1. Same-clock selected A → cleared → selected A during a valid signed native inspect.
2. Same-clock A → B → A during signed inspect with valid final identity.
3. Same-clock operator A → B → A while a signed native **bind** is awaited; the existing provisioner must refuse and create no link.
4. Permission deny → allow during a signed native inspect; final effective role is valid but the durable audit revision must deny.

The tests use real isolated SQLite identity+organization stores, signed proofs from **ephemeral synthetic Ed25519 keys**, a fake private HTTPS transport, synthetic LIVE-shaped seat ledger entries and the unmodified real HTTP/CSRF/PKCE broker running over loopback. No actual native server, Stripe LIVE network, customer accounts, tokens or production environment are touched.

## Security limits and necessary next work

This is still **deny-only** and cannot itself satisfy real native per-operation resource authorization. It does not establish atomic transactions across the identity/organization/native stores or guarantee a backend cannot change again immediately after the final read. Backup/rollback/retention of epoch logs, real native HTTPS ownership endpoints, real signed billing events and integration of all six native app authorization implementations require separate review and eight-origin HTTPS staging. **Do not deploy, enable or merge until security review and one canonical PR stack are agreed.**

Related PRs: #141, #145, #149, #150, #152, #153, #154, #155; blockers #140 and #26.
