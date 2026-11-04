# Workspace native backend candidate — isolated integration review (4 November 2026)

**Status: DRAFT ONLY.** This branch consolidates previously unmerged Workspace native identity and access-protection work and the latest `main` staging QA files. **No production, staging or login feature is enabled by this code integration draft.**

## Included sources

The source for this candidate is [#141](https://github.com/dennisbsj/DuckBio-site/pull/141) → [#145](https://github.com/dennisbsj/DuckBio-site/pull/145) → [#149](https://github.com/dennisbsj/DuckBio-site/pull/149) → [#166](https://github.com/dennisbsj/DuckBio-site/pull/166) → [#187](https://github.com/dennisbsj/DuckBio-site/pull/187). Historical tests and commits remain on their original branches and PRs. The independent [#144 backup rehearsal](https://github.com/dennisbsj/DuckBio-site/pull/144), Ed25519 QA [#188](https://github.com/dennisbsj/DuckBio-site/pull/188), signed ownership verifier [#150](https://github.com/dennisbsj/DuckBio-site/pull/150), native liveness QA [#148](https://github.com/dennisbsj/DuckBio-site/pull/148) and separate Stripe billing drafts **are not included**.

The code tree was reconciled against `main@fdc312ae44d4bacbc0a5e059860939635a392b5e` and `#187@d68ff7b5babfb075526777ca72a78de25167fc21`. Only `workspace-server/package.json` was changed on both lines of development. Integration uses current main `package.json` and retains both recent main QA script entries and the branch's additional broker/native syntax checks.

## Non-negotiable acceptance before merge

1. Run `cd workspace-server && npm run check && npm test` on this **exact merged candidate**, including Node 22 and 24 GitHub Actions. Historical PR CI is not sufficient.
2. Review migrations of existing private identity/organization SQLite tables; confirm no implicit email-based user link, seat grant, role elevation, and no modified legacy tenant data.
3. Prove the new native-access inspector and broker adapter stay **dormant, deny-only and fail-closed** unless explicitly wired after a separate design/security review; no source-stage synthetic result is entitlement.
4. Review all native role, seat, organization revision, PKCE issuance and revocation constraints and denial on missing native ownership; no automatic paid seats.
5. Reconcile independent signed Ed25519 native ownership proof and liveness QA branches separately, avoiding overwrite or changing their source/testing identities.
6. Confirm the seven-app plan is **not** implemented by this six-native identity stack: [activation runbook PR #190](https://github.com/dennisbsj/DuckBio-site/pull/190) is documentation only; DataDuck native PR #1 remains unmerged.
7. Require a later isolated eight-service HTTPS staging + real browser/API verification, backups/restore and explicit production go/no-go; do not deploy this branch.

## Merge strategy and scope

The proposed integration tree was formed by overlaying only the 17 non-conflicting `#187` changed files and a reconciled package manifest over the above exact `main` tree. Git history uses `main` and the exact #187 head as parents, preserving source ancestry and not changing either original branch. Staging/runtime/public website, Stripe entitlement and native applications remain unchanged from their respective sources. The source-only draft does **not** assert functionality or tests passing.
