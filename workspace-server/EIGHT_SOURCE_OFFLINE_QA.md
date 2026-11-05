# Offline eight-source Workspace + seven-app Git audit

This is **not** a runtime, deployment, Stripe, domain, native-policy or native-account readiness check. It is a separate check from the historical six-app source lock.

Place **eight local clean Git checkouts** in a private directory, with exact folder names `DuckBio-site`, `CytoDuck`, `DuckNote`, `DuckPipe`, `DuckTrain`, `DuckMan`, `LabDuck`, `DataDuck`. Use repositories under `dennisbsj/`; avoid symlinks or additional directories.

Prepare a private JSON proposal with **exactly** two keys: `stagingDomain` (the proposed DNS suffix, e.g. `duckbio.net`) and `entries`. Each entry must have exactly `id`, `repo`, `sha`, `origin`, `callbackUri`, and `sourceStatus`. Use all eight slot IDs from `staging-eight-origin-candidate.mjs`, with `https://staging-<id>.<stagingDomain>` and `/auth/callback` for native apps; Workspace callback must be null. Sources are labeled `draft` or `merged-main` **as untrusted proposals only**, not verified publication claims.

From `workspace-server` run:

```sh
node staging-eight-source-gate.mjs --proposal /private/path/eight-source-proposal.json --sources-root /private/path/eight-clean-checkouts --confirm-offline-only
node --test tests/staging-eight-source-gate.test.mjs
```

The audit compares exact Git commit IDs, repository root, allowed GitHub remote, clean tracked/untracked status, unique physical directories and all eight expected source slots. It returns a failure for any missing or mismatched checkout. It never fetches code, creates services, deploys, installs dependencies, handles secrets or provisions an account.

**A PASS proves only that the locally checked-out source bytes match the operator-supplied commit claims.** It does not establish that each SHA is remote `main`, CI-tested, safe, independently reviewed, backed by LIVE per-app subscription payments, connected to real DataDuck resource authorization, or exercised behind eight distinct HTTPS origins. Before any staging activation, satisfy all gates documented in draft #190 and issue #26.
