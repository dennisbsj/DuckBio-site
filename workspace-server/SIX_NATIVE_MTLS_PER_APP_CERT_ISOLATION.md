# Separate mTLS identities for every native app (six-app offline QA)

**Status: draft, source-level rehearsal only, 4 November 2026. No app route, seat, login or deployment is activated.**

PR #184 proved real mutual TLS handshakes for all six dormant native sidecar contracts with synthetic factories, but its QA harness deliberately reused **one server X.509 certificate covering all six test hostnames and one Workspace client X.509 certificate**. That was sufficient for basic mTLS, but could not catch accidental cross-app client-certificate/CA reuse.

This PR strengthens the **isolated QA rehearsal** as follows:

- **Six separately generated native server X.509 certificates**, each with an exact single-app DNS Subject Alternative Name and a different SHA-256 fingerprint; one reviewed `https://staging-APP.qa.test:PORT/private/v1/native-ownership` endpoint per app.
- **Six separately generated Workspace client X.509 certificates/private keys** with independent fingerprints; each native sidecar trusts only its matching app's certificate and pins the certificate fingerprint.
- **Twelve distinct X.509 certificate fingerprints** are required before beginning proof verification. Each private TLS request picks its client identity and server CA from the exact approved destination. All names resolve strictly to loopback `127.0.0.1` within the QA transport; no public DNS or production TLS setting is affected.
- For each of the six app endpoints, additional *negative* proofs deliberately substitute the **next app's Workspace client certificate**, **next app's trusted server CA**, and **next app's bearer token**, and require failure in all three cases. The existing tests for untrusted CA, missing client certificate, exact native ownership, wrong organization, revocation, expiry and sidecar nonce replay remain required.
- The positive attestation adds `separateAppTlsIdentitiesVerified:true`; every result still includes `deploymentAuthorized:false`.

This prevents a false sense of security where a globally shared test certificate allows cross-app identity confusion to go untested. It is a **security regression rehearsal**, not proof of real native production credentials. Operator-only source mode still requires the six exact private repository HEADs, unchanged signer/lookup/sidecar Git blobs, and explicit opt-in from #184. Public GitHub Actions tests use **synthetic native modules over real localhost TLS/mTLS**, not the actual private source modules.

No private application source is copied into DuckBio-site and no production client certificates are read. Real deployment still requires independently provisioned and rotated per-app service identities, reviewed native backend authorization, paid-seat evidence, native data stores (including genuine DuckNote PostgreSQL), and a complete seven-service staging acceptance test.

**No merge to `main`, no production deployment or SSO enablement.**
