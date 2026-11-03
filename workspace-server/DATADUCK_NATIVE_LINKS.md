# DataDuck native identity linking (Workspace source-only milestone)

Status: **DORMANT / NOT DEPLOYABLE**. This is a private Workspace-side component, not a seventh enabled app, not native DataDuck code and not a new login route.

## Scope

The `dataduck-native-links.mjs` registry stores an explicit, operator-verified one-to-one relationship between a **Workspace organization/account** and existing **DataDuck native organization/user UUIDs**. Its database is private SQLite with tenant uniqueness constraints, transactionally audited link, re-verification and revoke operations.

The component requires private adapters for all of the following before it can be instantiated:

- `authorizeMutation` — verifies an actual currently authorized organization administrator or trusted operator for bind/revoke.
- `currentAssignment` — checks live central membership and separately assigned per-app DataDuck access, not a universal seat counter.
- `verifyNativeOwnership` — confirms the exact native user and organization UUIDs with DataDuck's authoritative backend, using trusted evidence. **Never join by email.**

Callbacks must return the boolean `true` explicitly; missing adapters, errors and other responses fail closed. The evidence itself is not persisted. Both native UUIDs are required and canonical.

`bindVerified` cannot silently change an existing identity, reassign a native UUID to another Workspace account or pair one native tenant with multiple central tenants. `revoke` hides access immediately and preserves ownership tombstones so another user cannot hijack the native mapping. `findCurrent` rechecks current central assignment and returns nothing after reassignment, user deactivation or app access removal **if the supplied trusted adapter reflects these state changes**.

## Strict limitations

This is **identity mapping only**. Every successful operation explicitly reports `licenseGranted:false` and `loginEnabled:false`. It does not create credentials, authenticate a session, authorize any DataDuck endpoint, sell seats, alter billing, install client secrets or register DataDuck as a live broker client. The running broker imports none of this code.

Before any use beyond synthetic tests:

1. Complete the separately verified seven-app live entitlement/seat policy, including existing six-app Bundle grandfathering and no automatic migration.
2. Integrate this link registry with a private, trusted Workspace role and native account verifier. Review current assignment and suspension checks, and coordinate native user/org UUID provisioning with DataDuck PR #1.
3. Ensure DataDuck itself continuously enforces its own role/project permissions, native account state and valid independently verified paid entitlement on every protected API request.
4. Exercise real HTTPS SSO/PKCE, revocation, rollback and eight-origin staging end-to-end; review the non-atomic verification/write window before enabling any production flow.

## Verification

`node --test tests/dataduck-native-links.test.mjs` (from `workspace-server/`), included automatically by its existing `npm test` glob. Tests run only against disposable local SQLite and synthetic private adapters. No live user, payment, native DataDuck repository or production host is touched.

Related: Workspace draft PR #128 (seven-app commercial decision), DataDuck draft PR #1 (native backend), Workspace integration issue #26.
