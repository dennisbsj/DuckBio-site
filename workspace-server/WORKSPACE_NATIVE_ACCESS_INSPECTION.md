# Workspace native access inspection — source-only, not an authorization grant

**Status: DORMANT.** No HTTP route, client secret, session, user license or app permission is enabled by this implementation. DataDuck is **always blocked** until seven-app licensing is independently approved and implemented.

The private `workspace-native-access-inspector.mjs` makes one conservative, read-only *candidate* assessment for a Workspace login session targeting one of the six registered native apps. All seven DuckBio app IDs are known but `dataduck` always returns `dataduck_not_released`.

The assessment combines:

1. A fresh current parent session and active central account, fetched server-side from `identityStore`.
2. Exact organization selected and locked to **that** parent session; a browser cannot choose a different tenant.
3. An **assigned app role** and the currently effective permission, including tenant-specific edited defaults, custom roles and user-level overrides from `organizationStore`.
4. Actual active, unexpired independently verified **Stripe LIVE** subscription allocation for this organization and app; enough such purchased seats must cover assignments **and reserved invitations**. An older receipt, legacy unverified seat, Stripe TEST result, shadow entitlement or draft never passes this strict read.
5. Explicit pre-existing native user **and native organization** IDs in the central private grant, independently checked through a required, trusted `verifyNativeMapping` server callback. No email joins and no central-admin-to-native-admin promotion.
6. Rechecking session, tenant, role, current permission, paid seats and native IDs **after** the external native verification returns. A changed identity or revoked permission produces a denied candidate.

`organization-store.mjs` exports the read-only `verifiedNativePermissionCandidate` store method for the six registered apps. The new inspector does **not** relax `accessFor`, existing six-app broker grants, billing, plan validation or the separate DataDuck release gates.

Even if `candidateReady:true`, the result deliberately includes `accessGranted:false`, `loginEnabled:false` and `licensesGranted:false`. **Never feed it to a browser as an SSO token or treat its success as native authorization.** Individual native backends remain authoritative for local account status, app role and each resource operation, and must recheck live paid entitlements in their own request guards. There is an unavoidable time-of-check/time-of-use window across services; this preflight cannot remove it.

The current active broker may still expose older central identity mapping flows separately; this branch does **not** claim to secure or replace them. Production Workspace continues to require native SSO integration, signed/verified billing adapter injection, appropriate release review, eight HTTPS origins, tests against real native backends, rollback and explicit deployment authorization.

## Tests

The new Node suite runs real temporary Workspace organization SQLite storage and synthetic central/native adapters, covering read-only positive candidate, DataDuck denial, legacy-receipt denial, cross-org session lock, permission override and role edits, native verifier outage, central suspension, paid term expiry and role or mapping revocation during async native validation. It creates no production accounts or payments.

Run from `workspace-server/`: `npm test` and `npm run check`.

Related work: merged organization role PR #127, product decision draft #128, native link registry draft #134, seven-app transition preview draft #135, and DataDuck native backend draft PR #1. Neither draft is implicitly activated by this candidate.
