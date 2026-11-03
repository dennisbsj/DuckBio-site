# DuckBio — coordinated six-app source QA snapshot (2026-11-03)

**Status: six-app source integration tested in isolated GitHub Actions only. NOT deployed or staging-approved.**

This is a **reproducible test configuration**, not a release artifact, a subscription entitlement,
a live client registration, a backup, or an operator go/no-go. It pinpoints one fixed
reviewed Workspace source commit and the six independent native app commits that
passed their real-native + real-broker browser integration suites against it.

## Shared Workspace identity/account/organization broker

- Repository: `dennisbsj/DuckBio-site`.
- **Precisely tested Workspace commit:** `5e0924e9844d36de75ca8e10c08048b3db373359`.
- [Pinned central CI, Node.js 22 and 24 PASS](https://github.com/dennisbsj/DuckBio-site/actions/runs/41629386714).
- This is **not necessarily the latest Workspace `main`**; any later central changes must
  be independently retested against all six native app versions before revising this snapshot.

## Native app `main` sources and evidence

| App | Immutable native commit | Coordinated central-version HTTPS evidence |
| --- | --- | --- |
| CytoDuck (`goflo`) | `b450dc9bb40851f1e58c0bfd79505c28509cf702` | [Chromium against real broker](https://github.com/dennisbsj/CytoDuck/actions/runs/41630512546), [build](https://github.com/dennisbsj/CytoDuck/actions/runs/41630512651) |
| DuckNote (`eel`) | `1e34258c95d4a1db98e01ac0f055f2d27d864a50` | [React + Node + PostgreSQL + real broker Chromium](https://github.com/dennisbsj/DuckNote/actions/runs/41630925678), [full CI](https://github.com/dennisbsj/DuckNote/actions/runs/41630925667) |
| DuckPipe (`methpipe`) | `e3080c47074b43103a72a298a819ba28dffb1460` | [Native + real broker Chromium](https://github.com/dennisbsj/DuckPipe/actions/runs/41629904033) |
| DuckTrain (`mantrain`) | `df2c0a690d98fccacac6f7400fc94770d6afaf13` | [Native + real broker Chromium](https://github.com/dennisbsj/DuckTrain/actions/runs/41630385999) |
| DuckMan (`duckman`) | `35d5db0f86f60928e0fe74604a46cdaa585a6412` | [Native + real broker Chromium](https://github.com/dennisbsj/DuckMan/actions/runs/41630577902), [full verify](https://github.com/dennisbsj/DuckMan/actions/runs/41630577922) |
| LabDuck (`limsman`) | `ce0f055f43e7d6e366219930fc00e250c4d8a6c5` | [Native + real broker Chromium](https://github.com/dennisbsj/LabDuck/actions/runs/41630412217) |

The CI workflows for the six app commits above checkout the **same fixed Workspace
SHA**, rather than each using a different historical broker version. Each existing
test harness uses disposable synthetic central users and organizations, unique
native test users, ephemeral TLS certs, private databases and no production network
traffic. Every app retains its own native account/role/MFA and application-data
authority. DuckNote's experimental PostgreSQL→SQLite migration PR #121 is **not**
included in this baseline; DuckNote here uses the existing PostgreSQL `main`.

## Staging and production are **separate** release gates

This snapshot proves neither an installed service nor that all seven independently
hosted origins work together simultaneously. It does not establish real DNS
ownership, trusted public TLS certificates, production-grade credentials, native
user mappings, paid app seats, Stripe entitlement processing, backup/restore,
tenant separation on deployed infrastructure, or a successful deployment.

Before *any* actual staging, independently validate the operator's distinct
seven approved HTTPS staging hosts, private one-time client registration/secrets,
the [offline configuration preflight](STAGING_PREFLIGHT.md), and the read-only
seven-origin probe. Preserve per-app data and rollback; perform live staging
MFA, session rotation, denial, role/license changes, child-only disconnect, central
parent logout and restart testing with synthetic accounts. **Never reuse** these
synthetic CI test credentials or mark them as customer-authorized seats.

All updates to this baseline require new immutable app/main and Workspace commit
references **and green CI for every app against that exact same Workspace commit**.
Track unresolved staging and production gates in [Workspace issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26).
