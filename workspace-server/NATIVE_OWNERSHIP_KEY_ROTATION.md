# Workspace/native Ed25519 signing-key rotation contract (DRAFT)

**Scope:** This is an opt-in server-only improvement to the private signed-native ownership verifier from draft #150, stacked on localhost real-HTTPS QA draft #162. It does not modify any of the original six native-app repositories, enable real endpoints, change the active broker/SSO, grant licenses or release DataDuck.

## Why two temporarily valid keys?

A native app must sometimes rotate its proof-signing private key. For a short, explicitly approved transition Workspace needs to recognize the retiring **and** replacement public keys for that **one** app. Otherwise deploying the replacement on the native server can interrupt valid identity verification, or keeping the retired key trusted forever increases exposure after compromise.

No keys are automatically fetched from a native response, URL, browser request, JWKS endpoint, or DNS. All trusted public material and its validity periods must be privately pinned by the Workspace server operator.

## Backward-compatible configuration

Old single-key configurations still work unchanged:

```javascript
{
  goflo: {
    endpoint: 'https://native.example.test/private/ownership',
    token: privateAppBearer,
    keyId: 'native-key-v1',
    publicKeyPem: pinnedOldEd25519PublicKey
  }
}
```

For a planned replacement, use **only** the new `signingKeys` array, with 1–3 keys per app and a separate, nonempty `keyId`. Validity periods are **Unix epoch milliseconds** (`notBefore` inclusive, `notAfter` exclusive):

```javascript
{
  goflo: {
    endpoint: 'https://native.example.test/private/ownership',
    token: privateAppBearer,
    signingKeys: [
      {
        keyId: 'native-key-v1',
        publicKeyPem: pinnedOldEd25519PublicKey,
        notBefore: oldActivationMs,
        notAfter: retirementMs
      },
      {
        keyId: 'native-key-v2',
        publicKeyPem: pinnedNewEd25519PublicKey,
        notBefore: overlapStartMs,
        notAfter: nextRetirementMs
      }
    ]
  }
}
```

These are **illustrative field names, not valid production secrets or a deployable config**. The legacy `keyId`/`publicKeyPem` fields and `signingKeys` cannot be mixed. An absent, malformed, duplicate, out-of-order or unsupported signing-key configuration rejects at startup; overlapping time windows are permitted. The verifier rejects unknown `keyId`, wrong native app or different signing material, and never honors an algorithm claim from the response.

## Strict verification requirements

- A native reply must continue to carry the **exact v1 Ed25519** canonical signed array and fresh per-request random nonce. A key rotation **does not change the protocol version, signature bytes, purpose or tenant-binding rules**.
- Workspace selects the pinned public key **only** by the exact configured app ID + exact signed `keyId`.
- The selected key must be valid when the Workspace request begins **and** when verification completes; `issuedAt` must be within the configured key window and `expiresAt` must not exceed its retirement time. A signing key expiring during the network response fails closed.
- When **all** configured keys are inactive, Workspace makes **zero** native requests and returns false. A native app signing with a retired key during overlap fails even if another key is valid.
- A signing key is unique to one `keyId` for the app. Separate native apps must manage independent private keys and credentials; their server-side authorization/tenant checks remain independent.
- The existing legacy single key continues to be accepted under its original configuration. **Production operators must explicitly migrate legacy configs to time-bounded `signingKeys` before they can enforce automatic retirement.**

## Recommended staging rollout

1. Generate a fresh Ed25519 pair on the native-app server. Never put the private key, bearer token, or filesystem secret path into GitHub, client-side bundles, logs, Workspace audit reports, or publicly downloadable handoff files.
2. Approve and pin both old and new public keys in **private Workspace server config**. Set a short overlap, an explicit old-key retirement deadline, and a longer, controlled new-key deadline. Ensure NTP/clock monitoring on both services.
3. Rehearse valid native `inspect` and `bind` for the old and new `keyId` through a real TLS-secured private endpoint, then confirm that a reply signed with the old key is refused **at and after** its retirement time, including in-flight requests.
4. Switch the native server to signing with the new key. Keep app-independent organization account checks, native user status, membership/permissions and native resource access enforcement; no Workspace proof alone authorizes a native request.
5. After confirmation, remove old pin from Workspace config, remove the old private key from the app server and verify its destruction via the native operations process. If compromise is suspected, **immediately revoke** the old public pin rather than waiting for the planned overlap.
6. Fail closed if key material, trusted clock, current paid app seat, native response or server TLS identity cannot be validated. Do not silently fall back to historical global mappings or legacy SSO rights.

## Offline synthetic evidence and remaining blockers

`tests/native-ownership-signer-key-rotation.test.mjs` runs source-only tests for **all six** native app IDs using 12 ephemeral signing keys and a fake native transport; it checks old+new overlap, exact retirement boundary, no-current-key zero network calls, expiry during in-flight response, signed response extending beyond key expiry, cross-app key misuse, malformed/duplicated schedules, and legacy compatibility.

`tests/native-ownership-real-https.test.mjs` from #162 independently exercises the same verifier over a real localhost TLS chain (still synthetic signing keys). Neither test establishes native-app implementation, native ownership correctness or production key storage. Remaining blockers: a real authenticated HTTPS signed ownership endpoint in **each** native app; independent native resource ACL; revocation enforcement; real LIVE Stripe subscription evidence; production key/secret lifecycle; cross-store recovery; and approved eight-origin staging E2E.

Keep this PR **draft/unmerged/undeployed** until the original native app and Workspace workstreams coordinate a reviewed, single authoritative rollout. No DataDuck integration is enabled.
