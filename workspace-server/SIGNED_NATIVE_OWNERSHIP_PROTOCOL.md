# Workspace ↔ native signed ownership proof (DRAFT, not connected to active login)

This draft provides a **separate private HTTPS trust boundary** for eventual native identity verification. It is a source-only module in Workspace; no native apps currently implement this proposed protocol. It neither imports nor modifies any app, and it does not alter the public page, deployed SSO broker, licensing, billing or browser endpoints.

## Why a signed native reply?

The canonical native mapping in Workspace draft #141 / #145 requires a real native backend to confirm the exact native account, native tenant and Workspace actor/tenant relationship. Trusting an app's email address, a client-chosen role or an unsigned JSON boolean would be insufficient.

The dormant `createSignedNativeOwnershipVerifier` has one **server-configured** native client for each of the existing six app IDs. **DataDuck is explicitly excluded** until separately released.

Each client requires an exact HTTPS URL, an outbound private bearer credential, a pinned Ed25519 native **public signing key**, and an exact `keyId`. The native server must guard its private verification endpoint and signing key and independently authenticate the Workspace request. Its reply proves ownership **only**, not license, role, scientific project access, or SSO login permission. Redirects, credential-bearing URLs, arbitrary query strings, non-HTTPS schemes and unregistered apps are rejected.

## Wire protocol v1 (proposal; native endpoint not implemented)

Workspace privately POSTs the following UTF-8 JSON to the per-app configured endpoint:

```json
{
  "version": "duckbio.native-ownership.v1",
  "purpose": "inspect",
  "nonce": "<fresh 32-byte base64url challenge>",
  "appId": "goflo",
  "workspaceAccountId": "<central-account-id>",
  "workspaceOrganizationId": "<session-selected-central-tenant-id>",
  "nativeUserId": "<exact stored native user id>",
  "nativeOrganizationId": "<exact stored native tenant id>"
}
```

Only `inspect`, `bind` and `migrate` are valid proof purposes. No origin or redirect comes from this JSON; URL, bearer and public key are fixed in private Workspace configuration. The native service must independently verify the exact central-to-native ownership before claiming `active:true` and `ownershipVerified:true`. The backend must **not** grant native privileges merely by knowing the bearer.

The native reply is `application/json` (HTTP 200), at most 8192 bytes:

```json
{
  "payload": {
    "version": "duckbio.native-ownership.v1",
    "keyId": "native-key-v1",
    "purpose": "inspect",
    "nonce": "<identical fresh challenge>",
    "appId": "goflo",
    "workspaceAccountId": "<exact central-account-id>",
    "workspaceOrganizationId": "<exact selected central-tenant-id>",
    "nativeUserId": "<exact native user id>",
    "nativeOrganizationId": "<exact native tenant id>",
    "issuedAt": 1800000000000,
    "expiresAt": 1800000015000,
    "active": true,
    "ownershipVerified": true
  },
  "signature": "<Ed25519 signature as canonical base64url>"
}
```

**Signature byte format:** Ed25519 over UTF-8 `JSON.stringify` of an ordered array:

```javascript
[
  proof.version, proof.keyId, proof.purpose, proof.nonce,
  proof.appId, proof.workspaceAccountId, proof.workspaceOrganizationId,
  proof.nativeUserId, proof.nativeOrganizationId,
  proof.issuedAt, proof.expiresAt, proof.active, proof.ownershipVerified
]
```

Both ends must follow exactly this order and the same JSON number and string encodings. Do not sign an unordered JSON object. Nonce is random for every request, response must repeat the challenge, proof must be short-lived (maximum 30 seconds with a small time skew allowance), active, explicit and signed by the configured app's pinned Ed25519 key. Missing or extra fields, malformed signatures, unknown key IDs, invalid native status or native backend failures all fail closed. A reply cannot be reused for a later challenge, even for the same IDs.

## Private API integration boundaries

- For canonical inspector draft #145: inject `verifier.verifyNativeMapping` only after secure native backend endpoint/key provisioning. It returns strictly boolean and never an SSO grant.
- For canonical identity migration draft #141: inject `verifier.verifyNativeOwnership` as the **independent native proof callback**. The **separate** private `orgNativeLinks.authorizeMutation` callback must still verify the actor's current organization admin authority, account membership/assignments and any organization policy. This verifier does **not** check central operator authority.
- No active runtime imports this module. There is no new server route, native endpoint implementation, Stripe connection, paywall, seat mutation, customer migration, credential generation or DNS change.
- Native applications must still enforce their current **native user status, native role, tenant, project/dataset/resource authorizations** on every request. The Workspace inspector separately checks an active central session, exact selected tenant, effective role/permission and independently verified current paid LIVE seat, and must repeat all checks after awaiting a native proof.
- Real activation additionally needs secure key provisioning and rotation, native endpoint implementation and certificate/TLS testing, request limits, service authentication (mTLS or another vetted equivalent), authenticated caller/tenant binding, alerting without secret logging, independent test of native account ownership, an agreed outage policy, a complete backup/restore plan, and cross-origin HTTPS E2E testing.

## Offline checks

`workspace-server/tests/signed-native-ownership-verifier.test.mjs` generates synthetic ephemeral Ed25519 keys and intercepts a fake fetch transport. It checks valid proof binding, per-purpose domain separation, replay protection, tampered signatures, mismatched tenant IDs, inactive users, expired/future proofs, oversized/non-JSON/redirect responses, insecure configuration and browser-injected role claims.

Additional `signed-native-ownership-cross-store.test.mjs` integration tests use the same signed proof contract with **real disposable Workspace identity and organization SQLite databases**. They verify an explicit signed `bind` without activating a legacy broker grant, a valid signed `inspect` producing **only** a non-authorizing candidate, signed but wrong native identity/tenant, central session/permission revocation (including while a valid signature is being produced), and DataDuck/unassigned-app denial. All trust and billing callbacks in these tests are synthetic.

The module and its test are **not** proof of real native ownership. Keep the PR draft/unmerged and coordinate across the existing six app stream before introducing any native verification route.
