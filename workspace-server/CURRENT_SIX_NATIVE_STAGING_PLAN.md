# Exact current six-app Workspace staging plan (uninstalled only)

**Source-only planning, no installation, server provisioning, DNS, TLS certificate issuance, credentials, database migration, live identity, payment or production changes.** This procedure applies **only** to Workspace plus the six original apps (CytoDuck, DuckNote, DuckPipe, DuckTrain, DuckMan, LabDuck). It deliberately excludes DataDuck.

## Why a second versioned staging plan is necessary

The historical `six-app-source-qa-lock.json` uses the older immutable Workspace broker version and older native app SHAs. It must remain available without modification for regression and audit. Newer source compatibility was verified independently in `six-native-current-compat-lock.json`, using **six distinct genuine native HTTPS Chromium CI checks** against central Workspace `1a3b19c993fcd63ff625113cc2628b2642fe2d2f`. The newer CI results prove each native app independently communicates with that central source, **not that seven apps have already operated together**.

The new `--snapshot current` flag is an *explicit opt-in* on the existing **offline-only** source/plan/prestart commands. With no flag the old historical source lock remains the default; changing one app's source SHA, using a newer moving `main`, adding a seventh app, or reusing the wrong config/plan causes a fail-closed error. In addition to validating the versioned lock schema, the staging-specific snapshot policy independently allowlists **all six exact native source SHAs, successful main CI run IDs and workflow IDs** as reviewed evidence. Editing the lock JSON alone cannot promote an unreviewed version; a later staging release candidate requires a separate code and QA review.

### Reviewed exact source snapshot

| Repository | Approved immutable source SHA |
|---|---|
| Workspace (`DuckBio-site`) | `1a3b19c993fcd63ff625113cc2628b2642fe2d2f` |
| CytoDuck (`goflo`) | `79b1d76cb1aae9233c93f0d18cca46e560ddc2ae` |
| DuckNote (`eel`) | `c4db3b2ebe9fe9ab2423c376d19966732bd4bcce` |
| DuckPipe (`methpipe`) | `cda0f784a4e4d968a92215a1acb8d97bfc5104c2` |
| DuckTrain (`mantrain`) | `c8928d221cf4d08f190002610b0a5793f4caa58e` |
| DuckMan (`duckman`) | `9e024fccb33efe9f9f4174becded7e2a35297891` |
| LabDuck (`limsman`) | `716ec4a316f199bc3c6ee752ba517b1d04fdc18a` |

See [the independent six-native current source QA](SIX_NATIVE_CURRENT_WORKSPACE_QA.md) for the exact successful merged-main native browser workflow IDs. **Do not substitute latest commits:** these exact SHAs are frozen.

## Operator-only offline instructions — no services started

All paths below are **illustrative, not real deployed files**. Before running, a separately approved staging operator must create private non-symlinked **0700 directories** outside every Git checkout, and a synthetic-only **0600** Workspace staging JSON whose `SUITE_BUILD_SHA` is the exact *current* central SHA above. It must contain exactly the six approved private HTTPS app registrations, unique client secrets and private SQLite paths; all native `native.env` files must be 0600, use distinct per-app secrets and organization mappings, and reside under their separate app data roots.

Use a separate trusted operator tooling checkout of Workspace containing this plan support. The seven reviewed pristine source checkouts under the private sources root must be at the immutable SHAs in the table above. The tooling checkout itself **may be newer**; it is not one of the seven reviewed running service source trees.

