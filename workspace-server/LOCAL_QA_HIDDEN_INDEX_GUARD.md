# Git index integrity for exact-HEAD Workspace local QA

**Source-only DRAFT. No customer data, native login, billing, deployment or production activation.**

## Confirmed gap and real local reproduction

The offline `npm run qa:local` runner checked a clean `git status --porcelain`, a SHA and the canonical repository root, but Git can hide a **modified tracked file** when the index marks it with `--assume-unchanged` or `--skip-worktree`. Both can leave `git status` clean, so the QA runner could erroneously report exact-head success for modified source. This is distinct from #224's existing *eight-repository source audit* guard; it affects the **Workspace local test runner** itself.

An isolated local Git 2.47.3 test reproduced both cases with `workspace-server/app.mjs`: a modified file appeared as `h` (assume-unchanged) or `S` (skip-worktree) in `git ls-files -v -z`, while `git status --porcelain` was empty. Removing the flags restored the dirty Git status.

## Fail-closed change

`scripts/local-qa.mjs` now reads NUL-delimited `git ls-files -v -z` **before and after** running Node/Chromium test stages. Every tracked file must have an ordinary `H ` index entry and the index listing must be identical at both checkpoints. Unexpected flags, empty/truncated listing, an unreadable index or flags changed during the run prevent exact-HEAD QA success.

- Before tests, the command returns blocked without executing any scripts. `--allow-dirty` cannot override a hidden-index condition.
- After tests, a changed/masked listing causes an explicit `git-index-integrity` failure and clears `exactHead`, even if the HEAD SHA and `git status` look unchanged.
- Existing canonical-root, inherited `GIT_*` sanitization, git HEAD, clean status and exact pin controls remain intact.
- The check is intentionally stricter than typical sparse checkouts. An operator must create a fully expanded, clean reviewed checkout before claiming full exact-HEAD QA; skip-worktree files are not acceptable evidence for this release gate.

New unit/real Git regression cases check initial and in-flight masking, both index flags, NUL robustness, and a real parent-`DuckBio-site/workspace-server` layout. The standalone Git primitive reproduction has passed. These new Workspace source tests are **not yet run on the exact PR HEAD**, so no full CI pass is claimed.

Requires independently reviewed exact-head Node22/24 and Chromium execution; source-only code is not production authorization. The eight native repositories and DataDuck staging remain under the existing release plan.

## Additional Git source integrity: parent-scope and tracked symlinks

Git status from the `workspace-server` working folder checks the overall repository, but `git ls-files` from that subfolder only enumerates files **under that folder**. I reproduced a hidden mutation of the tracked root-level `suite-permissions.json`: ordinary `git status` was empty and subfolder `ls-files -v` omitted the parent policy entirely. The local QA guard now performs its index and mode enumeration from the canonical **parent repository root**, still verifying the same root before and after the test stages. Parent policy files cannot escape inspection.

Likewise, a tracked `120000` Git symlink to an outside `.mjs` file remains clean in Git after the external target is modified; Node executes the changed external bytes. The guard now enumerates `git ls-files --stage -z` and accepts only normal stage-0 regular `100644` or executable `100755` blobs, rejecting tracked symlinks (`120000`), submodules (`160000`), conflict-stage entries, empty/truncated output and source mode/index differences after tests. The current Workspace repository snapshot has no nonregular blobs under `workspace-server/`; this restriction is intentional for release QA.

A focused isolated Node22.16/real Git exercise confirmed that the full repository scan identifies a masked parent policy that a subfolder scan misses, and that the source-mode scan identifies tracked symlinks despite a clean Git status. This is limited **primitive verification**, not the full authored exact-HEAD CI/browser suite. All new QA regression source remains unexecuted on the private complete checkout.
