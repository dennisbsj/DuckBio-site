# Workspace cross-store native access integration — synthetic-only test milestone

**Status: DRAFT / SOURCE-ONLY.** This branch builds on draft Workspace PR #136 (the dormant native access inspector). It does not modify DataDuck, the six native repositories, live hosting, Stripe, customer accounts, production clients or the public website.

## What this verifies

The new regression suite runs **two actual, independent Workspace SQLite stores**:

- `createIdentityStore`: real central user, private login session IDs, explicit native app-grant mapping and session/account revocation.
- `createOrganizationStore`: real independent organization memberships, central session organization locking, app assignments, built-in and organization-edited roles, and the verified-subscription ledger.

The test substitutes synthetic, deterministic provider evidence for the separately required private LIVE billing verifier. There is **no Stripe network call or production payment**. A test-only native ownership callback checks the exact Workspace account/organization and native account/organization identifiers, not email.

The suite proves that these real stores can be composed with the inspector while leaving `accessGranted`, `licensesGranted` and `loginEnabled` **false in every case**. It exercises:

1. A valid read-only candidate for a specifically licensed and mapped user.
2. A user who belongs to two organizations but whose native mapping belongs to only one. The second organization's session is blocked rather than silently reusing the first tenant's native user ID.
3. Historic/unverified seat receipts that do **not** substitute for current verified LIVE purchased entitlements.
4. Revocation of a central parent session or disabling the account.
5. Revocation of a native app ID binding during the awaited private mapping verification.
6. Changes to tenant-specific effective role permissions while the native verifier is running.
7. DataDuck remaining outside the active identity grant allowlist and explicitly denied.

## Important unresolved architecture decision

The existing central `suite_identity_grants` schema is keyed by **(central user, app ID)** rather than **(central user, organization, app ID)**. Consequently, it cannot represent two different native user/org pairs for the **same person accessing one app in two organizations**. The native verifier MUST reject any cross-tenant reuse until an independently reviewed org-scoped mapping migration is implemented. Do not work around this with matching email, shared native accounts or implicit Admin promotion.

DataDuck's own independent native UUID link proposal is in draft PR #134. Do not modify or duplicate it in this stacked test-only PR.

## Release gates

The inspector in parent draft PR #136 remains unmounted. Native backends are still independently authoritative for their own data and resource authorization. This harness does **not** prove an end-to-end browser SSO login, native API enforcement, a paid customer entitlement, privacy review, migration safety or eight-origin HTTPS staging.

Run `npm test` from `workspace-server/`. GitHub's existing Workspace core workflow executes on Node 22 and 24. No real callback or network listener is installed.

**Review order:** PR #136 first; this stacked PR second. Both stay drafts until the actual secure authorization integration and launch gates pass.
