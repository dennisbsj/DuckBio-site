# Full seven-service offline staging prestart, including the Workspace unit

**Purpose:** Verify that the previously generated, private and *uninstalled* staging artifacts include **all seven** correct systemd services, not merely six native app unit templates and seven Caddy routes.

This work is limited to the six original apps plus their Workspace integration. **DataDuck is excluded.** It does not change any central Workspace identity, role, permission, licensing, seat, Stripe, database or native app feature code.

## Why this addition is necessary

The existing [current six-native staging plan](CURRENT_SIX_NATIVE_STAGING_PLAN.md) verifies six native systemd unit files, six native environments, seven source checkouts, and the canonical seven-origin Caddy configuration. But the **seventh service unit for Workspace** is created independently by the exact pinned Workspace source itself using `staging-prepare-ui.mjs` and `staging-service-plan.mjs`. Previously the combined prestart check did not compare this central service unit, copied UI, manifest or standalone historical Caddy template back against the immutable reviewed Workspace source.

The new check closes that *offline artifact verification* gap. It does **not** install, start, restart, deploy or provision any service.

## Order of operations

A separately authorized staging operator uses an **isolated Linux host** with owner-only 0700 roots and an already created 0600 synthetic-only Workspace config. The reviewed source is frozen to Workspace `1a3b19c993fcd63ff625113cc2628b2642fe2d2f` and the six exact native main commits in `six-native-current-compat-lock.json`. The operator-tooling checkout may be newer, but must be separately trusted; it must not change the seven immutable service source checkouts.

First, follow the prior current staging plan to generate the six native unit templates and canonical seven-origin Caddy plan, and pass the existing `staging-seven-prestart-gate.mjs --snapshot current` check. Next, inside the **exact pinned** Workspace source checkout (not the newer operator tooling checkout), generate its private UI and Workspace-only unit:

```bash
cd /srv/duckbio-private/seven-reviewed-sources/DuckBio-site/workspace-server

node staging-prepare-ui.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --confirm-first-install

node staging-service-plan.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --service-user duckbio-staging \
  --listen-port 3307 \
  --confirm-plan-only
```

Both are **first-write-only private artifact generators**, not installers. The Workspace-only `Caddyfile.workspace-staging` they create is a legacy single-origin artifact for source verification **only**. It must **never be combined with** `Caddyfile.seven-origin-staging`: use the seven-origin Caddy plan alone after a separate deployment review.

Then use the reviewed newer operator-tooling checkout and run:

```bash
cd /path/to/trusted/tooling/DuckBio-site/workspace-server

node staging-seven-complete-prestart-gate.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --private-data-root /srv/duckbio-private/native-data \
  --proxy-plan-root /srv/duckbio-private/proxy-plans \
  --native-plan-root /srv/duckbio-private/native-plans \
  --confirm-offline-seven-uninstalled-only
```

The private roots and host paths above are **examples** and are not evidence that a host has been provisioned.

## Exactly what a PASS demonstrates

The wrapper first requires the existing current six-native prestart gate to pass: seven pristine immutable source checkout SHAs/remotes; six separate validated native configs, including isolated DuckNote runtime; exact canonical seven-origin Caddyfile+hash manifest; and six native owner-only systemd unit files+manifest, on their expected dedicated users and ports.

Only after that passes, the **seventh Workspace unit** is checked:

1. Private Workspace staging JSON matches the generated synthetic-only config, and the central source lives in the previously verified reviewed checkout.
2. The private Workspace UI directory has exactly the expected UI files, six icons and original source manifest; every 0600 UI/icon byte matches its immutable Git source bytes and the recorded SHA-256 digest. No symlinks, extra or missing files.
3. The Workspace unit directory has exactly three private files: `duckbio-workspace-staging.service`, `Caddyfile.workspace-staging` and `plan-manifest.json`. All are regular owner-only files in 0700 folders.
4. The Workspace systemd unit must match the exact reviewed generator byte-for-byte, including non-root `duckbio-staging` user, entrypoint under the pinned source checkout, private config file, 3307 loopback port, immutable source tree and its sandboxing directives. The manifest must match the expected source SHA, file hashes, UI asset count, Node.js version, port and uninstalled-only scope.
5. The standalone Workspace-only Caddyfile is checked byte-for-byte against the reviewed generator. **This is a consistency check, not permission to install it.** The separate seven-origin Caddyfile remains the only proposed multi-service proxy configuration.

After both the six-native and central Workspace file checks pass, the combined gate **re-runs the full read-only seven-checkout Git integrity check** against the same immutable native/Workspace source SHAs, approved remotes and clean working trees. This final check rejects a source checkout that changed while the seventh Workspace unit/private UI was being inspected, including a local source/asset replacement between the initial source audit and the final plan approval. A source-check failure, missing evidence or Git outage makes the full gate fail closed. This is a point-in-time consistency guard, not an atomic filesystem snapshot or protection against a compromised root operator.

It fails closed on any wrong SHA, edited/hijacked plan or copied asset, changed systemd privilege directive, invalid Node binary/version, missing/extra file, symlink, non-private permission, mixed historical/current snapshot or final changed Git tree. It prints only fixed success/failure check names, never credentials or file contents.

The original `staging-seven-prestart-gate.mjs` remains unchanged, so old historical invocations keep their existing behavior. The new combined command requires a separate explicit confirmation and the **current six-app source lock only**.

## Beyond this source-only milestone

This tool has **not run against a real installed staging host**. Even when it does, success is **only an uninstalled plan audit**, not DNS/TLS certificate readiness, a genuine seven-running-process check, authenticated end-to-end testing, effective native role enforcement, verified purchased app seats, MFA, backup/restore, rollback or production release authorization.

After a separately approved installation, use [the seven genuine running-services checker](SEVEN_GENUINE_STAGING_ACCEPTANCE.md), then [the six-native synthetic broker-proof checker](SIX_NATIVE_AUTHENTICATED_STAGING_ACCEPTANCE.md), and finally full native API permissions/tenant/revocation/paid-seat browser tests. The Workspace-backend conversation owns its new central access-contract work; this lane owns native cross-app integration validation. Keep [Issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26) open.
