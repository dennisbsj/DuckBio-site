# Native Workspace preflight: organization audit epoch (DRAFT)

This is a **dormant, non-authorizing** change stacked on PR #166 (which itself
depends on draft #149 → #145 → #141). **No production SSO, application
login, native permissions, real checkout, deployment or DataDuck access is enabled.**
The canonical broker denial adapter in #149 still returns `null` for every
`getAccess` call.

## The race closed

Before this change, the native verifier was awaited between two read-only
Workspace policy checks. The second check compared the native identity mapping
generation and role **name**, but did not detect all authorization changes
which ended with the same visible role/permission/paid-through values:

* An admin removes then restores one user's `workspace.view` permission.
* A role policy loses then regains the permission without renaming the role.
* A separately verified **LIVE** billing transition renews/revises entitlement
  while restoring the same seat count and paid-through timestamp.

The preflight now reads `authorizationAuditRevision` from the latest
`organization_audit.id` in the **selected organization**. This is an
`INTEGER PRIMARY KEY AUTOINCREMENT` audit key: organization membership,
app-role, per-user permission and verified-live subscription changes append
entries even if they restore previous values. The inspector requires a safe,
positive integer cursor and **compares it across the awaited native call**;
changes deny the candidate with `access_changed_during_verification`.

The inspector also compares the current `verifiedPaidThroughMs` across the
await (previously it only checked that both terms were still in the future).
Changes to an unrelated organization's cursor do not deny this tenant.
The returned cursor remains private diagnostic evidence, never an app credential.

## Trust boundaries and limitations

* An audit cursor proves that the Workspace SQLite *write history* changed. It
  does **not** attest that a native application checked ownership, that the
  subscription is paid, or that custom app roles are enforced inside a native
  app. Those are separate requirements.
* This protects the *two sampled moments* of a read-only diagnostic. It does
  **not** make future native API operations atomic with Workspace policy or
  prevent a grant from changing immediately after the last check.
* The selected session organization's **own lock generation** is not yet
  independently versioned here. Session replacement and clear/reselect
  hardening remain a separate task; the present identity/session/tenant checks
  still apply.
* The audit cursor alone is **not** a sufficient `bindingRevision` for the
  broker in PR #166. A future trusted grant generation must also bind native
  link revision, selected Workspace session organization, exact app, policy and
  billing evidence, and be nonreusable across revoke/regrant.
* If writers bypass the Workspace organization-store's audited mutation
  methods or tamper with the audit ledger, this revision cannot detect them.
  That is a database trust boundary, not a capability provided by the cursor.
* Stripe TEST, legacy receipts, drafts and DataDuck still provide no paid
  evidence. No native verification, hosting or billing activation is inferred
  from passing the synthetic tests.

## Verification

Under `workspace-server/`:

```sh
npm run check
node --test tests/workspace-native-canonical-unit.test.mjs tests/workspace-native-canonical-cross-store.test.mjs
npm test
```

The new regression tests exercise real private organization SQLite mutations
from synthetic, in-process native verifiers: permission revoke/regrant,
role revoke/restore, verified-live revision with identical visible entitlement,
unrelated-tenant changes, and malformed/missing audit cursors. These are not
connections to Stripe or production native services.
