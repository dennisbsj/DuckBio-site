# DuckBio Workspace — current seven-repository staging SOURCE candidate (2026-11-03)

**Status: all six native apps passed separate real-native HTTPS integration CI against the identical, pinned Workspace source. This is NOT seven simultaneous deployed services.**

This candidate is a separate, later source snapshot. The historical baseline in [SIX_APP_SOURCE_QA_BASELINE.md](SIX_APP_SOURCE_QA_BASELINE.md) and [six-app-source-qa-lock.json](six-app-source-qa-lock.json) is preserved unchanged. Neither record is an authorization to provision real customers, enable billing, install native apps, change DNS, or deploy production.

## Reviewed central source

- Repository: `dennisbsj/DuckBio-site`.
- Pinned Workspace SHA: `233ca6d376efa2fbddca042cea5106aae92679c0`.
- Node.js 22/24 CI: https://github.com/dennisbsj/DuckBio-site/actions/runs/41639036030 (completed successful push to main).

## Six independently verified native applications

| App and native ID | Immutable source SHA | Real native + real Workspace HTTPS CI |
| --- | --- | --- |
| CytoDuck (`goflo`) | `dad05d5b9e8ac0cf3372c4526d9c4d941960742c` | [Successful main CI](https://github.com/dennisbsj/CytoDuck/actions/runs/41639968678) |
| DuckNote (`eel`) | `73413e6378a0650c3525184a1311cf828be593ce` | [Successful main CI](https://github.com/dennisbsj/DuckNote/actions/runs/41640370147) |
| DuckPipe (`methpipe`) | `7061981b0b3b1fdab23fffe2eddb5f3730901cea` | [Successful main CI](https://github.com/dennisbsj/DuckPipe/actions/runs/41639842792) |
| DuckTrain (`mantrain`) | `fff8d5fdba9bfaf5b6f9ab658b7d8cd214290346` | [Successful main CI](https://github.com/dennisbsj/DuckTrain/actions/runs/41639939459) |
| DuckMan (`duckman`) | `a42f27148e9cbe51aec80e9f78bd905e6dfc9221` | [Successful main CI](https://github.com/dennisbsj/DuckMan/actions/runs/41639884085) |
| LabDuck (`limsman`) | `3aff9ec7138000d4aa1120014d606db2585f45c6` | [Successful main CI](https://github.com/dennisbsj/LabDuck/actions/runs/41640060636) |

All six workflow files at these native commits explicitly checkout the **same immutable Workspace SHA** above. The validations use isolated, synthetic CI accounts and app storage, loopback HTTPS test servers and a real central Workspace broker. DuckNote's run uses Node, React and PostgreSQL; it does **not** attest to DuckNote's separate PostgreSQL-to-SQLite migration. The six independent jobs did **not** run concurrently on one host, share one seven-origin proxy or demonstrate shared paid-license operation.

## Candidate audit (read-only)

```bash
cd workspace-server
npm run staging:candidate:audit
# Optional: authorized read-only GitHub verification of exact run IDs and native workflow pins
DUCKBIO_QA_READ_TOKEN='YOUR_PRIVATE_READ_ONLY_TOKEN' npm run staging:candidate:audit:remote
```

The offline command checks lock schema and correspondence with these documented immutable commits and CI run IDs. The optional remote auditor checks all seven workflows and requires complete success on the exact SHA from a `main` push; it rejects later, earlier or merely pending CI. Do not print or commit the token. The six native repositories may be private and an unauthenticated GitHub API request is not proof of failure or success.

**Before constructing an actual staging candidate:** Checkout these exact seven commits into separate, owner-only source directories, use a private Workspace config with `SUITE_BUILD_SHA` set to the pinned Workspace SHA above, and run the offline seven-checkout gate with the explicit `--candidate-source-lock` option. This selects this candidate lock without changing the immutable historical baseline; it is an optional local source-readiness gate, not an installer.

```bash
npm run staging:sources -- --config /srv/duckbio-private/staging/workspace-staging.json --sources-root /srv/duckbio-private/seven-sources --confirm-offline-sources --candidate-source-lock
```

Real staging remains blocked until seven isolated HTTPS services are provisioned, their app keys handed out independently, strict organization/native role mappings and MFA are configured, and **simultaneous** login, PKCE, role isolation, entitlement, logout, database backup and rollback are proven with synthetic accounts. Static readiness does not prove public DNS ownership, TLS certificates or customer-safe production operation.
