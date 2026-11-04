# Six original native apps: real database → Ed25519 → mTLS CI evidence (2026-11-04)

**New, independently pinned QA evidence only. NOT a staging source lock, combined authorization approval, app-seat entitlement, or installed service.**

All six original native apps now have at least one **single test pipeline** connecting their **actual native datastore lookup**, the genuine native Ed25519 signer and actual dormant private TLS 1.3 mTLS sidecar. This is stronger than proving the native database and sidecar independently. Each individual run uses disposable synthetic user/account mappings, short-lived test certificates and loopback sockets; **none** uses customer data or mounts the private service in production.

## Exact reviewed native source and main-push CI

| Native app | Exact main commit | CI run | Chain tested |
|---|---|---|---|
| CytoDuck | `ba22006b75b75d6b1fbe680c3d59116768806798` | [41823086005](https://github.com/dennisbsj/CytoDuck/actions/runs/41823086005) | `tests/workspace-native-ownership-https.test.cjs` |
| DuckNote | `83f3892442eabb64f050934d435d39c4e72b3d8b` | [41837318986](https://github.com/dennisbsj/DuckNote/actions/runs/41837318986) | `scripts/workspace-native-ownership-mtls-pg-real.mjs` |
| DuckPipe | `6acd3fec8d8a3c057b15fb79c9f47351c54c8294` | [41853056933](https://github.com/dennisbsj/DuckPipe/actions/runs/41853056933) | `tests/workspace-native-ownership-sqlite-mtls.integration.test.cjs` |
| DuckTrain | `977bc15111004b71f9fc6e95d8facbb4bc2a3bcd` | [41853561782](https://github.com/dennisbsj/DuckTrain/actions/runs/41853561782) | `tests/workspace-native-ownership-sqlite-mtls.integration.test.cjs` |
| DuckMan | `a1cf2ff6ba7f1d7d95cbd7a8af1d3a3149667257` | [41854693598](https://github.com/dennisbsj/DuckMan/actions/runs/41854693598) | `tests/workspace-native-ownership-sqlite-mtls.integration.test.cjs` |
| LabDuck | `e03f49d3df81719db6fc7c5d6c64a050edec9641` | [41854484043](https://github.com/dennisbsj/LabDuck/actions/runs/41854484043) | `tests/workspace-native-ownership-sqlite-mtls.integration.test.cjs` |

Current Workspace main `3932361e7bd3f2b0bafaef49a62f2487a07b5e6b` passed its independent auth-core CI [41830839811](https://github.com/dennisbsj/DuckBio-site/actions/runs/41830839811); **this does NOT mean the above six newer native revisions were jointly validated with that Workspace SHA**. The native SSO browser workflows continue to pin a separate reviewed broker `1a3b19c993fcd63ff625113cc2628b2642fe2d2f`. DuckNote's newer main commit did not trigger its narrowly path-filtered reviewed Workspace `1a3b19c` browser workflow, so **six-app exact-source staging promotion is explicitly blocked**, despite the passing DuckNote comprehensive CI.

## What the independent gate checks

The additional `six-native-real-db-mtls-ci-evidence.json` is deliberately outside `staging-six-native-snapshot.mjs` and has `releaseAuthorized:false`. The code has a **second frozen independent allowlist** of exactly six native app IDs, repositories, commits, workflow paths and numeric GitHub workflow/run IDs, plus current central CI metadata. A changed JSON lock cannot authorize another app or CI execution.

Run `node six-native-real-db-mtls-ci-audit.mjs --offline` from `workspace-server` for the immutable metadata/documentation check. Optional `--remote` uses the `DUCKBIO_QA_READ_TOKEN` supplied by the operator to check exact GitHub **push-to-main completed/success** runs and the test-file/CI launcher source at each pinned SHA. Neither path automatically downloads native checkouts, runs a service, reads TLS credentials, provisions a native identity, calls Stripe, changes the app/backend, or promotes any staging gate. The public CI only exercises the offline validator and mocked remote responses.

## Remaining integration requirements

- Existing [Workspace source and mTLS staging lock](https://github.com/dennisbsj/DuckBio-site/blob/main/workspace-server/six-native-ownership-mtls-compat-lock.json) **stays unchanged**. These newer native SHAs are evidence candidates, not allowable source revisions for live seven-service staging.
- Joint six-native mTLS→Workspace **actual private source** rehearsal, independent TLS certificates per app, and genuine DuckNote PostgreSQL **in the same seven-service environment** remain outstanding. Workspace drafts [#184](https://github.com/dennisbsj/DuckBio-site/pull/184) and [#186](https://github.com/dennisbsj/DuckBio-site/pull/186) are separate, unmerged parallel work.
- Organization-specific roles, actual per-native-app permission/seat enforcement, finance-approved licensing, explicit native account binding, durable revocation/ABA barriers, full seven-running-process HTTPS, backup/restore, app-level audit and rollback are not proven.
- DataDuck is a separate seventh app and not part of the original six-native mTLS evidence. Never infer full seven-app readiness, production login, Stripe settlement or customer deployment from this record. [Integration issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26) remains open.

This report records the current **merged-main** native source commits and exact primary native CI result only; it never changes native repositories, centrally granted permissions, production releases or published DNS.
