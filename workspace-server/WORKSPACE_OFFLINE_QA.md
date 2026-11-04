# DuckBio Workspace local QA (without GitHub Actions)

**Source-only developer tool; no deployment, billing or runtime enablement.**

On a clean checkout of the intended Workspace integration branch, run from `workspace-server`:

```sh
npm run qa:local
npm run qa:local:browser
npm run qa:local -- --json
```

The default command checks an exact clean Git HEAD, runs the existing `npm run check` (syntax checks) and `npm test` (complete Node test suite). Browser mode additionally runs all `browser-tests/*.test.mjs` sequentially with the existing Playwright dependency and installed Chromium. It does **not** automatically install packages, start remote services, create accounts or contact Stripe. If Playwright is missing, browser mode reports BLOCKED, never PASS.

`--json` prints a machine-readable summary with the Git SHA, exact-head status, stage status and exit codes. Exit status 0 = clean exact HEAD and every requested stage passed, 1 = failed stage, 2 = blocked/unknown Git HEAD/missing browser prerequisites. For local development only, `--allow-dirty` exercises a modified working tree but intentionally **cannot** return release-grade PASS. The runner checks that tests did not alter the Git working tree.

The tool is not evidence of real native APIs, Stripe LIVE subscriptions, cross-origin HTTPS staging or a production-ready seven-app authorization cutover. Review `SEVEN_APP_ACTIVATION_RUNBOOK.md` in draft PR #190 before any staging/production decision.
