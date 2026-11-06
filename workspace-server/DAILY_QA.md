# Daily isolated DuckBio QA

`.github/workflows/daily-isolated-qa.yml` must be merged into the repository default branch (`main`) before its schedule can run. This change does not merge itself, deploy services, or change the six application branches. GitHub can disable schedules on inactive public repositories; the repository owner must re-enable them if necessary. Hosted-runner billing/minute limits still apply.

## Default daily and manual checks

The workflow runs daily at **04:17 UTC** and through **Actions → DuckBio daily isolated QA → Run workflow**. A pull request changing this workflow also exercises the Workspace job. It uses GitHub-hosted Ubuntu 24.04 and Node.js 22 (a current patch release supporting `node:sqlite`).

From `workspace-server` it runs the existing `npm run check` and `npm test`. The latter includes the six-app synthetic PKCE/HTTP contract, identity, organization, session, authorization and communications regression tests. It currently has no npm dependencies to install. These synthetic contracts are separate from the real native app matrix below. An existing explicitly opt-in systemd test can remain skipped; the test runner reports that distinction.

Actual test processes run as the runner user in a fresh Linux network namespace with only loopback enabled, and an empty environment except the explicitly supplied local tool paths. They cannot reach external production, mail, billing or licensing endpoints. Disposable fixture databases are stored under the runner's temporary directory. Checkout and dependency downloads happen before entering isolation; checkout credentials are not persisted. Namespace setup failure is fatal: there is no fallback to unrestricted networking.

All required commands preserve their exit status through `tee` (`set -euo pipefail`). A failed command makes the Actions job fail. Logs and exact tested commits are uploaded with `if: always()` and retained for 14 days, including failed runs. Upload cannot be guaranteed if GitHub forcibly terminates a runner. Actions displays the underlying error output.

## Prepared six-app native integration matrix

The opt-in matrix runs the existing real native backend + real Workspace HTTPS Chromium suites for **CytoDuck, DuckNote, DuckTrain, DuckMan, DuckPipe and LabDuck**. It tests the Workspace revision selected by the workflow event against each app's current `main`; both exact SHAs are logged. No native branch is modified. At most two native jobs run concurrently; every enabled matrix row is required, and failures do not cancel the remaining rows.

The six repositories are private, so a normal repository-scoped `GITHUB_TOKEN` cannot read them. Before enabling the matrix:

1. Add repository Actions secret **`DUCKBIO_QA_READ_TOKEN`** with **Contents: read** access to those six repositories only (for example a fine-grained read-only PAT). Do not use a production/deployment token. It is used only by checkout with `persist-credentials: false` and is not supplied to test processes.
2. For daily native integrations, set repository Actions variable **`DUCKBIO_NATIVE_QA_ENABLED`** to `true`. For a manual run, select **`native_integrations`**. Selecting it without the source token is a hard error; it does not silently pass or skip that requirement.

The default daily Workspace job does not require this secret. Native integration is deliberately disabled until private source access is configured; a green Workspace-only run does not prove that the native matrix ran.

## Dependency preparation is NOT network-isolated (release blocker)

The native matrix's **test execution** is loopback-only, but its **preparation** is not: native `npm ci --no-audit --no-fund`, the pinned Playwright package download, Chromium/browser dependency installation, and DuckNote's apt packages run on the hosted runner **before** `isolate.sh`. In particular, native `npm ci` currently permits npm lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`) to execute with runner network access. The read-only checkout token is not intentionally passed to those scripts and checkout credentials are not persisted, but that does **not** prove the dependency-install phase is network-isolated or supply-chain-safe. A green matrix is not a release attestation of dependency integrity.

Before enabling the private-token native matrix or treating it as release evidence, independently review each of the six native `package-lock.json` files and the lifecycle/build requirements of all installed packages. Prefer reviewed `npm ci --ignore-scripts` only where the actual native build and test requirements have been validated; do not switch it on globally without checking native functionality. Pin and independently verify fetched browser/tool binaries and runner actions, or use a separately approved immutable offline dependency cache with checksums. Keep source-token scope to six private repositories with `contents:read`, keep the native job on trusted `main` only, and do not expose production secrets. Record exact source/dependency/tool hashes and test both expected success and deliberate failure of the resulting workflow. This unresolved preparation boundary must remain a **QA limitation**, not be described as full end-to-end isolation.

Native dependencies use `npm ci` where a lockfile exists; dependency-free apps need no install. Playwright **1.56.1** and Chromium are installed separately under the runner's temporary directory. CytoDuck's real frontend is built; DuckNote is built with `VITE_STORAGE_MODE=server` and uses a fresh PostgreSQL database initialized **inside** its isolated network namespace. Test-only PostgreSQL trust authentication is limited to that disposable namespace. No customer datasets, external services or existing databases are accessed. Other apps use their synthetic private SQLite fixtures. No browser/production/scientific qualification is implied beyond the automated assertions.
