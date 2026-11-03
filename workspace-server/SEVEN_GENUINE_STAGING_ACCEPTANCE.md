# DuckBio Workspace + six original apps — real seven-service staging witness

**Status: testable, read-only source tooling only. No DuckBio staging host is known to be installed or authorized, and this procedure has NOT been run on a real seven-service host.**

This verification is owned by the integration of the six ORIGINAL apps:

| Intended systemd staging unit | App | Expected Node entrypoint |
|---|---|---|
| `duckbio-workspace-staging.service` | Workspace | `DuckBio-site/workspace-server/shared-auth/runtime.mjs` |
| `duckbio-native-goflo-staging.service` | CytoDuck | `CytoDuck/startup.cjs` |
| `duckbio-native-eel-staging.service` | DuckNote | `DuckNote/server/index.js` |
| `duckbio-native-methpipe-staging.service` | DuckPipe | `DuckPipe/startup.cjs` |
| `duckbio-native-mantrain-staging.service` | DuckTrain | `DuckTrain/startup.cjs` |
| `duckbio-native-duckman-staging.service` | DuckMan | `DuckMan/startup.cjs` |
| `duckbio-native-limsman-staging.service` | LabDuck | `LabDuck/startup.cjs` |

**DataDuck is excluded.** There is no app/backend/permission/licensing/UI code change or automatic staging/production deployment.

## Why this separate gate is needed

The historical `six-app-source-qa-lock.json` tests Workspace `233ca6d` and six apps separately. The independently reviewed `six-native-current-compat-lock.json` instead pins Workspace `1a3b19c993fcd63ff625113cc2628b2642fe2d2f` and the six later native `main` commits, with all six real-native HTTPS SSO CI tests passing. **Neither** snapshot certifies a working, deployed seven-service system.

The existing seven-host Caddy CI checks use genuine Workspace plus **one** genuine native app and **five synthetic native stubs**, not all six running simultaneously. An HTTPS `401` alone cannot prove the responder is the real application. A local operator therefore needs an additional gate that checks actual systemd processes and source integrity **before** making anonymous HTTPS requests.

## New operator-only read-only check

On an *independently approved, isolated Linux staging host*, after authorized operators have installed the services with synthetic accounts and individually private databases and verified source/deployment plans, use a trusted reviewed tooling checkout:

```bash
cd workspace-server
node staging-seven-genuine-runtime-audit.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --confirm-installed-synthetic-staging-readonly
```

These paths are examples; they are **not evidence that a host or service exists**. The configuration must already be a private 0600 validated synthetic-only Workspace broker profile, with exactly six distinct staging-native clients, seven approved staging-only HTTPS origins and exact `SUITE_BUILD_SHA` equal to the *current* immutable compatibility snapshot. The source root must already have exactly seven owner-private pristine Git checkouts; their identities, remotes, clean HEADs, fixed workflow pins and commit hashes are checked offline.

The command performs only the following, in a fail-closed order:

1. Verify the six-app-only, immutable current Workspace source/CI lock, exact private staging config and **all seven pristine Git source checkouts**. It stops on extra/missing checkout, changed SHA, wrong remote or wrong native workflow pin.
2. Read **seven named** systemd units with `systemctl show`, requiring each to be loaded, active, running, under its dedicated non-root staging user and group, with the expected source `WorkingDirectory` and a distinct valid MainPID. It reads only the corresponding `/proc/<pid>/cmdline`, `/proc/<pid>/cwd`, and `/proc/<pid>/exe` to check the actual Node executable and exact native entrypoint. It does **not** read `/proc/<pid>/environ`, application databases, secrets or service logs.
3. Only if all seven process checks pass, execute the **existing anonymous, read-only HTTPS smoke**: one version-pinned central health response, six protected native auth-boundary responses and the two extra DuckNote/LabDuck database/runtime health responses. No POST, browser, cookies, credentials, redirects or unknown URLs.
4. Read the seven process identities and active systemd states **again** to reject processes that were replaced or stopped during the network checks.

The CLI prints fixed check codes and app IDs only. It neither starts/stops nor changes services, ports, DNS, databases, secrets, backups, files, users or billing. On a missing host/config/service, it fails rather than substituting fake listener responses.

**Limitations:** This is a local process/source and anonymous-HTTPS witness, not cryptographic attestation of application memory, a complete atomic snapshot of all processes, a proof of central/native authorization, a verified user/org mapping, or a production readiness certificate. A compromised staging host can misrepresent its own process state. The check does not issue native grants or prove independent MFA, effective custom roles, purchased seats, seat removal, revocation, recovery or rollback.

## What must be completed separately

1. The previously generated **historical** uninstalled six-native systemd/Caddy plans are pinned to their older immutable QA lock. **Do not silently deploy the newer current-compatibility SHAs using those older plans.** The new seven-origin service plan must be reviewed/updated separately for the current six-native lock with verified exact source and environment semantics before any installation.
2. Arrange an approved private Linux host, DNS/certificates for all seven HTTPS origins, dedicated non-root units, private synthetic native database/organization mappings and Caddy routes. There is **no proof that these exist today**. Do not activate retired cHosting services or real Stripe.
3. Add true seven-real-service **authenticated browser/API acceptance**, using disposable users in two organizations: login, PKCE replay rejection, native MFA, per-app role and permission changes, custom roles, verified purchased seats, revoked/expired sessions, child-only and global logout, cross-tenant denials and network failures. This requires the separately owned Workspace backend to supply a verified native-enforced effective-policy/entitlement contract; the current central role catalog explicitly reports `rolePolicyEnforcedByNative:false`.
4. Verify real independent database backups, restore, rollback, monitoring and a separate explicit go/no-go before changing any production routing.

The integration lane owns the **native and staging verification**; the separate Workspace conversation owns the shared identity/role/permission/licensing backend, and the DataDuck conversation owns DataDuck. Track remaining work in [Workspace issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26). The existing historical six-app QA lock must remain untouched.
