# DuckBio Workspace / seven native apps — read-only source observation

**Observed 2026-11-05 (Europe/Copenhagen). NOT a release manifest or staging approval.**

This document records refs independently read through the connected GitHub repository interface. The Workspace review commit below is the initial combined two-parent merge before later source-only invitation acceptance hardening; consult the live PR for its current head. It is a transient engineering observation, **not** an immutable trusted release pin. Re-read each branch immediately before any real source audit. All private repositories and files remain in GitHub; no customer database, secrets, app service or production hostname were accessed.

| Service | Repository | Observed ref | 40-character commit | Observed source only |
| --- | --- | --- | --- | --- |
| Workspace initial integration merge snapshot (historical; latest #237 head may move) | `dennisbsj/DuckBio-site` | draft integration branch [#237](https://github.com/dennisbsj/DuckBio-site/pull/237) | `789b585e25176d1508bf6ce164ae769622ddb6f0` | NOT on `main` |
| Workspace production baseline | `dennisbsj/DuckBio-site` | `main` | `fdc312ae44d4bacbc0a5e059860939635a392b5e` | Does NOT contain the draft integration |
| CytoDuck (goflo) | `dennisbsj/CytoDuck` | `main` | `ba22006b75b75d6b1fbe680c3d59116768806798` | Dormant native signer/lookup/HTTPS sidecar files found |
| DuckNote (eel) | `dennisbsj/DuckNote` | `main` | `83f3892442eabb64f050934d435d39c4e72b3d8b` | Dormant native signer/lookup/HTTPS sidecar files found |
| DuckPipe (methpipe) | `dennisbsj/DuckPipe` | `main` | `6acd3fec8d8a3c057b15fb79c9f47351c54c8294` | Dormant native signer/lookup/HTTPS sidecar files found |
| DuckTrain (mantrain) | `dennisbsj/DuckTrain` | `main` | `977bc15111004b71f9fc6e95d8facbb4bc2a3bcd` | Dormant native signer/lookup/HTTPS sidecar files found |
| DuckMan (duckman) | `dennisbsj/DuckMan` | `main` | `a1cf2ff6ba7f1d7d95cbd7a8af1d3a3149667257` | Dormant native signer/lookup/HTTPS sidecar files found |
| LabDuck (limsman) | `dennisbsj/LabDuck` | `main` | `e03f49d3df81719db6fc7c5d6c64a050edec9641` | Dormant native signer/lookup/HTTPS sidecar files found |
| DataDuck (dataduck) | `dennisbsj/DataDuck` | `main` | `1464017986ab6c5de4679dfd25ed9d4144af8118` | No integrated native app; base tree has only one tracked entry |
| DataDuck source candidate | `dennisbsj/DataDuck` | **unmerged draft PR #1** | `a7f87a03c22f589c1319402ee04c94fc05b1e2b4` | Workspace adapters/guards exist in draft, not `main` |

## Verified existence of six dormant native source modules

The exact `main` Git trees for **all six** existing native apps contain a `server/workspace-native-ownership-https.(cjs|js)`, a `server/workspace-native-ownership-lookup.(cjs|js)`, and a `server/workspace-native-ownership.(cjs|js)` module, plus accompanying repository-specific test files. This is source-file presence only. In particular, it is **not** evidence of installed mTLS endpoints, an authorized native SSO route, native API permission checks, executable full tests, LIVE paid entitlement enforcement, or approved deployments.

The DataDuck **draft** tree contains `src/workspace-http-adapter.mjs`, `src/workspace-native-session.mjs`, `src/workspace-native-dispatch.mjs` and `src/workspace-route-policy.mjs`. These are **not merged on DataDuck main**. The draft head moves independently; do not use the version above as a permanent source lock.

## Blocking release gates

1. Independently review and run full **exact-HEAD** Node 22/24, SQLite, HTTP, native signer/authorization, browser and regression QA for the consolidated Workspace code. Recent GitHub Actions minutes were exhausted; branch source comparisons are not executed tests.
2. Independently test each native backend's real per-organization ACL, MFA/reauthentication, user mapping and revocation against genuine database state. Retain deny-only central org-mode SSO until the full future adapter is approved.
3. Finish and merge DataDuck's genuine native scientific API authorization only after its own QA and release decision. Approve the price and per-app seat policy before adding saleable seventh-app rights.
4. Independently verify real Stripe LIVE tenant/subscription/seat allocations and reversals, **before** authorizing any native access. No TEST invoice/projection is a paid entitlement.
5. Establish **eight separate private HTTPS services** with trusted DNS/TLS/mTLS credentials, network restrictions, back-up/restoration, real-browser cross-app workflows and independent go/no-go. Historical seven-service checks refer only to Workspace plus six apps.
6. Only after all gates and explicit operator approval, prepare a separate production change; do not modify the public GitHub Pages storefront, `main`, live identities, subscriptions or customer data as part of this observation.

See `EIGHT_SOURCE_OFFLINE_QA.md`, `EIGHT_ORIGIN_STAGING_CANDIDATE.md`, [activation draft #190](https://github.com/dennisbsj/DuckBio-site/pull/190), and [issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26). The existing source-only eight-origin candidate must remain `stagingAuthorized:false`, `accessGranted:false`, `licensesGranted:false` and `deploymentAuthorized:false`.
