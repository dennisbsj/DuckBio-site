# Workspace organization-scoped native identity links (opt-in, draft)

**Source milestone. Not activated in production, staging, browser SSO, billing or native apps.** This is a backward-compatible extension to the first-party Workspace identity database, not a replacement of the existing shared broker.

## Problem

The existing private SQLite table `suite_identity_grants` has `PRIMARY KEY(user_id,app_id)` and permits only one native actor per Workspace person+app, even if that person works in two organizations with separate native accounts. Sharing that actor with another organization risks cross-tenant access. Merging the same native identity based on email is forbidden.

## Design and safe additive schema

New schema **only when the operator passes a complete private** `orgNativeLinks` configuration to `createIdentityStore`:

- `suite_identity_org_native_links`: `(user_id,app_id,workspace_org_id)` primary key, explicitly verified `native_user_id`, `native_org_id` and verification timestamp. Native user IDs are unique per app. Within an app, one Workspace organization cannot silently map to several native organizations, nor can one native organization be shared across different Workspace organizations.
- `suite_identity_org_native_audit`: minimal private metadata about verified bind, legacy migration and explicit revoke. No session cookies, access tokens, passwords or email.
- **No automatic legacy backfill.** Opening the schema cannot create any org-specific access. Current parent sessions, global grants and broker behavior remain unchanged.

Existing callers instantiate `createIdentityStore({databasePath,clock})` without `orgNativeLinks`: that remains the default. The new private methods are not exposed via routes, broker token assertions or browser UI.

When a *future, separately reviewed* private operator flow uses these methods, it **must** inject both:

- `authorizeMutation(tuple)`: freshly check the actor's organization-specific admin authority, member/app assignment and tenant boundary; return exactly `true`. This is called again after the awaited native proof to catch interim permission removal.
- `verifyNativeOwnership(tuple)`: securely consult the relevant native backend and verify exact native account ID, native organization ID, central account mapping and application, including active native status; return exactly `true` only on validated ownership. Emails, role text or caller-supplied flags are never enough.

The new API methods are:

- `bindVerifiedOrganizationNativeLink({actorId,userId,appId,workspaceOrganizationId,nativeUserId,nativeOrganizationId})`
- `migrateVerifiedLegacyNativeLink({actorId,userId,appId,workspaceOrganizationId,nativeOrganizationId})`
- `revokeVerifiedOrganizationNativeLink({actorId,userId,appId,workspaceOrganizationId})`
- `getOrganizationNativeLink({userId,appId,workspaceOrganizationId})` — returns **mapping metadata only**, requires an active account, and never falls back to a legacy grant.
- `orgNativeLinkAudit({appId,workspaceOrganizationId})` — private bounded audit query.

All returned link metadata has `accessGranted:false`, `licensesGranted:false`, `loginEnabled:false`. **Even after merging, this module cannot establish an SSO session or paid seat.** The six existing app identifiers are the only allowed IDs; DataDuck remains unreleased, with a separate dedicated native UUID candidate in draft PR #134.

## Controlled legacy migration procedure (NOT run here)

1. Back up the **entire private SQLite identity database consistently**, including WAL state and an offline restore test, before enabling any migration. Keep access limited to trusted operators. Do not handle real user mappings in public CI.
2. Confirm the exact target Workspace organization and its verified native organization, current active native user, licensed app assignment, administrator authority and independently verified live seat in the native and central backends.
3. Opt in to `orgNativeLinks` only in a private reviewed migration tool with actual trusted adapters. No runtime login adaptation occurs at this stage.
4. For a legacy global grant, call `migrateVerifiedLegacyNativeLink` **only** with a verified Workspace org and native org. The stored native user ID must still match; when an old optional `organization_id` exists it must match the supplied verified native org ID. When it is null, independent native ownership proof is still mandatory.
5. Verify no native-user reuse, contradictory tenant relationship or cross-identity legacy collision occurred. Verify idempotence, audit trail and rollback.
6. Separately implement and review a session/organization-aware broker that reads only the new exact mapping, PLUS live paid entitlements, app role permissions, native session status and request-specific resource authorization. Do not activate the old global fallback for this path.

**Critical export limitation:** The historical portable account format v1 does not contain either these mappings **or their historical audit trail, including after every link has been revoked**. To prevent a silent loss of tenant-native identity links, `exportPortable()` now **fails closed** with `org_native_links_require_database_backup` when any organization links exist. Older deployments and empty/new databases with **no link OR historical link audit** retain portable v1. A portable v1 **import is likewise refused** when scoped link/audit history is already in the destination database (even if all accounts were removed), preventing accidental mixing of identities across backup histories. A complete, reviewed portable v2 export/import needs to be implemented **before any actual rollout**; until then, a consistent, secured SQLite snapshot/restore is the only supported full backup strategy.

## Tests, isolation, and missing gates

The 14 migration tests and three additional cross-store real-SQLite tests cover: legacy session/grant retention, no implicit migration, two native users for one account in two orgs, independently verified legacy migration, missing native-org denial, native-user collisions, cross-tenant conflicts, use of another central identity's legacy actor, revoke/rebind/audit, external provider outages, authorization loss mid-verification, disabled users, portable-export completeness, DataDuck denial and legacy grant changes during migration.

Cross-store tests inject actual Workspace organization admin and app-assignment/permission checks and verify native mapping revocation after member deactivation; they deliberately use **synthetic test seats** and **do not prove any real paid entitlement**. The native preflight draft PR #136 remains the independent verified-LIVE-seat boundary.

Run `npm test` and `npm run check` in `workspace-server/`. GitHub Actions executes Node 22 and 24. The actual private adapters are **not provided**, no HTTP endpoint is added and the existing Workspace server does not opt in. Do not merge, deploy or activate without end-to-end native and HTTPS staging validation and backup/restore design review.

Related: org-specific roles merged PR #127, DataDuck commercial draft #128, DataDuck native links draft #134, seven-app seat preview draft #135, Workspace access preflight draft #136, cross-store tests draft #137, DataDuck route permissions draft #138, and integration PR #26.
