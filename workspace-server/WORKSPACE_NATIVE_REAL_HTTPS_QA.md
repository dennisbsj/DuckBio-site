# Synthetic real HTTPS native ownership verification (DRAFT QA)

This opt-in **test-only** acceptance harness verifies the existing **unmounted** Workspace signed-native-ownership verifier from [draft PR #150](https://github.com/dennisbsj/DuckBio-site/pull/150) over an actual loopback TLS connection. It leaves the source/native app repos, Workspace runtime, active SSO broker, paid seat handling, identity SQLite, and DataDuck untouched.

## Test setup

- At test time, OpenSSL generates a **disposable one-day self-signed CA/server certificate** valid for the loopback IP `127.0.0.1`. A local `node:https` server listens on a random loopback port and requires one synthetic private bearer credential. It never binds a public interface or uses real DNS.
- A separate Node.js child process uses Node's **actual global `fetch`** rather than the previously mocked transport. Its trust root is supplied at process startup via `NODE_EXTRA_CA_CERTS` so TLS certificate-chain validation is enforced; the child does **not** disable TLS verification. All files and credentials are disposable QA fixtures.
- The server signs its purpose-/nonce-/app-/tenant-/account-bound response with a freshly generated ephemeral Ed25519 private key; the child pins the corresponding public key and exact `keyId`. The signing endpoint is a synthetic local fixture, **not** a native app implementation or proof of actual user ownership.
- Tests prove exact native `inspect` and `bind` purposes can return a valid signed boolean without turning into Workspace authorization, while failed certificate trust, mismatched pinned signer, wrong bearer, signed wrong tenant, tampered payload, replayed signed nonce, HTTPS redirect, non-JSON content, oversized body and request timeout all fail closed.

## Verification and limits

Run the normal private auth-core suite (`cd workspace-server && npm test`) or `node --test tests/native-ownership-real-https.test.mjs` on CI's Ubuntu runner with OpenSSL installed. It is a **source-only** test, not a production deployment or a new native endpoint.

This fixture does **not** prove a real native application has implemented the required signed ownership endpoint or independently verified a Workspace-to-native account/organization association. It also does not provide mTLS, native resource permissions, real Stripe billing, SSO login grants, cross-DB crash atomicity, a trusted public CA deployment, key rotation, domain ownership, or HTTPS access across the real app origins.

No real private signing key, bearer token, root certificate, account credentials, or customer metadata are shipped. All tests use local disposable credentials and self-signed certificates. The six existing native apps must each implement and security-review their own authenticated ownership endpoint and key provisioning before any attempt at production cutover.

Do not merge as a live integration or mark release-security issue #140 closed based on this QA fixture. Explicitly keep **draft/unmerged/undeployed**.
