# Six real native mTLS sidecar source gate — reviewed 2026-11-04

This is a **new, separate, strictly offline SOURCE check** for the original six native applications. It extends the merged `ownership-mtls` version lock without changing any historical, current or post-PKCE snapshots. It does not deploy or launch even one server.

## What it validates

Before any native mTLS staging rehearsal, the operator must provide a private directory containing exactly seven clean, unmodified Git checkouts: the Workspace repo and the six original native repositories at the pinned commits recorded in `six-native-ownership-mtls-compat-lock.json`. The pre-existing seven-source gate verifies the repo URL, clean HEAD, fixed Workspace CI workflow and central SHA for each app.

The new independent check then inspects the actual native sidecar source file **Git tree blobs** at those commits. Only an exactly matching, regular non-symlink source file is accepted. The pin is independent of the lock JSON: editing the lock, replacing the file, switching app versions or adding DataDuck cannot substitute another sidecar implementation.

| App | Native module path | Exact reviewed Git blob SHA |
|---|---|---|
| CytoDuck | `server/workspace-native-ownership-https.cjs` | `b2c123d9f824761da52b5a9d180bba7451d766ea` |
| DuckNote | `server/workspace-native-ownership-https.js` | `37955f955ad9abd6fcea95479be5d5cd1c2b212c` |
| DuckPipe | `server/workspace-native-ownership-https.cjs` | `108ee9ea40c1af7ec560001af62a75862c50ff12` |
| DuckTrain | `server/workspace-native-ownership-https.cjs` | `5baf1e4cdbbc8f3f54499ac1be31c2e30d8cacf7` |
| DuckMan | `server/workspace-native-ownership-https.cjs` | `1c4b1fa59fa39683f5be1a8b53f3d27dd0d23bbc` |
| LabDuck | `server/workspace-native-ownership-https.cjs` | `6114343a5988d53356bfe0a8193caa77f30b06eb` |

These are Git object IDs for source-file blobs, not fingerprints of TLS certificates. They were inspected on the exact six native `main` revisions pinned in the ownership-mTLS lock. The six native sidecars require a private TLS 1.3 listener and client-certificate authentication and are not automatically registered with the public apps. A matching Git blob is **not** a behavioral mTLS test.

## Operator command — optional and fail-closed

Only on a trusted **non-production** machine with locally obtained private checkouts:

```sh
cd workspace-server
node six-native-mtls-sidecar-source-gate.mjs \
  --sources-root /srv/duckbio-private/exact-seven-checkouts \
  --confirm-offline-mtls-sources-only
```

The command neither downloads nor clones repositories, reads passwords or TLS private keys, calls an API, imports code, opens network ports, installs systemd units, contacts a customer database, or writes an artifact. Success prints only a fixed source-only result. Failed inspection prints fixed app IDs/errors and exits nonzero. The public CI exercises synthetic directories and a synthetic Git invocation; it **does not** possess or inspect the six private native checkouts, so CI success cannot be described as operator source verification.

## Integration boundary

A separate draft [#181](https://github.com/dennisbsj/DuckBio-site/pull/181) has six disposable HTTPS servers and a test-only verifier; it does **not** execute the actual six native mTLS sidecar servers. This new source audit does not alter that draft or promote it. Only a future non-production operator rehearsal can combine actual pinned native sidecar modules, trusted per-app native lookups, distinct valid client and server certificates, a private client identity, authenticated purpose/nonce, real native PostgreSQL and SQLite databases, all seven service processes and response-side role/seat revocation checks.

**Not approved:** live SSO, centrally enforced per-app paid seats, native record-level permission, production release, customer records, DNS, billing, or DataDuck. Keep [Workspace integration #26](https://github.com/dennisbsj/DuckBio-site/issues/26) open.
