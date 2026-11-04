# Legacy global app grants: durable revocation generation and organization-mode isolation

**Status: unmerged source-only Workspace security candidate; no production activation.**

## Confirmed ABA threat

The original `suite_identity_grants` table stored only user, app, native user and an optional native organization. `revokeAppAccess` deleted a row; `grantAppAccess` could recreate exactly the same row while the original parent session remained valid. The active broker already pins client/app, original parent and native identity, and optionally compares a `bindingRevision`. However, the active local identity adapter did not supply any revision; a previously issued app child proof or PKCE code could therefore become valid again after revoke/regrant of an identical global native tuple.

## Narrow fix, without a second authorization engine

- Introduce `suite_identity_grant_versions(user_id,app_id,revision)` in the existing **private identity SQLite database**. The version record is intentionally retained after a grant is deleted. Fresh and existing legacy grants receive a strictly positive generation.
- Create the table and seed genuine legacy grants **atomically** under SQLite `BEGIN IMMEDIATE`, rechecking table existence only after acquiring the lock. Do not silently recreate missing rows in an already-established version table.
- An authorized global grant creation/change, including identical rebinding, advances the generation in the **same transaction** as the grant upsert. Revoking an existing grant advances the generation and removes it in one transaction; revoking an already absent grant does nothing. Integer overflow or corrupted missing versions deny and roll back.
- Keep `getAccess()`'s original public data shape for standalone account administration and portable backup. Provide a **separate server-only** `getAccessWithRevision()`, whose `bindingRevision: legacy-global:<positive revision>` is supplied to the existing broker by the standalone identity adapter. The broker already checks this binding at code exchange, proof introspection and native authentication. Historical unversioned proofs/codes fail after the updated adapter is installed.
- When `organizationStore` is supplied to `createLocalIdentityAdapter`, **no legacy global grant qualifies for organization SSO**. This is explicit fail-closed behavior while the separately reviewed organization-native authorization broker is dormant, not permission synchronization.
- The organization's `account.apps[].enabled` must not be inferred from legacy global mappings. It is `false` in organization mode. Existing standalone-mode app login and account mapping continue to work with the new revision.

## Distinct safety boundaries

The global grant epoch is **not** #187's authorization audit cursor, #192's session-organization selection revision or the native organization link's own generation. It protects only standalone/global grants; the other revisions independently protect organization policy and ownership. A validated identity or positive native preflight does not create a paid seat.

Native deep-link redirects and content IDs are **navigation only**; they are never equivalent to broker code, authorized native API access or verified LIVE app-seat entitlement. Separate source changes must check current organization selection, paid capacity and permissions and revalidate after asynchronous resource lookup, while the native app still performs independent per-request authorization.

## Operator and restore warnings

Backing up only the global-grants table without its retained generation tombstones is unsafe. Back up the **whole identity SQLite database including WAL**, the broker code/proof store and the organization/native stores consistently. Cross-database snapshots may cause a generation rollback unless all prior app codes and child proofs are invalidated and new session keys are established. Do not truncate the version table, reuse parent session identifiers, or attempt unreviewed migration into live DBs.

Source regression: `tests/shared-auth-legacy-grant-generation.test.mjs` drives real synthetic SQLite and the HTTP broker, exercising grant revoke/rebind with identical native tuple, stale code exchange, stale child proof, and standalone login after a fresh grant; organization mode is denied even when a legacy grant and a verified synthetic paid allocation coexist.

All PRs remain unmerged. Exact-head Node22/24 CI and independent security review are required. No live native URLs, DataDuck grants, Stripe payments or staging were changed. See activation runbook #190.
