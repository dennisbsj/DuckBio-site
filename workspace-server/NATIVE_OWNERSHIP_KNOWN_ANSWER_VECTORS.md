# Public v1 Ed25519 native ownership known-answer vectors (offline QA only)

The source-only Workspace verifier and the six native signers normally generate
signed proofs during each test. If both implementations share an incorrect
serializer, such mutually generated test signatures can still validate. This
fixture pins **independently generated, fixed Ed25519 answers** to detect a
silent wire-format regression, and allows native owners to compare their own
byte encoding with Workspace without using a running service.

- Fixture: `tests/fixtures/native-ownership-v1-known-answer.json`
- Test: `tests/native-ownership-known-answer-vectors.test.mjs`
- Protocol: `SIGNED_NATIVE_OWNERSHIP_PROTOCOL.md`
- Scope: three synthetic messages: `inspect` / GoFlo, `bind` /
  DuckNote, `migrate` / DuckMan. These are **not** privileged app grants.
- All fixture fields, signatures and canonical strings are static. A temporary
  Ed25519 key was generated **outside the repo** and the signing private key
  discarded. Only its public key and signatures are committed.

## Independent native-language check

1. Load one `vectors[].proof` without changing types: timestamps are integer
   epoch milliseconds, booleans are JSON booleans and identifiers are strings.
2. Serialize **this exact ordered array**, with compact JSON (no spaces):

   ```text
   [version, keyId, purpose, nonce, appId, workspaceAccountId,
    workspaceOrganizationId, nativeUserId, nativeOrganizationId,
    issuedAt, expiresAt, active, ownershipVerified]
   ```

3. Encode to UTF-8. Compare **exactly** against `canonicalUtf8` in the
   fixture, including punctuation, escaping and number representation.
4. Decode `signatureBase64url` as unpadded base64url (64 signature bytes).
   Verify Ed25519 over the **canonical UTF-8 bytes**, with the fixture
   `publicKeyPem` (SPKI) public key. It must verify for every fixture.
5. Change any one signed field and repeat: the static signature MUST fail.
   Reorder fields in the **original JSON object**: the canonical array and
   signature MUST remain unchanged.
6. Do not sign an object serialization; JSON object keys are not part of the
   specified canonical signing representation. The test explicitly denies it.

The fixture's nonce is deliberately predictable and its proof timestamps are
fixed. **Neither is suitable for a real challenge.** Production Workspace must
generate a new unpredictable 32-byte nonce for each request, match it exactly,
and apply real proof TTL, pinned per-app signer and rotation windows, a
private authenticated HTTPS connection, native account/tenant validation and
all separate central role, session and verified-live billing gates.

**Never configure the fixture public key as an actual app pin.** The fixture
uses one synthetic public key for three *isolated* protocol examples; actual
multi-app configuration rejects shared signing key material across apps.
Never reuse the known challenge or create a live identity mapping from it.

## Validation and release boundary

Run `cd workspace-server && node --test tests/native-ownership-known-answer-vectors.test.mjs`.
The regular `npm test` command also discovers the test.

This is offline source-contract QA only. It does not run the genuine native
servers, attest real native ownership, enable the inactive broker or provide
valid production SSO, paid seats, scientific record access, or DataDuck
integration. It changes no existing native repository or active routes.
Keep this draft stacked on the current six-app mTLS rehearsal; require native
owner review and the documented full release gates before merge/deployment.
