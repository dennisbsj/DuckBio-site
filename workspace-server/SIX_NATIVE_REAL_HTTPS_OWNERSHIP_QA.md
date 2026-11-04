# Six native ownership services – genuine loopback HTTPS QA

**2026-11-04: Offline and opt-in. This does NOT mount an actual native app route or activate SSO.** This PR is stacked on the combined, unmerged Workspace integration [#178](https://github.com/dennisbsj/DuckBio-site/pull/178). All earlier release blockers remain.

## New integration path

The old native interoperability checks used an in-process HTTP substitute. `six-native-real-https-rehearsal.mjs` now runs **six simultaneous, distinct localhost HTTPS listeners** on ephemeral ports, with real TLS certificate validation and a different temporary native Ed25519 signing key and bearer credential for each service.

Each isolated server calls `signer.prove(input)`, which must call `lookupOwnership(input)` against the same disposable test-only native storage used by the offline six-app lookup rehearsal. For five apps this is a genuine temporary SQLite database; DuckNote has a strict in-process PostgreSQL query simulator (a **real PostgreSQL server is not used**). The central Workspace `createSignedNativeOwnershipVerifier` calls these six localhost services through a Node HTTPS request using the ephemeral server certificate as its **explicit pinned CA**. Neither endpoint discovery nor public DNS nor untrusted URL redirects are enabled.

For all six apps, test:

- Positive `inspect`, `bind` and `migrate` signed v1 proofs with correct native and Workspace account/organization tuples.
- Wrong Workspace account/organization or native user/tenant; native mapping revoked, expired, missing native account or duplicate active mapping. Once a synthetic row is restored, valid ownership is accepted again.
- Altered signed payload, replayed signed nonce across distinct requests, redirection, non-JSON and oversized replies, and response timeout.
- Wrong private bearer authentication and an untrusted TLS self-signed certificate, rejected independently of Ed25519 verification.

The test exposes **no app grant, seat or login**; positive ownership remains a private observation only. The actual Workspace broker's deny-only PKCE integration is separately exercised in #178. It is essential that a good TLS/ownership result **not** be interpreted as a paid seat or native scientific-record permission.

## Running CI versus running six genuine native source modules

**Public CI:** uses synthetic signer and lookup factories as input to this real TLS test environment, because the six private native repositories are inaccessible to the public DuckBio-site workflow. The servers and HTTPS/TLS are real; the private native implementation is *not* being executed by CI.

**Optional operator-only genuine-source rehearsal:** first prepare all six exact pinned, clean private Git repositories listed in `SIX_REAL_NATIVE_SIGNER_OFFLINE_INTEROP.md`. Their HEADs, remotes, unmodified Git blobs, symlinks and all six native signer/lookup modules are checked **before dynamic import and rechecked after the test**. Nothing is cloned, downloaded, deployed or mounted automatically.

```sh
cd workspace-server
node six-native-ownership-lookup-interoperability.mjs \
  --sources-root /srv/duckbio-private/offline-reviewed-six \
  --confirm-offline-six-native-real-https-only
```

This operator command uses **actual six private native lookup and signer source modules** as independent factory implementations, but invokes them only on isolated synthetic temporary databases, keys and 127.0.0.1 HTTPS listeners. Run it only in a non-production test host without customer data. It neither installs nor contacts real native app servers. Failure to find all six exact checkouts is a hard failure.

Test commands:

```sh
cd workspace-server
node --test tests/six-native-ownership-lookup-interoperability.test.mjs
npm run check
npm test
```

## Remaining operator release gates

The actual native modules are still dormant. Live per-app authenticated private HTTPS endpoints, independent operator-provisioned native ownership records, a genuine DuckNote PostgreSQL database, seven running non-stub app services, trusted native resource authorization, LIVE Stripe billing/seat evidence, rollback-safe session epochs and full staging revocation tests **remain outstanding**. The pre-existing detached session, snapshot and financial-review PR stacks must be reviewed before any production rollout. Do not merge, deploy or enable native SSO from these tests.

This rehearsal outputs fixed app IDs, outcomes and failure codes only, never identities, tokens, keys, private local paths or response bodies. Every result reports `deploymentAuthorized:false`. DataDuck is excluded from the six original native services.
