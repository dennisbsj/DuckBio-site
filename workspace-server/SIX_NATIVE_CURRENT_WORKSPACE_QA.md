# DuckBio six-original-app compatibility with reviewed Workspace main (3 November 2026)

**Evidence status:** All six **independent native HTTPS Chromium/real-broker tests** below passed as actual **push-to-main** GitHub Actions runs for the exact app commits shown. This certifies source compatibility with the pinned Workspace `1a3b19c993fcd63ff625113cc2628b2642fe2d2f` snapshot **only**. It is **not** staging, simultaneous seven-real-service QA, deployment authorization, native custom-role enforcement, native paid-seat enforcement, a DNS/TLS rollout or a production release.

## Independently pinned Workspace central source

- Workspace repository: `dennisbsj/DuckBio-site`
- Reviewed main commit: `1a3b19c993fcd63ff625113cc2628b2642fe2d2f`
- [Main-push Node 22/24 core CI run 41681059383](https://github.com/dennisbsj/DuckBio-site/actions/runs/41681059383), workflow ID `403711277`, PASS.
- This snapshot includes the completed central customizable-role, admin audit, candidate seventh-app and six-native runtime changes **as source compatibility only**. The separate Workspace-backend conversation owns any central role/licensing implementation; this QA lane does not edit it.
- The original historical seven-source `six-app-source-qa-lock.json` remains frozen to Workspace `233ca6d376efa2fbddca042cea5106aae92679c0`. This newer QA snapshot is **separate** and must not rewrite earlier pass claims or implicitly enable staging.

## Real native HTTPS SSO/PKCE/session compatibility on merged main

Each native suite checks out **exactly the same central Workspace commit** above and runs the real native server plus real Workspace broker over two isolated HTTPS origins, using synthetic disposable identities/data and a real Chromium browser (with PostgreSQL for DuckNote). PR tests were separately successful before merging.

| Native app | Exact merged app main SHA | Independent real native + Workspace HTTPS Chromium evidence |
|---|---|---|
| CytoDuck (`goflo`) | `79b1d76cb1aae9233c93f0d18cca46e560ddc2ae` | [Main-push run 41690621438](https://github.com/dennisbsj/CytoDuck/actions/runs/41690621438) |
| DuckNote (`eel`) | `c4db3b2ebe9fe9ab2423c376d19966732bd4bcce` | [Main-push run 41691039724](https://github.com/dennisbsj/DuckNote/actions/runs/41691039724) |
| DuckPipe (`methpipe`) | `cda0f784a4e4d968a92215a1acb8d97bfc5104c2` | [Main-push run 41690527942](https://github.com/dennisbsj/DuckPipe/actions/runs/41690527942) |
| DuckTrain (`mantrain`) | `c8928d221cf4d08f190002610b0a5793f4caa58e` | [Main-push run 41690516300](https://github.com/dennisbsj/DuckTrain/actions/runs/41690516300) |
| DuckMan (`duckman`) | `9e024fccb33efe9f9f4174becded7e2a35297891` | [Main-push run 41690730348](https://github.com/dennisbsj/DuckMan/actions/runs/41690730348) |
| LabDuck (`limsman`) | `716ec4a316f199bc3c6ee752ba517b1d04fdc18a` | [Main-push run 41690541378](https://github.com/dennisbsj/LabDuck/actions/runs/41690541378) |

Six additive native GitHub Actions workflows performed this new compatibility check without changing their production APIs, historical CI workflows, scientific features, existing customers, subscriptions or data. **All HTTPS origins in these checks are synthetic local test environments**, not installed staging hosts. Individual real-native tests are not a substitute for one simultaneous seven-service test.

## Re-verify source evidence (read-only)

The machine-readable [current compatibility lock](six-native-current-compat-lock.json) is intentionally distinct from [the historical six-app prestart lock](six-app-source-qa-lock.json). It records six exact app main SHAs, six exact workflow paths, six completed main-push run IDs and the precise Workspace source/CI run.

From `workspace-server`:

```bash
node six-native-current-compat-audit.mjs --offline
# Optional on a trusted operator machine with read-only private repo access:
DUCKBIO_QA_READ_TOKEN=<use-your-secret-manager> node six-native-current-compat-audit.mjs --remote
```

Offline validation requires no token or network; it checks immutable IDs, workflow paths and documented evidence. The remote mode requires an **explicit read-only private GitHub credential** and makes GET-only requests for fixed runs and workflow files, checking the actual successful `push` to `main`, exact immutable source versions, the pinned broker SHA and both Workspace Node CI jobs. Ordinary public Actions CI cannot read the six private app repositories, so its green offline report is **not** remote verification. Do not commit, print or upload the credential or the private responses.

## Explicit unresolved cross-app and release gates

1. **No simultaneous seven-real-service HTTPS test yet.** Existing seven-host Caddy tests exercise a real Workspace with one genuine native service and five fake native routing stubs. Provision a separate approved staging host with seven real listeners, six distinct private environments, a private DuckNote `DUCKNOTE_RUNTIME_DIR`, verified domains and TLS, and synthetic users only.
2. **Custom Workspace role policies are not yet enforced in native APIs.** The current organization role catalog advertises `rolePolicyEnforcedByNative:false`. The shared backend's effective role/permission evaluation and seat state must be connected through an explicit, current, server-trusted native authorization/identity/organization mapping contract and verified by real native route denials. This work belongs to the other **Workspace backend** conversation; the six-app integration lane will verify native behavior once the contract exists.
3. **Per-app commercial/seat/entitlement changes are not attested as active native grants.** The six compatibility suites use synthetic test-only app seats and logins. Real Stripe subscriptions, native app role persistence and verified ongoing paid-seat revocation remain separately gated.
4. **Latest code beyond these SHAs is not covered.** If Workspace or a native `main` changes, retest and version a new QA lock. Do not substitute `main` for a commit hash in an old lock.
5. Backup/restore, negative cross-organization test suites across **all six running concurrently**, native MFA, expired sessions, logout/revoke/offline handling, security monitoring and rollback on a real isolated staging deployment remain prerequisites for release. No live customer/server, production routing, hosting, billing or data changes occurred.

See [Workspace issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26) for integration ownership and remaining blockers. The separate DataDuck integration/rollout is not included in this six-app evidence.
