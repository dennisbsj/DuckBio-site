# Six genuine private native mTLS sidecars → Workspace Ed25519 verifier

**4 November 2026 – opt-in offline QA; draft, NOT DEPLOYED.** The six original native repositories each added a dormant `server/workspace-native-ownership-https.*` sidecar in their latest `main` commit. The previous signer and ownership-lookup source modules were unchanged in those six one-commit advances. See `SIX_REAL_NATIVE_SIGNER_OFFLINE_INTEROP.md` for exact reviewed new SHAs.

Each sidecar is an **explicitly constructed** server that is **not imported or mounted in the native application server**. It requires a real loopback-only TLS listener, TLS 1.3, an authorized client TLS certificate whose SHA-256 fingerprint matches the private operator pin, an exact `Host` + SNI hostname, a separate per-app secret bearer, an exact signed ownership request, request limits, nonce replay reservation and a signer whose native lookup independently verifies the exact central/native account and tenant. Signed ownership is *not* a seat, license, native ACL or SSO token.

## What this PR adds to Workspace

`six-native-mtls-sidecar-rehearsal.mjs` accepts six sidecar factory exports, six signer factories, and the six read-only ownership lookup callbacks from the **same disposable datastore fixture**.

It generates one ephemeral self-signed server certificate with six local test-domain Subject Alternative Names and an independently generated client authentication certificate. It runs six independent HTTPS servers on ephemeral **127.0.0.1-only ports**, with a separate Ed25519 signer and private bearer for each app. The central `createSignedNativeOwnershipVerifier` calls them via a Node real-TLS transport that pins the server certificate, supplies the Workspace client certificate, forces a closed-world DNS mapping to `127.0.0.1` (no public DNS), and does not permit redirects, HTTP downgrade or insecure TLS verification.

Per-app tests verify signed `inspect`, `bind` and `migrate`, wrong central/native user or org, revocation, expiry, deleted native account, conflicting active native link, incorrect bearer, absent client certificate, untrusted server certificate and a duplicated nonce rejected by the native sidecar **before** a second signed reply is returned. No native application is started; this is a synthetic source-level mTLS exercise.

## Running tests versus six actual private native modules

The GitHub public CI test creates **six synthetic mTLS sidecar factories**, synthetic native signers, five genuine temporary SQLite account/mapping databases and a strict in-process DuckNote PostgreSQL query simulator. Although the sockets, TLS handshake, X.509 verification and Ed25519 signatures are real, **the six private native sidecar implementations are NOT loaded in public CI**. Its green status does not certify a real app server or PostgreSQL database.

The opt-in operator path is stronger: it refuses operation unless all six private native repositories are already available as clean, non-symlinked Git checkouts at the exact source-review SHAs, from the approved remotes. It verifies each native signer, lookup *and new sidecar* file is the exact Git-tracked blob before import and again after the test. Then it dynamically imports the **actual** native sidecar + signer + lookup module exports into the same **temporary synthetic** datastore and real mTLS loopback test. No private code is copied into the public Workspace repo.

```sh
cd workspace-server
node six-native-ownership-lookup-interoperability.mjs \
  --sources-root /srv/duckbio-private/offline-reviewed-six \
  --confirm-offline-six-native-mtls-only
```

This command requires a private non-production test host with Node.js 22+ and OpenSSL. It does not download the six private repositories, manage their production credentials or touch any real native users. If a native checkout is unavailable, dirty, a symlink or at the wrong commit, **the test is blocked**, not marked successful. Only fixed six app IDs and safe result codes are printed. Every return reports `deploymentAuthorized:false`.

## Important unfulfilled release gates

1. **Native teams:** review and separately mount each sidecar as its own private, authenticated system service, with real independent operator-provisioned central→native user/organization mappings, native database permissions and lifecycle controls; do not mount the sidecars on the public app server. Confirm actual mTLS peer, private service configuration, key rotation, replay cache/restart and failure behavior.
2. **DuckNote:** demonstrate the PostgreSQL lookup against an actual isolated PostgreSQL service; the central public CI currently uses a query simulator.
3. **Workspace:** reconcile #178 and this branch with the independent session-lock, two-store recovery and Stripe LIVE verified-financial-entitlement review tracks, before issuing any real grants. The real native PKCE broker adapter is still intentionally **deny-only**. Do not grant an app from a signed ownership statement alone.
4. **Staging:** prove all seven genuine independent running processes, source integrity, working DNS/TLS, native app/resource permissions, billing/seat transitions, logged revocations, and tested recovery and rollback. No operator-installed seven-service staging is claimed by this PR.
5. DataDuck is the separate seventh app and is deliberately outside the six original native sidecars.

**No production deploy, merge to `main`, license activation, actual native app account, payment or SSO login is performed by this draft PR.**
