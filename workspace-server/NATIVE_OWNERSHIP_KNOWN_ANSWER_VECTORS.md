# Six independent Ed25519 native ownership known-answer vectors (offline QA only)

The source-only Workspace verifier and native signers ordinarily generate both
signatures and expected proofs dynamically inside a test. If two implementations
share a broken serializer, their roundtrip tests may both pass. This source
fixture fixes **external, independently signed cryptographic answers** to catch
wire-format drift without requiring deployed native apps or test private keys.

- Fixture: `tests/fixtures/native-ownership-v1-known-answer.json`
- Test: `tests/native-ownership-known-answer-vectors.test.mjs`
- Protocol: `SIGNED_NATIVE_OWNERSHIP_PROTOCOL.md`
- Six distinct synthetic applications and **six distinct Ed25519 public keys**:
  `limsman` (LabDuck), `eel` (DuckNote), `methpipe` (DuckPipe),
  `mantrain` (DuckTrain), `duckman` (DuckMan), `goflo` (CytoDuck).
- Two fixed examples of each proof purpose: `inspect`, `bind`, `migrate`.
  These examples **do not grant app permissions, accounts, roles or licenses**.
- Generation: the public fixture was created by Python's `cryptography`
  Ed25519 implementation and canonical JSON encoding. The **six transient
  test-only signing private keys were not committed or stored**; the repository
  contains only SPKI public keys, static signed answers and expected UTF-8.
- The test independently checks six positive signatures, all 30 cross-app
  wrong-key combinations, all 78 single-field signed-message changes,
  JSON object-property reordering and the explicit canonical byte strings.

## Independent native-language check

For **each** `vectors[]` entry:

1. Read `proof`. Preserve field values and types: timestamp fields are integer
   epoch milliseconds; `active` and `ownershipVerified` are JSON booleans.
2. Serialize exactly this ordered array using compact JSON (no whitespace):

   ```text
   [version, keyId, purpose, nonce, appId, workspaceAccountId,
    workspaceOrganizationId, nativeUserId, nativeOrganizationId,
    issuedAt, expiresAt, active, ownershipVerified]
   ```

3. Convert the result to UTF-8 and compare byte-for-byte with the literal
   `canonicalUtf8` value; do not sign the object serialization or alphabetize
   fields. The v1 format follows ECMAScript `JSON.stringify` for array values.
4. Decode the fixture's unpadded `signatureBase64url` as **64 bytes** and verify
   Ed25519 over those UTF-8 bytes using
   `publicKeys[proof.appId]` (PEM/SPKI); all six must verify.
5. Verify with **every other app's fixture public key** instead; all 30
   cross-app checks must fail. A second app cannot inherit another app's signer.
6. Change any of the 13 tuple values without re-signing: each static signature
   must fail. Reordering the original **JSON object**'s properties must *not*
   affect the ordered-array canonical bytes or signature.

The fixed nonce bytes are intentionally predictable, and the timestamps are
deliberately old/preset: these are cryptographic known-answer examples, **not
fresh proof requests**. Production Workspace must generate an unpredictable
32-byte challenge each time; enforce exact nonce matching, strict proof TTL,
independently pinned per-app current signing keys, private mTLS + bearer, an
independent authoritative native ownership lookup, current central session,
permissions, paid LIVE app seat and per-resource native authorization.

**Never install any fixture public key as a native production pin.** Public
fixture keys cannot serve as evidence of native identity or ownership. Never
reuse a known nonce, public key, certificate or synthetic account ID to create
an actual native identity link. DataDuck remains outside this six-app contract.


## Operator-only check against the SIX actual native signer modules

The new source-only `six-native-known-answer-audit.mjs` independently
loads the **actual native implementations** only when the operator explicitly
requests it, and only after the existing six-repository
`verifySixNativeMtlSidecarSources` gate has verified the approved local
private root, exact reviewed Git commit HEADs, expected remotes, clean worktrees,
no path symlinks, and the tracked signer, lookup and mTLS sidecar source blobs.
It rechecks all of those source gates **after** the test. It never copies private
source into DuckBio-site, clones repos, reads real native user data, imports
the app runtime, opens HTTP servers or uses production secrets.

The genuine native exports are
`canonicalNativeOwnershipProofBytes` (all six apps, five CJS + one ESM)
and the already reviewed private `create*NativeOwnershipSigner` factories.
The tester does **not** rely on the Workspaces canonicalization helper when
checking their generated signatures: each native encoder is compared against
**all six** frozen expected canonical strings (36 cross-app byte checks).
Each native signer receives an independent throwaway Ed25519 key, the exact
fixed fixture request fields, immutable fixture time and key ID, plus a
strict synthetic lookup. Its returned payload must be the expected frozen
proof, and its signature must **equal** Node Ed25519 signing over the
precomputed `canonicalUtf8` bytes. Wrong tenant and wrong app requests deny.

```sh
cd workspace-server
node six-native-known-answer-audit.mjs \
  --sources-root /srv/duckbio-private/offline-reviewed-six \
  --confirm-private-six-native-known-answer-only
```

The private source checkouts have to be **already present** and match the
exact SHAs in `SIX_NATIVE_SIGNER_CHECKOUTS`; the QA tool never auto-updates
reviewed source pins. Checkouts on newer unreviewed `main` commits will
intentionally be denied until separately reviewed and repinned. No genuine
private source executes in public GitHub Actions.

In contrast, `tests/six-native-known-answer-audit.test.mjs` injects
**synthetic** native exports to test the harness, fail-closed source refusal,
mutated signature bytes, malformed signers, missing/extra app mappings,
wrong native ownership and lack of an opt-in flag. Green public CI means the
QA mechanism works with those test doubles; it is **not evidence the
operator-only genuine six-native module run was performed**.

This check does not validate real native PostgreSQL, Stripe LIVE licenses,
actual service certificates, genuine native ownership data, native resource
ACLs or active Workspace SSO. Positive reports retain
`deploymentAuthorized:false`, `loginEnabled:false`,
`licensesGranted:false` and `accessGranted:false`.

## Verification and release boundary

```sh
cd workspace-server
node --test tests/native-ownership-known-answer-vectors.test.mjs tests/six-native-known-answer-audit.test.mjs
npm test
```

Public CI only runs offline, synthetic source-contract QA. The separate
operator CLI can run genuine pinned native signers but is not invoked by CI.
Neither mode accesses real PostgreSQL, real Stripe, deployed mTLS services or
the active SSO broker. They change no native repository and cannot create
license/access/login grants. Maintain this as a **draft, unmerged and
undeployed** stacked on the reviewed six-app mTLS rehearsal; require native
owner validation and the entire #140 / #26 release matrix before any activation.
