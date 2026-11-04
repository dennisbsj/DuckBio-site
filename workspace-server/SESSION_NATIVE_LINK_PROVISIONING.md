# Session-bound Workspace native identity provisioning — private draft

**Not wired into any HTTP endpoint, production broker, native app, seat purchase or customer migration.** This is the remaining operator-authentication seam for the canonical six-app identity mapping in draft PR #141 and signed native proof contract in draft PR #150. It stacks on #150, which stacks on #145. DataDuck is excluded.

## Security gap addressed

The canonical identity store accepts a private `orgNativeLinks.authorizeMutation` callback, but its callback tuple only contains `actorId`, not the actual authenticated parent **session**. A naïve adapter that simply trusts the caller's `actorId` risks mapping or migrating a native account on behalf of a user who is not currently logged in, or whose organization selection, membership, or paid app assignment has changed.

The new **unmounted** `createWorkspaceNativeLinkProvisioner` adds a private, per-request session-bound controller. No actor ID is accepted in a request; it is derived from `identityStore.getParentSession(sessionId)`. Every operation is tied to the existing central parent session, its exact **session-selected and active Workspace organization**, and an **active organization administrator**. Cross-tenant or reused session IDs fail closed.

For **bind** or **legacy migration**, the controller additionally requires:
- The target central account is active.
- The target has an active app-specific assignment and the current `workspace.view` effective permission.
- The exact application has adequate current **verified-live-shaped** subscription seats from `verifiedNativePermissionCandidate`; historical receipts, self-asserted booleans, unverified Stripe test allocations or an expiring paid term do not qualify.
- An independent native backend proof (draft #150, **synthetic signing only in tests**) confirms the current native user, native tenant, central user, central tenant, and request purpose.
- The operator session, admin right, target membership/role and paid seat are checked **again after** the native network await. The canonical identity store also rechecks authority and legacy mapping before it commits.

For **revoke**, a currently active administrator of the selected organization can remove a stale mapping even when the target user is suspended or the paid subscription expired. Otherwise, an organization could become unable to clean up a dangerous native link.

## No shared mutable authorization state

The underlying identity store needs trusted callbacks for both authorizing a mutation and native proof verification. This controller uses Node.js `AsyncLocalStorage` to scope those callbacks to **one exact authenticated operator request**. Raw identity-store calls without an authenticated operation context fail closed. Concurrent administrators on different organizations are isolated: neither can borrow the other's session, native tuple or proof.

Private binding setup is intentionally two-stage:

```js
let identityStore;
const controller=createWorkspaceNativeLinkProvisioner({
  getIdentityStore:()=>identityStore,
  organizationStore,
  verifyNativeOwnership:signedNativeVerifier.verifyNativeOwnership,
  clock:Date.now
});
identityStore=createIdentityStore({
  databasePath:PRIVATE_SQLITE_PATH,
  orgNativeLinks:controller.adapters
});
```

A trusted server-side operator flow can then invoke `controller.bind({sessionId,userId,appId,workspaceOrganizationId,nativeUserId,nativeOrganizationId})`, `controller.migrate({sessionId,userId,appId,workspaceOrganizationId,nativeOrganizationId})` or `controller.revoke({sessionId,userId,appId,workspaceOrganizationId})`. The exact actor is always derived from the parent session, **never the body**. These methods do not return an SSO grant or activate a license. Their results retain `accessGranted:false`, `licensesGranted:false`, `loginEnabled:false` when a link is returned.

## Limits and release blockers

This is a **source-only private contract**, not production provisioning:
- There is no HTTP route, UI, service-to-service native endpoint, real Stripe provider verification or native app role mapping.
- The signed native proof in isolated tests uses ephemeral test keys and an intercepted fetch; the six native app teams need to independently implement and audit the real proof protocol.
- Future browser administration endpoints must independently enforce authentication, Origin/CSRF, request and payload validation, operation audit, rate limits and administrative change policy.
- Cross-database transactional atomicity, paid-seat revocation after a commit, full native DB backup, exactly-once native confirmation and live multi-origin E2E are not provided.
- Revoke is scoped to a current administrator but does not require that the target still has a paid seat; all revocations are recorded in the existing canonical private audit table.
- Do **not** use the separate identity registry in draft PR #142 as an additional authority. Resolve the canonical storage integration first, then review the full broker transition and rollback. Keep the active six-app broker unchanged.

## Verification

`tests/session-native-link-provisioning.test.mjs` exercises disposable **real identity and organization SQLite databases** plus a fake HTTPS transport that returns signed Ed25519 native proofs. It tests session-bound admin bind, direct adapter bypass refusal, non-admin and wrong organization, historical seats, logout and permission changes mid-flight, signed native denial, verified legacy migration, safe revoke after paid expiry, and concurrent operators in separate tenants.

No real user, native application, purchase, tenant or live production session is used.
