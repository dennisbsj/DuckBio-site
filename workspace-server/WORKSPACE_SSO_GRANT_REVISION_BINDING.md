# Workspace SSO: revision-bound authorization code and proof (draft)

This branch is a **dormant preparation**, stacked on draft #149 → #145 → #141. It does **not** activate organization-native SSO, change any app repository, enable DataDuck, or grant access. The #149 canonical native broker deny adapter still **always returns null** from `getAccess`.

## Why

An app user's `localIdentity` can stay the same even when an app grant is revoked and re-created (ABA), an organization is switched, or a native identity link is re-bound. The existing broker re-checked the current `localIdentity` at code exchange and each introspection. That check alone cannot distinguish different generations with identical user and native organization IDs.

## New **trusted adapter** contract

- Existing legacy `identity.getAccess(parent, appId)` may return `{localIdentity}` with **no** `bindingRevision`. Its current behavior remains compatible.
- A **future reviewed server-side** tenant-authorized adapter may also return `bindingRevision: string`, with a nonempty 1–128 character value matching `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`.
- The revision must identify the **full, exact authority generation**: Workspace organization ID, app ID, the canonical native mapping's monotonic `linkRevision`, and any other current authorization epoch whose revocation must invalidate existing proofs. **Do not** reuse revision values after revoke/rebind. A static native user ID or native tenant ID is insufficient. Never take the revision from the browser.
- `checkAccess` denies malformed/empty/explicit undefined binding. A revision is a **privately generated binding value**, not a portable claim, proof of seat payment, or permission by itself.
- Login/authorize stores it with the short-lived PKCE code. Exchange consumes the code and rejects a different binding, **even when the local identity is identical**. This fails closed if the adapter switches from legacy to strict mode, or vice versa.
- Exchanged session proofs store the binding privately and recheck it on every broker introspection and native-backend session authentication. A revision change invalidates active proofs. Existing legacy proofs remain valid in legacy mode but fail closed when a strict adapter replaces their authority.
- The binding value is **not** returned in the browser response, introspection assertion or native assertion. Logout of a withdrawn grant still works.

## Explicit safety limits

**Do not connect this to the canonical preflight candidate.** PR #145 returns read-only `candidateReady`, explicitly `accessGranted:false`. PR #149's adapter must continue to deny app logins until the security team approves an actual authoritative native verifier, verified-live per-app paid seats, native per-request enforcement, organization-aware application identities, session cutover/recovery, and isolated HTTPS staging for all seven origins.

The new tests use synthetic trusted adapters, a loopback HTTP broker and memory store. They prove revocation-generation behavior in the broker but **do not** prove live tenant membership, native ownership, billing trust, durable production state, end-to-end TLS or cross-service recovery.

## Test scope

Run from `workspace-server/`:

```sh
npm run check
node --test tests/shared-auth-broker.test.mjs tests/shared-auth-broker-binding-revision.test.mjs tests/native-broker-deny-adapter.test.mjs
npm test
```

Security assertions: unchanged legacy session behavior; code rejection after strict revision change; same-user/native-tenant revoke/rebind proof invalidation; organization change; strict/legacy transition; invalid revisions; backend proof validation; and logout after revocation. All stacked PRs remain draft, unmerged and undeployed.
