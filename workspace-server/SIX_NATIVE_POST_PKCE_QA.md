# Six original apps — reviewed post-PKCE compatibility lock (2026-11-04)

**QA evidence and UNINSTALLED staging planning only.** No real seven-service installation, production, real customer data, new central permissions or seat/entitlement enforcement is approved. DataDuck remains independent and will be added **after** all six original apps pass. This new snapshot intentionally does **not** replace or rewrite the historical `six-app-source-qa-lock.json` or the 2026-11-03 `six-native-current-compat-lock.json`.

## Verified merged-main version set

Every GitHub Actions run below was checked directly against its corresponding repository. Each shows `event: push`, `head_branch: main`, `status: completed`, `conclusion: success`, the exact immutable source SHA and the exact version-pinned native SSO workflow path/ID in the snapshot.

| Service | Reviewed Git SHA | Native Workspace SSO main-push evidence |
|---|---|---|
| Workspace broker (`DuckBio-site`) | `1a3b19c993fcd63ff625113cc2628b2642fe2d2f` | [41681059383](https://github.com/dennisbsj/DuckBio-site/actions/runs/41681059383) |
| CytoDuck (`goflo`), new protected PKCE | `2e1008a9b6d2a4c43efcf41aabf4d25ab1fd8e40` | [41786859215](https://github.com/dennisbsj/CytoDuck/actions/runs/41786859215) |
| DuckNote (`eel`) | `c4db3b2ebe9fe9ab2423c376d19966732bd4bcce` | [41691039724](https://github.com/dennisbsj/DuckNote/actions/runs/41691039724) |
| DuckPipe (`methpipe`), new protected PKCE | `76fdae938d854af59ef98f19858c800f66896cdc` | [41786886411](https://github.com/dennisbsj/DuckPipe/actions/runs/41786886411) |
| DuckTrain (`mantrain`), new protected PKCE | `7fd90350965d0c2d0b4df6a73bb9088fe826ccd7` | [41786905381](https://github.com/dennisbsj/DuckTrain/actions/runs/41786905381) |
| DuckMan (`duckman`) | `9e024fccb33efe9f9f4174becded7e2a35297891` | [41690730348](https://github.com/dennisbsj/DuckMan/actions/runs/41690730348) |
| LabDuck (`limsman`) | `716ec4a316f199bc3c6ee752ba517b1d04fdc18a` | [41690541378](https://github.com/dennisbsj/LabDuck/actions/runs/41690541378) |

Only CytoDuck, DuckPipe and DuckTrain differ from the 2026-11-03 source set. Each new main build includes the native Workspace PKCE wrong-session-state fix and its negative regression test; their real native-Workspace browser SSO and local API workflows passed after merge. No automatic upgrade to newer `main` is permitted.

The immutable JSON snapshot is `six-native-post-pkce-compat-lock.json`, strictly allowlisted independently by `staging-six-native-snapshot.mjs`. Its scope and schema deliberately match the six-app `validateCurrentCompatLock` contract so all existing private source/manifest audit operations can verify it without inventing a new native permission or broker API. An operator cannot approve an unreviewed SHA or CI run ID by editing this JSON alone.

## How to create the new uninstalled staging plan

The following **example** paths are not known to exist. An independently approved operator must first provision trusted private 0700 roots and owner-only synthetic-only staging config and native environments as described in [the original current staging plan](CURRENT_SIX_NATIVE_STAGING_PLAN.md). The seven service source directories must have exact immutable Git heads and clean source trees from the above table; never run these commands on a customer/prod instance.

From a separately reviewed newer tooling checkout under `workspace-server`:

```bash
# 0. Offline evidence verification, no Git remote network calls or mutations.
node six-native-post-pkce-qa.mjs --offline

# 1. Source preflight: seven pristine immutable local Git checkouts.
node staging-seven-source-gate.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --snapshot post-pkce --confirm-offline-sources

# 2. Write the canonical, UNINSTALLED seven-origin HTTPS Caddy plan in
#    an exclusively new private directory, never reusing an old plan.
node staging-seven-proxy-plan.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --private-output-root /srv/duckbio-private/new-proxy-plans \
  --snapshot post-pkce --confirm-uninstalled-only

# 3. Generate six source-locked, UNINSTALLED native systemd unit templates.
node staging-six-native-services.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --private-data-root /srv/duckbio-private/native-data \
  --private-output-root /srv/duckbio-private/new-native-plans \
  --snapshot post-pkce --confirm-uninstalled-only

# 4. Independently verify the six native plans, seven exact source checkouts,
#    private native env files and canonical seven-origin Caddy artifacts.
node staging-seven-prestart-gate.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --private-data-root /srv/duckbio-private/native-data \
  --proxy-plan-root /srv/duckbio-private/new-proxy-plans \
  --native-plan-root /srv/duckbio-private/new-native-plans \
  --snapshot post-pkce --confirm-offline-prestart-only
```

The separately generated **seventh Workspace systemd unit and private UI** still come ONLY from the exact pinned central Workspace source `1a3b19c...`, as described in [SEVEN_COMPLETE_OFFLINE_PRESTART.md](SEVEN_COMPLETE_OFFLINE_PRESTART.md). After generating it there, verify **all seven uninstalled services** using:

```bash
node staging-seven-complete-prestart-gate.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --private-data-root /srv/duckbio-private/native-data \
  --proxy-plan-root /srv/duckbio-private/new-proxy-plans \
  --native-plan-root /srv/duckbio-private/new-native-plans \
  --snapshot post-pkce --confirm-offline-seven-uninstalled-only
```

The old commands without `--snapshot` are still historical by default for the first four generators. The later **complete seven-service** and **read-only real runtime** commands default to the previous reviewed `current` six-native snapshot for backwards compatibility and require explicit `--snapshot post-pkce` for the November 4 set.

## Genuine staging acceptance — only AFTER independently approved installation

Once a separately approved private staging host has been installed and all seven genuine reviewed services have started, the operator may use:

```bash
node staging-seven-genuine-runtime-audit.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --snapshot post-pkce --confirm-installed-synthetic-staging-readonly
```

For the later six-native **real** broker-proof and native HTTP session witnesses, the same optional `--snapshot post-pkce` must appear before their existing explicit confirmation flag; see [central broker-proof acceptance](SIX_NATIVE_AUTHENTICATED_STAGING_ACCEPTANCE.md) and [native HTTP session acceptance](SIX_NATIVE_HTTP_SESSION_STAGING_ACCEPTANCE.md). These witnesses use private synthetic-only users, cookies and proof files; they must never run automatically against public production or customer accounts.

**Not yet verified:** an actual seven-process staging installation, multi-tenant role and per-app purchased seat enforcement, real simultaneous browser PKCE/MFA, native scientific resource authorization, persistent database backup/restore and rollback. A successful offline CI or source-locked plan is **not** a release authorization. Track real integration completion in [Issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26).
