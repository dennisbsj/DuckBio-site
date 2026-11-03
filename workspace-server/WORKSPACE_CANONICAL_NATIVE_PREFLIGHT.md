# Canonical Workspace native mapping + read-only preflight (DRAFT)

**Dependency**: this branch stacks on Workspace PR #141, the opt-in verified mapping table in the **existing central identity SQLite database**. It does not use or import PR #142's separate SQLite native links table. It ports only the dormant preflight inspection design, which should be reconciled with #142 before any merge.

## One source of native identity

- The single canonical lookup is `identityStore.getOrganizationNativeLink({userId,appId,workspaceOrganizationId})` from PR #141.
- No email joins, automatic tenant inference, client-provided app role or fallback to `identityStore.getAccess(userId,appId)` are allowed.
- The private canonical `suite_identity_org_native_audit.id` is an SQLite AUTOINCREMENT integer. Each successful link/revoke records a new row. `linkRevision` is the **latest successful link audit row ID** for the exact Workspace user, app and org. It changes on revoke + rebind even if the IDs and timestamps are unchanged. No audit evidence or a latest revoke action yields a missing revision and denies a candidate.
- A mapping is metadata only and always reports `linkOnly:true`, `accessGranted:false`, `licensesGranted:false`, `loginEnabled:false`.

## Dormant native access preflight

The new `workspace-native-access-inspector.mjs` is **not imported by the existing SSO broker or HTTP handlers**. It requires the trusted parent session, active central user, exact session-locked organization, per-app member role + current effective permission, independently verified LIVE paid seat evidence, and a native-verified exact user+organization tuple. The native verifier is supplied privately by the caller and must be independently trusted, not by a browser assertion.

After awaiting native verification, it re-reads all central sources and the canonical mapping generation. If the tuple or generation changed while waiting, inspection denies. A successful result is **candidate-only** (`candidateReady:true`) and always explicitly returns `accessGranted:false`, `licensesGranted:false`, `loginEnabled:false`, `nativeEnforcementRequired:true`. No app login, token, purchase, seat, session, API action or native role is activated.

The inspector contains a preliminary six-app allowlist; **DataDuck remains denied** until its independent release and per-app verified LIVE licensing gates are satisfied. Original six native app repositories and production broker remain unchanged.

## Synthetic tests and release gates

The offline `tests/workspace-native-canonical-cross-store.test.mjs` suite exercises two actual private SQLite databases (central identity and Workspace organization), two session-locked tenants, verified-LIVE test ledger injection, separate native identities, no legacy fallback, revocation, account suspension, changed permission/role, DataDuck block and same-tick revoke+rebind ABA denial.

**Not production proof:** tests inject deterministic synthetic payment and native/operator callbacks; they do not demonstrate Stripe network confirmation, production-native ownership, native resource authorization, end-to-end HTTPS, paid licenses, MFA, staging, or tenant-wide backup recovery. PR #144 separately rehearses identity SQLite snapshots; organization + native cross-store recovery remains unverified.

**Do not merge/deploy without:**
- Reviewed canonical mapping migration and rollback (PR #141), backup/restore (PR #144), and disposal of PR #142's duplicate registry.
- Fully trusted operator authorization and native ownership adapters, verified LIVE per-app paid seat integration, and native app request/role isolation checks.
- Browser/PKCE/CSRF/SSO and eight-origin staging on synthetic users, including revocation and multi-org switches.
- Independent security review, preserving the existing six-app source QA lock.

Review order: PR #141 first, this stacked PR second, with PR #142's duplicated store reconciled separately. Issue #140 and umbrella #26 remain open.
