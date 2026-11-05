# Workspace native broker security rehearsal (draft, blocked by design)

This PR adds a **non-authorizing, broker-compatible** adapter and full local HTTP / PKCE negative tests on top of canonical identity PR #145. It does not modify the running `createAuthBroker` implementation or its production runtime configuration.

## Why the adapter intentionally denies all native access

The only native access evidence currently implemented in Workspace is `createWorkspaceNativeAccessInspector().inspect(...)`, which returns **candidateReady** but always `accessGranted:false`, `licensesGranted:false`, and `loginEnabled:false`. It is a read-only **preflight** result, NOT proof that a real native backend enforces a resource permission, an active subscription is paid via Stripe LIVE, or a native session is ready.

Turning `candidateReady:true` into an app session now would be a security escalation. This adapter therefore wraps the real parent's `getSession`, `authenticate`, `getParentSession`, and `logout` interfaces but returns **null for every `getAccess` call**, even if all current preflight checks pass. The real broker's existing `authorize` and `login` routes consequently return `403 access_denied`; no PKCE code or app proof is ever stored.

The adapter also offers a **private-only** `inspectCandidate(parent,appId)` diagnostic:
- Re-fetches the authoritative central session, obtains the Workspace organization ONLY from the session-locked central organization store, and chooses an explicitly configured permission per app.
- Evaluates the canonical org-scoped inspector, including selected tenant, live-seat ledger, current role/permission, native mapping verifier and revocation checks.
- Rechecks parent session + selected tenant after the awaited native verification.
- Rejects unknown apps, DataDuck, a missing session, missing locked organization, malformed inspection responses, forged authorization flags and native verifier errors.
- It does not look up `getAccess(userId,appId)` (legacy global grants), accept a browser-provided organization ID, or export a browser route.

## Actual local broker / PKCE tests

`tests/native-broker-deny-adapter.test.mjs` uses:
- the existing **real** Workspace `createAuthBroker` HTTP handlers and PKCE request flow;
- two disposable **real SQLite** databases for Workspace central identity + organization assignment;
- signed-LIVE-shaped **synthetic** subscription evidence, synthetic operator approval, and synthetic native ownership verifier;
- one central user in two organizations, separate native user + tenant IDs, and an old global app grant.

It asserts positive private preflight is still denied by browser login/authorize, no PKCE code or child proof writes occur, unbacked historical seats never qualify, tenant switching and native callback failures deny, old global grants cannot override the scoped mapping, and an intentionally forged `accessGranted:true` inspector does not grant access.

## Required next steps (NOT implemented)

A separate, security-reviewed opt-in **real grant authority** must reconcile the central org lock, current verified LIVE seats, native server-side ownership and actual native resource-level permission on every use; preserve PKCE, CSRF, replay protection, tenant binding, explicit revocation generation, logout and native app lifecycle. Only then can this deny-only integration be replaced with one that is capable of issuing credentials. It must be tested against eight genuine HTTPS origins and the native apps' real databases, with secure backup/restore and rollback.

The original six-app SSO broker remains unchanged and uses legacy grants when deployed in ordinary mode. This draft **is not wired to that mode**; do not deploy or merge it as an auth rollout. No DataDuck API or original app repositories were changed.

**Dependencies:** PR #141 canonical identity, #145 canonical inspected access, #144 snapshot tests, and source-lock/security review under issue #140 / umbrella #26.
