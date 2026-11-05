# DuckBio Workspace local QA (without GitHub Actions)

**Source-only developer tool; no deployment, billing or runtime enablement.**

On a clean checkout of the intended Workspace integration branch, run from `workspace-server`:

```sh
npm run qa:local
npm run qa:local:browser
npm run qa:local -- --json
npm run qa:local -- --expect-head=<40-hex-commit-SHA>
```

Use Node.js **22.16 or newer within major 22, or Node.js 24**. For browser QA only, install the exact CI browser automation version and Chromium locally:

```sh
npm install --no-save --no-package-lock playwright@1.56.1
npx playwright install chromium
```

The optional `--expect-head` flag refuses a checkout whose commit differs from the reviewed SHA, before running any tests. The command requires an actual `DuckBio-site/workspace-server` checkout, verifies that Git's top-level directory is the parent of `workspace-server` before and after QA, and refuses nested/replaced Git repositories. The default command checks an exact clean Git HEAD, runs the existing `npm run check` (syntax checks) and `npm test` (complete Node test suite). Browser mode additionally runs all `browser-tests/*.test.mjs` sequentially with the existing Playwright dependency and installed Chromium. It does **not** automatically install packages, start remote services, create accounts or contact Stripe. If Playwright is missing, browser mode reports BLOCKED, never PASS.

`--json` prints a machine-readable summary with the Git SHA, exact-head status, stage status and exit codes. Exit status 0 = clean exact HEAD and every requested stage passed, 1 = failed stage, 2 = blocked/unknown Git HEAD/missing browser prerequisites. For local development only, `--allow-dirty` exercises a modified working tree but intentionally **cannot** return release-grade PASS. The runner checks **both** that tests did not alter the tracked/untracked Git working-tree status and that `HEAD` still equals the original exact SHA after all tests. It strips inherited `GIT_DIR`, `GIT_WORK_TREE` and `GIT_CONFIG_*` environment overrides for its Git checks, so those cannot quietly point it at a different checkout. Moving HEAD to a different clean commit during a test now fails with a `git-head-integrity` stage, rather than reporting a misleading success against the original SHA.

The tool is not evidence of real native APIs, Stripe LIVE subscriptions, cross-origin HTTPS staging or a production-ready seven-app authorization cutover. Review `SEVEN_APP_ACTIVATION_RUNBOOK.md` in draft PR #190 before any staging/production decision.

**Scope of a PASS:** It is local source-level/test execution evidence for the reported Git commit on the local machine, not a cryptographic remote ref attestation. This local runner deliberately permits existing ignored build/runtime directories (for example local Playwright/node_modules) because they are needed to run tests. For a stricter **physical eight-repository source-only inventory**, use `staging-eight-source-gate.mjs` separately against fresh checkouts: that gate refuses ignored files, symlinked source, gitlinks and indirect `.git` metadata. Neither runner nor source gate grants a production seat, native SSO permission or release authorization.
