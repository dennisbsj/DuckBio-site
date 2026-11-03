# DuckBio — coordinated six-app source QA snapshot (2026-11-03)

**Status: six-app source integration tested in isolated GitHub Actions only. NOT deployed or staging-approved.**

This is a **reproducible test configuration**, not a release artifact, a subscription entitlement,
a live client registration, a backup, or an operator go/no-go. It pinpoints one fixed
reviewed Workspace source commit and the six independent native app commits that
passed their real-native + real-broker browser integration suites against it.

## Shared Workspace identity/account/organization broker

- Repository: `dennisbsj/DuckBio-site`.
- **Precisely tested Workspace commit:** `233ca6d376efa2fbddca042cea5106aae92679c0`.
- [Pinned central CI, Node.js 22 and 24 PASS](https://github.com/dennisbsj/DuckBio-site/actions/runs/41639036030).
- This candidate includes the offline staging source gate, but this record still certifies **source/CI compatibility only**, not a simultaneous seven-service installation. The six native browser/HTTPS workflows were rerun specifically against this candidate, rather than reusing test evidence from the older central snapshot.

This is **not necessarily the latest Workspace `main`**; any later central changes must
  be independently retested against all six native app versions before revising this snapshot.

## Native app `main` sources and evidence

| App | Immutable native commit | Coordinated central-version HTTPS evidence |
| --- | --- | --- |
| CytoDuck (`goflo`) | `47ee5236281f76ff82709eef47362a1b3ed7afc9` | [Actual native React/Node + real Workspace broker HTTPS Chromium](https://github.com/dennisbsj/CytoDuck/actions/runs/41680201936), [seven-origin HTTPS routing with five fake native stubs](https://github.com/dennisbsj/CytoDuck/actions/runs/41680202081), [build](https://github.com/dennisbsj/CytoDuck/actions/runs/41680202096) |
| DuckNote (`eel`) | `cef89cb8b3b21c7100d9035b03df161de75c4d11` | [React + Node + PostgreSQL + real broker Chromium](https://github.com/dennisbsj/DuckNote/actions/runs/41669072382), [full merged-main CI incl. real PostgreSQL/MFA/PKCE/HTTPS](https://github.com/dennisbsj/DuckNote/actions/runs/41669072517) |
| DuckPipe (`methpipe`) | `4c8479a3973137234bd63e650bd8178d0a1e9bd9` | [Actual native + real Workspace broker HTTPS Chromium](https://github.com/dennisbsj/DuckPipe/actions/runs/41680217552), [seven-origin HTTPS routing with five fake native stubs](https://github.com/dennisbsj/DuckPipe/actions/runs/41680217082) |
| DuckTrain (`mantrain`) | `fff8d5fdba9bfaf5b6f9ab658b7d8cd214290346` | [Native + real broker Chromium](https://github.com/dennisbsj/DuckTrain/actions/runs/41639939459) |
| DuckMan (`duckman`) | `a42f27148e9cbe51aec80e9f78bd905e6dfc9221` | [Native + real broker Chromium](https://github.com/dennisbsj/DuckMan/actions/runs/41639884085), [full verify](https://github.com/dennisbsj/DuckMan/actions/runs/41639884187) |
| LabDuck (`limsman`) | `3aff9ec7138000d4aa1120014d606db2585f45c6` | [Native + real broker Chromium](https://github.com/dennisbsj/LabDuck/actions/runs/41640060636) |

**DuckNote staging listener security update:** This snapshot incorporates
DuckNote PR #142: explicit `HOST=127.0.0.1` now binds its actual Express
HTTP server to loopback behind the seven-origin Caddy proxy, and the
DuckNote native staging preflight requires that exact host. The real
native/React/PostgreSQL + Workspace Chromium integration was re-run with
that binding and the revised DuckNote `main` commit; the other five
app revisions and common Workspace source are unchanged. An omitted
`HOST` deliberately retains historical behavior outside staging, so
operators must not treat unspecified binding as safe for private staging.

**DuckNote private staging runtime update:** Native PR #143 was merged into
DuckNote `main` at `cef89cb8b3b21c7100d9035b03df161de75c4d11`.
It adds an explicitly configured `DUCKNOTE_RUNTIME_DIR` outside the
immutable source tree for private staging, preserving legacy `tmp` behavior
when unset, rejecting unsafe/symlinked paths and destructive database reset
markers before server startup. This source-lock refresh is backed by the
**merged-main push** real React/Node/PostgreSQL + Workspace HTTPS Chromium
workflow [41669072382](https://github.com/dennisbsj/DuckNote/actions/runs/41669072382)
(workflow ID `405611188`), and the complete PostgreSQL, security and
native integration [CI run 41669072517](https://github.com/dennisbsj/DuckNote/actions/runs/41669072517).
Both succeeded for the exact source SHA and are not PR-only evidence.
The native HTTPS workflow still checks out the same pinned Workspace
`233ca6d376efa2fbddca042cea5106aae92679c0`; no other native source,
central source or commercial license is changed in this historical lock.
**The native staging systemd plan must supply a separate private 0700
`eel/runtime` and fail closed on old/unverified DuckNote code.** The
uninstalled seven-service staging update is tracked independently in
[PR #124](https://github.com/dennisbsj/DuckBio-site/pull/124).

**Independent CytoDuck and DuckPipe evidence correction:** The historical
source lock must refer to the **two-real-server native application + Workspace
SSO Chromium workflow** for each app, NOT reuse a seven-origin routing
workflow as if it verified login, PKCE, native sessions and authorizations
against the locked broker. The former CytoDuck lock improperly paired
seven-origin run 41657607526 with the unrelated native SSO workflow ID
405597927; that remotely verifiable mismatch has now been corrected.
[CytoDuck PR #217](https://github.com/dennisbsj/CytoDuck/pull/217)
and [DuckPipe PR #45](https://github.com/dennisbsj/DuckPipe/pull/45)
assert exact, pinned Workspace checkout commits before both test types and
reran both suites on the *same respective merged-main native SHAs*.
CytoDuck native HTTPS SSO [41680201936](https://github.com/dennisbsj/CytoDuck/actions/runs/41680201936)
and DuckPipe native HTTPS SSO [41680217552](https://github.com/dennisbsj/DuckPipe/actions/runs/41680217552)
each checkout historical Workspace broker
`233ca6d376efa2fbddca042cea5106aae92679c0`. These real two-origin
CI runs, **not** the Caddy routing runs, are recorded in the source lock.

The independent genuine-native Caddy seven-host checks also succeeded on
these precise native main SHAs: CytoDuck
[41680202081](https://github.com/dennisbsj/CytoDuck/actions/runs/41680202081)
(Workspace router `156afdcbddbe56832dcdd881db76f01140cad7ee`)
and DuckPipe
[41680217082](https://github.com/dennisbsj/DuckPipe/actions/runs/41680217082)
(Workspace router `5bcb15f8baeedd549ee518d55244f17df3ccee69`).
They verify each **one genuine native app + real Workspace** with
**five explicitly synthetic native routing stubs**; they are not proof of
six genuinely running apps together. Routing CI uses newer reviewed
Workspace router versions, independent of the older immutable SSO broker
lock. All other locked app revisions and the locked broker SHA are unchanged.

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

## Recheck the immutable evidence automatically

A machine-readable [source QA lock](six-app-source-qa-lock.json) records the exact
seven source commits, six native workflow paths and seven successful
GitHub Actions run IDs. It is verified by the
[read-only evidence auditor](six-app-source-qa-audit.mjs), whose security
regressions run as part of the Workspace core CI.

From the `workspace-server` directory:

```bash
npm run staging:source-audit
npm run staging:source-audit:remote
```

The first command requires no network and checks the manifest format, fixed
allowlisted app IDs/repositories, immutable SHAs and matching documentation.
The second adds **GET-only authenticated GitHub API** checks: the exact seven CI
runs must be completed, successful pushes on `main` with the recorded head
and workflow IDs; central CI must have passed Node 22 and 24; each native
workflow must check out the same immutable central source commit.

**Private repository boundary:** The Workspace source repository is public,
but the six native app repositories are **private**. The central repository's
ordinary GitHub Actions token cannot read their workflows and CI history.
Consequently, [the automatic GitHub Actions check](../.github/workflows/workspace-six-app-source-audit.yml)
performs **offline validation and unit tests only**; do **not** interpret its
green status as independent re-verification of private remote evidence.
To perform the complete remote read-only audit, an explicitly authorized
operator must provide a credential with **read-only metadata, Actions and
Contents access** to the six private app repositories, for example in a
trusted shell:

```bash
# Set DUCKBIO_QA_READ_TOKEN privately using an approved secret manager.
npm run staging:source-audit:remote
```

The command fails closed without the token, never prints its value, performs
only fixed allowlisted GitHub REST GETs and makes no repository changes.
Do not put this token in source, comments, output, artifacts, a public
workflow, or a shared CI secret without an explicit security review. The
connected GitHub app can also be used by an authorized reviewer to verify
the same evidence manually.

A green **historical evidence audit** proves only that these immutable
source revisions passed their recorded isolated CI workflows. It does
**not** prove that any repository's current `main` still equals the lock,
that a newer Workspace build remains compatible, or that all seven
services are running simultaneously. It does not verify real DNS/TLS,
app seats, native MFA, recovery, or a deployed staging environment.
Changing any source version requires **new verified CI evidence** and an
explicit new reviewed lock; never silently replace a commit with `main`.