```bash
cd workspace-server

# 1. Check the reviewed current six-native compatibility manifest offline.
node six-native-current-compat-audit.mjs --offline

# 2. Check seven exact pristine Git source checkouts. No fetch, checkout or write.
node staging-seven-source-gate.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --snapshot current --confirm-offline-sources

# 3. Check the six existing private native.env files and DuckNote runtime.
node staging-six-native-env-audit.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --private-data-root /srv/duckbio-private/native-data \
  --confirm-offline-only

# 4. Create ONLY fresh owner-private uninstalled seven-HTTPS Caddy templates.
node staging-seven-proxy-plan.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --private-output-root /srv/duckbio-private/proxy-plans \
  --snapshot current --confirm-uninstalled-only

# 5. Create ONLY fresh uninstalled six-native systemd templates.
node staging-six-native-services.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --private-data-root /srv/duckbio-private/native-data \
  --private-output-root /srv/duckbio-private/native-plans \
  --snapshot current --confirm-uninstalled-only

# 6. The SEVENTH systemd unit (central Workspace) is generated SEPARATELY
#    by the existing pinned Workspace source itself, never from newer tooling.
#    Its source checker requires the real pinned Git HEAD and pristine checkout.
cd /srv/duckbio-private/seven-reviewed-sources/DuckBio-site/workspace-server
node staging-prepare-ui.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --confirm-first-install
node staging-service-plan.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --service-user duckbio-staging --listen-port 3307 --confirm-plan-only

# IMPORTANT: The old Workspace-only Caddyfile produced alongside that
# seventh unit must NEVER be combined with the new seven-origin Caddyfile.
# Use ONLY the seven-origin Caddyfile after separate operator approval.

# 7. Return to the trusted newer tooling checkout. Recheck every source,
#    six-native environment, Caddy template, unit and manifest. This gate
#    does NOT itself validate or install the separately generated central
#    Workspace unit; its independent pinned-source generator must pass above.
cd /path/to/trusted/newer/DuckBio-site/workspace-server
node staging-seven-prestart-gate.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --private-data-root /srv/duckbio-private/native-data \
  --proxy-plan-root /srv/duckbio-private/proxy-plans \
  --native-plan-root /srv/duckbio-private/native-plans \
  --snapshot current --confirm-offline-prestart-only
```

The proxy generator writes into `seven-origin-proxy-plan` and the native generator into `six-native-service-plan`, with **exclusive creation** and owner-only artifacts. They reject existing destinations and do not overwrite earlier plans. Use separate, private output roots; never combine historical and current artifacts. The prestart auditor compares actual files to independently reconstructed canonical templates, so edited or extra files fail.

The central Workspace unit is **the seventh service** and must be generated using the immutable pinned Workspace source checkout, NOT the newer operator-tooling checkout. Its existing `staging-prepare-ui.mjs` and `staging-service-plan.mjs` verify the real Git HEAD, clean source, asset hashes and exact private configuration before creating a dedicated `duckbio-workspace-staging.service` on loopback port 3307. The central generator also outputs a **Workspace-only Caddyfile for its historical standalone plan**; do not install or combine that Caddyfile with the separate canonical seven-origin Caddyfile. The six-native prestart gate does **not** audit the central unit contents, and its PASS must never be used as an alternative to the central generator's own successful verification.

The six units use separate `duckbio-stg-APP` Linux accounts, distinct loopback ports and dedicated private native database roots. DuckNote must have its private `eel/runtime` directory with 0700 permissions, outside the read-only source tree, without any `reset-eel-database.once` marker. DuckNote's PostgreSQL connection must be synthetic staging-only and local, and its native vault key separate from the Workspace broker client secret. An old DuckNote source lacking the runtime isolation is rejected by the native plan generator.

The unit templates and Caddyfile do **not** provision or verify DNS ownership, TLS certificates, Linux accounts, PostgreSQL database/users, secrets, firewall rules, source builds or backups. The plan tests use inert local Git and environment fixtures only. They contain no real customer data.

## Gates still required after offline success

1. Independently approve and provision a genuine isolated Linux staging host, seven correct HTTPS origins and TLS routing, six private storage systems, backups and operating users. Do not install or activate any service solely because this offline plan passes.
2. Run the [read-only genuine seven-process/HTTPS acceptance](SEVEN_GENUINE_STAGING_ACCEPTANCE.md) on the already-installed staging system using the **same current exact SHA lock**, and separately verify genuine app readiness and logs. Unlike old synthetic route CI, the genuine check detects whether a fake stub process was substituted.
3. Execute **authenticated simultaneous cross-app tests**: six real application backends, Workspace, two tenant organizations, synthetic purchased seats, PKCE replay, login/logout, expiry/revocation, custom/default role edits, effective native permissions, cross-tenant denials, failure recovery and MFA. Central effective policies and live entitlement/seat revocation remain owned by the other Workspace-backend conversation. The current central catalogue still marks `rolePolicyEnforcedByNative:false`; do **not** claim this gate is complete yet.
4. Test PostgreSQL and SQLite backup/restore, rollback, monitoring and version migration independently, followed by explicit go/no-go. No real billing, app seats, customer data, domains or production configuration should be changed by these offline tools.

**A PASS at this stage means only a source-verified, internally consistent, entirely uninstalled staging plan.** It is not staging installation, native entitlement enforcement, verified multi-app acceptance or release authorization.
