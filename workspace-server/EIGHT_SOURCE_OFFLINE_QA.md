# Offline eight-source Workspace + seven-app Git audit

This is **not** a runtime, deployment, Stripe, domain, native-policy or native-account readiness check. It is a separate check from the historical six-app source lock.

Place **eight local clean Git checkouts** in a private directory, with exact folder names `DuckBio-site`, `CytoDuck`, `DuckNote`, `DuckPipe`, `DuckTrain`, `DuckMan`, `LabDuck`, `DataDuck`. Use repositories under `dennisbsj/`; avoid symlinks, Git worktrees or additional directories. The `.git` entry must be a physical Git metadata directory within each checkout, not a symlink or a gitfile pointing elsewhere. Track only regular files (no tracked symlinks or submodule gitlinks) in this strict source snapshot.

Prepare a private JSON proposal with **exactly** two keys: `stagingDomain` (the proposed DNS suffix, e.g. `duckbio.net`) and `entries`. Each entry must have exactly `id`, `repo`, `sha`, `origin`, `callbackUri`, and `sourceStatus`. Use all eight slot IDs from `staging-eight-origin-candidate.mjs`, with `https://staging-<id>.<stagingDomain>` and `/auth/callback` for native apps; Workspace callback must be null. Sources are labeled `draft` or `merged-main` **as untrusted proposals only**, not verified publication claims.

From `workspace-server` run:

```sh
node staging-eight-source-gate.mjs --proposal /private/path/eight-source-proposal.json --sources-root /private/path/eight-clean-checkouts --confirm-offline-only
node --test tests/staging-eight-source-gate.test.mjs
```

The audit compares exact Git commit IDs, repository root, allowed GitHub remote, clean tracked/untracked/**ignored** status, a regular-file Git index (reject tracked symlinks, unresolved index entries and submodules), real physical `.git` directories, unique physical directories and all eight expected source slots. It returns a failure for any missing or mismatched checkout. It never fetches code, creates services, deploys, installs dependencies, handles secrets or provisions an account.

**A PASS proves only that the inspected local Git metadata, commit IDs and regular-file index satisfy the operator-supplied source proposal, and that Git reports no modified, untracked or ignored files.** It is **not** an independent byte-by-byte inspection of data outside the Git index (for example hydrated LFS content), a guarantee of remote authenticity or an executed native application. This deliberately strict check requires **fresh clones before installing dependencies**, because local ignored build artifacts (including `node_modules`) cause a failure. It does not establish that each SHA is remote `main`, CI-tested, safe, independently reviewed, backed by LIVE per-app subscription payments, connected to real DataDuck resource authorization, or exercised behind eight distinct HTTPS origins. Before any staging activation, satisfy all gates documented in draft #190 and issue #26.

The four additional negative regression fixtures reject: an apparently clean but tracked source symlink; an executable `.mjs` ignored by `.gitignore`; a Git working tree whose `.git` entry redirects to an external Git metadata directory; and a staged submodule/gitlink. Even a passing eight-repository audit must not be used to mint SSO proofs or enable DataDuck.
