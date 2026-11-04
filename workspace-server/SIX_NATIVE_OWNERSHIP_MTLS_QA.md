# Six original native ownership-mTLS source and CI lock — 4 November 2026

**Candidate: opt-in, source-only/offline staging preparation. No installed staging, live entitlements, production deployment, or centrally enforced native role permission is proven.** This snapshot is separate from historical, current and post-PKCE immutable source locks.

## Exact seven-source set

The Workspace broker remains on the independently reviewed central source `1a3b19c993fcd63ff625113cc2628b2642fe2d2f`, [main-push CI run 41681059383](https://github.com/dennisbsj/DuckBio-site/actions/runs/41681059383) (Node 22/24). Six source-merged native apps have separately completed real native + pinned Workspace HTTPS/Chromium tests on their exact main commits:

| Native app | Exact source SHA | Reviewed main-push native HTTPS CI |
|---|---|---|
| CytoDuck (`goflo`) | `ba22006b75b75d6b1fbe680c3d59116768806798` | [41823086283](https://github.com/dennisbsj/CytoDuck/actions/runs/41823086283) |
| DuckNote (`eel`) | `c64da055b82e0f8a499c5dd6ef47eaaa089be13f` | [41825543890](https://github.com/dennisbsj/DuckNote/actions/runs/41825543890) |
| DuckPipe (`methpipe`) | `cd5369134c230c5afcbd0fc4a4bf9a136d5211b7` | [41825060709](https://github.com/dennisbsj/DuckPipe/actions/runs/41825060709) |
| DuckTrain (`mantrain`) | `f25eabfbb0cb9ebac45c77948a14b217fa458733` | [41825092520](https://github.com/dennisbsj/DuckTrain/actions/runs/41825092520) |
| DuckMan (`duckman`) | `f8a86c10db6b6ec86b6224a8c81b90cebcf652d2` | [41825150001](https://github.com/dennisbsj/DuckMan/actions/runs/41825150001) |
| LabDuck (`limsman`) | `48a2ee834f1bcc6eb3f910ad5399cc4883acb2bd` | [41825121913](https://github.com/dennisbsj/LabDuck/actions/runs/41825121913) |

In addition to these pinned HTTPS CI runs, each native mTLS sidecar has a dedicated source-level and local transport security regression. DuckNote's independent comprehensive `main` CI [41825543877](https://github.com/dennisbsj/DuckNote/actions/runs/41825543877) succeeded **on retry (attempt 2)** after an unrelated organization lock wait test failed in attempt 1. This is not proof of deterministic behavior for that separate race regression.

## What this lock does

- Pins the six exact **merged** native app versions, each native browser SSO workflow path/ID and its successful exact-SHA `push`-to-`main` run. The central Workspace source/workflow/run remains independently pinned.
- Requires the separate hardcoded six-app SHA, run and workflow allowlist in `staging-six-native-snapshot.mjs`; editing the JSON alone cannot authorize a new revision or add DataDuck.
- `node six-native-ownership-mtls-qa.mjs --offline` validates exact seven-source inventory and docs without network. `--remote` additionally requires an explicitly provided private read-only GitHub token; missing credentials fail closed.
- Permits **explicit opt-in uninstalled staging plan generation** using `--snapshot ownership-mtls`, subject to existing seven-source/private-config/manifest audits. The default CLI and all three prior locks remain unchanged.

## Limits / barriers

**No active native ownership service:** The six native TLS 1.3 sidecars are *unmounted and opt-in*. Exact CA/client certificate fingerprint plus private bearer, private key, trusted native operator mapping, bound loopback listener and rotation are not provisioned. In-memory nonce reuse checking is per-process, not a distributed replay store. A verified native identity statement never authorizes a paid app seat, a signature, a document or an analysis.

**No true integrated staging:** Seven simultaneous genuine processes, seven HTTPS endpoints, native MFA, role/permission downgrade, purchased seat revocation, cross-tenant denial, in-flight commit rechecks, independent backups and safe rollback remain prerequisites. The central native effective authorization contract is still a separate reviewed backend workstream. Do not assume this lock, old six-native SSO tests or anonymous runtime checks satisfy it.

**Source-only approval:** Do not activate the retired cHosting services, provision real customer identity/data or keys, alter DNS/Stripe/billing, reuse uninstalled plans created for older snapshots, or make production changes. DataDuck is a separately gated seventh app, not part of this original six-app lock. Issue [#26](https://github.com/dennisbsj/DuckBio-site/issues/26) remains open.
