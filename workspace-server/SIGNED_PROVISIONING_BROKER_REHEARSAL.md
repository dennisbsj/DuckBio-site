# Native signed provisioning + Workspace PKCE broker: end-to-end negative rehearsal

**Development-only source milestone. No production login, app access, real checkout or external native endpoint.**

## Branch integration

This branch is stacked on the **session-bound organization-admin provisioning PR #152**, which itself depends on signed Ed25519 native attestation PR #150, canonical native mapping/preflight PR #145 and private identity migration PR #141.

It carries over the **broker-compatible deny adapter and seven synthetic HTTP tests** from sibling draft PR #149, without editing that branch. This is an intentional temporary integration branch: do **not** merge PR #149 and this branch independently as separate implementations of the same adapter. Review/land only one authoritative copy after security review.

## Added integration proof

`tests/signed-provisioning-broker-safety.test.mjs` uses:

1. Two real temporary SQLite databases (central identity, organization role/verified-LIVE-shaped seat ledger).
2. A genuine, authenticated current Workspace operator session and active organization admin, whose identity is derived by the private session-bound provisioner.
3. Fresh, ephemeral Ed25519 signing keys and a synthetic HTTPS-native fetch adapter, with exact app/user/org/nonces, `bind` vs `inspect` purposes and active-native flags checked by the signed verifier.
4. The canonical organization-scoped identity link and dormant read-only native inspector.
5. The actual existing Workspace `createAuthBroker` running over local loopback HTTP, including browser session+CSRF, PKCE authorize/login, native-client introspection, and counted code/proof writes.

The successful signed link and native verification still return **only an inspection candidate**. The broker-compatible adapter **always returns null for app getAccess**, so a positive candidate cannot produce a login, PKCE code or native child proof.

Security test cases: successful Ed25519 verified bind but denied browser PKCE, signed wrong tenant/nonce/inactive native account refusal, signature-bound inspection failure after successful bind, session-authorized admin revoke with no legacy grant fallback, and permission edit during awaited signed inspection. The sibling #149 suite tests non-signed broker-side deny behavior, tenant changes, expired/historical seats and forged authorizing flags.

## Explicit gaps before staging or live activation

- The "live" Stripe subscription is a synthetic, test-only entry accepted by an injected fake verifier, **not a confirmed real payment**.
- The native endpoint and keys are synthetic, in-memory, test-only and do not contact actual native app servers. The six apps must implement, review and authenticate the exact native signing contract.
- The broker is unchanged and continues to use the **old global-grant model when deployed normally**. The new adapter is not imported by the runtime or mounted as a route.
- The inspector does not grant seats, native resource permissions or child tokens; it is not a native authorization enforcement engine.
- Real session-bound entitlement issuance, per-request native resource authorization, secure coordinated backup/rollback, browser CSRF/MFA hardening, verified Stripe LIVE, encrypted deployment credentials and **eight HTTPS origins** remain release blockers.

Keep this PR **draft, unmerged and undeployed**. Preserve the ownership split: original six app repository edits in the native-integration chat, DataDuck backend in its own chat. See issue #140 and umbrella #26.
