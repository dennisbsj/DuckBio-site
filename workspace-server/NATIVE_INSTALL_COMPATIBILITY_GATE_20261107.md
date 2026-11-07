# Native npm lifecycle-denial compatibility gate (source-only; 7 Nov 2026)

**Status: NOT RUN / NOT RELEASE-APPROVED.** This review gate belongs to the unmerged daily isolated QA draft chain (#252 and predecessors). It is not a claim that native build, native API authorization, or exact-head release QA passed.

## Security boundary

The six-native integration job currently downloads native dependencies *before* entering its `unshare --net` test namespace. Draft #252 changes that online step to `npm ci --ignore-scripts --no-audit --no-fund`, preventing package lifecycle hooks from running during install. This must not be reverted merely to make a build green. A successful install is **not** a successful native runtime test. Lockfile checks and post-install hashes are not a substitute for preapproved package provenance. The Playwright browser harness and PostgreSQL OS packages are separate online preparation risks.

## Required exact-source matrix

For **CytoDuck**, **DuckNote**, and **LabDuck**, independently obtain each repository's *current reviewed commit SHA* using read-only access; do not reuse a moving `main` ref as evidence. Record `git rev-parse HEAD`, `git status --porcelain=v2 --untracked-files=all`, `git ls-files --stage`, `node --version`, `npm --version`, `npm config get script-shell`, `npm config get node-options`, and the exact SHA-256 of `package-lock.json` before any install. Inspect `NODE_OPTIONS`, `NODE_PATH`, `npm_config_node_options`, `NPM_CONFIG_NODE_OPTIONS`, and user/global/project npmrc. Treat unexpected inherited execution settings, index changes, or dirty source as FAIL, not a warning.

Run in a disposable, non-customer checkout and an approved sandbox with no production secrets. Under **both Node 22 and Node 24**, invoke the native install explicitly:

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

Do not interpret npm's exit code alone as build proof. Perform each app's actual documented build/test commands with the required disposable database and loopback fixtures; capture stdout, stderr, exit codes and tool versions. For CytoDuck and DuckNote, prove the Vite/esbuild executable can build and the resulting app starts and serves its expected synthetic HTTPS workflow. For LabDuck, prove the `@node-rs/argon2` native module loads and completes a real hash/verify roundtrip in a disposable runtime, **and** run the app's own authentication/authorization regression tests. If any native module requires a lifecycle hook, stop and propose an independently reviewed, offline/sandboxed build strategy rather than enabling arbitrary online scripts.

After each test, record the full Git tree/index state and compare with the pre-test snapshot. Clearly distinguish expected ignored build outputs from tracked/index changes. Confirm the precise native SHA did not move during testing.

## Workspace integrated release gate (separate from the native matrix)

On an exact, clean DuckBio-site source checkout at a **freshly verified** commit SHA, execute directly from `workspace-server`:

```sh
node scripts/local-qa.mjs --expect-head=<verified-SHA> --json
node scripts/local-qa.mjs --browser --expect-head=<verified-SHA> --json
```

Require actual parseable JSON reports with every required stage accounted for, independently on Node 22 and Node 24, including Chromium for the browser run. Do not accept `npm run qa:local` as substitute: inherited npm script-shell, workspace selectors or node-options may falsify the wrapper's status. Verify the entire Git source tree and index before and after the run, not only `git status` output.

**No hosted CI** until remaining Actions capacity is explicitly verified. No merge to main, real Stripe transactions, LIVE licensing, customer access, DNS or deployment without independent native ACL/MFA/paid-seat enforcement evidence, cross-process SQLite ABA/restore QA, and complete private eight-service HTTPS/mTLS staging plus explicit release approval. DataDuck remains unmerged, inactive and unsaleable; do not edit its native repository in this lane.

## Evidence required in issue #26 and activation plan #190

For each attempted native checkout, log repository, exact commit SHA, Node/npm version, lockfile digest, install/build/runtime test commands, actual result and artifact location; include any blockers. Report the two direct Workspace JSON results separately and explicitly mark absent stages **NOT RUN**. A synthetic fixture or source inspection must never be described as an integrated release pass.
