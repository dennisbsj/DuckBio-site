# Organization-scoped native identity mapping (Workspace-only, draft)

**Status: source-only / unmerged / undeployed.** This stacked branch is based on Workspace draft PR #137 (which itself depends on #136) and addresses a part of issue #140. It does **not** resolve release acceptance, enable SSO, sell seats, change Stripe, migrate any customer data or modify DataDuck/six native app repositories.

## Reason for an isolated registry

The existing `shared-auth/identity-store.mjs` contains legacy `suite_identity_grants` keyed on `(user_id,app_id)`, used by the existing six-app broker. A shared central user accessing one app as a member of two organizations may need two different native identities. Reusing that global mapping is unsafe.

The new **private** `shared-auth/organization-native-grants.mjs` has a separate SQLite registry, keyed on `(workspace_user_id,workspace_organization_id,app_id)`. Only the six currently registered app IDs are permitted. A private operator must explicitly supply both native user and native organization identities, an audited approver, and a positive independent `verifyNativeOwnership` callback. There is no email-only match, arbitrary tenant switch, implicit Admin role, or automatic backfill from the legacy table.

Active mappings have a unique native app/tenant/user tuple. Revocation leaves a tombstone and audit history; a replacement mapping requires explicit revocation and new native verification. Each successful write changes an increasing revision. The registry and its WAL/SHM files are private and not under `public_html`.

## Dormant access inspection

`workspace-native-access-inspector.mjs` now requires a scoped link dependency, in addition to the *current* central parent session, active central user, session-locked organization, organization-specific role and permission, and independently verified current LIVE subscription ledger. It re-reads all this and compares link revision after an awaited private native mapping verification, so changing or revoking a link during verification cannot result in a stale candidate.

**In every case:** `accessGranted:false`, `licensesGranted:false`, `loginEnabled:false`. This source-only preflight does not enforce native resource privileges or issue any login tokens. The production six-app broker remains **untouched**, and its legacy mapping still exists for compatibility, but cannot be used by this preflight.

## Backwards compatibility, migration and limitations

- A legacy grant is **not** moved to an organization automatically. It remains in the original table. An operator must separately validate each user's organization membership, paid assignment, exact native ownership and app-specific policy before explicitly provisioning the new scoped link. Ambiguous legacy grants are therefore effectively quarantined from the scoped inspector.
- Existing six-app login and native app data remain unchanged; **do not** switch the broker to this registry without a separate reviewed, atomic migration and rollback plan.
- Future introduction of an organization-scoped broker must take the **server-validated parent session's locked organization**, never a browser-supplied organization claim. The scoped link is only one input; native app resource-level authorization and current paid seats remain mandatory.
- The verification function is an externally supplied, trusted private adapter. This module is not proof that any real native backend integration exists; tests use synthetic verifiers only. Caller-side operator authentication/authorization, current central assignment checks *at provisioning time*, service isolation and signed native verification must be added before real link creation.
- DataDuck native UUID link work in separate draft PR #134 remains independent. This registry cannot issue DataDuck links. Its launch requires separate native/Stripe/role checks and eight-origin staging.
- No deletion, re-key, irreversible migration or rollback of legacy SQLite is attempted in this PR. The full migration safety and end-to-end staging criteria in issue #140 remain **open**.

## Offline tests

Run `npm test` under `workspace-server`. Dedicated SQLite tests validate positive scoped links, two native tenant identities for one central account, explicit approval, denial on failed native verification, reuse prevention, relinking after revocation, audit persistence, no legacy auto-backfill, no seventh-app activation and revocation during asynchronous preflight.

The existing six-app integration checks remain in their own source-lock and staging acceptance suites. Successful local SQLite tests are **not** evidence of HTTPS SSO, production authorization, payment settlement or native API enforcement.

**Review order:** #136 → #137 → this branch. Keep this branch as a draft until code review and synthetic staging acceptance; native app changes are owned by the separate integration conversations.
