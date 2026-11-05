# Workspace six-native signer source QA — integration from #188

**Status: dormant/offline only.** This PR preserves immutable known-answer vectors integrated in #195 and adds the missing *offline dependency chain* required to run the genuine native six-app source check in a reviewed environment.

The following six files were copied unchanged from the independent #188 QA branch:
- `six-native-signer-interoperability.mjs`
- `six-native-real-https-rehearsal.mjs`
- `six-native-mtls-sidecar-rehearsal.mjs`
- `six-native-ownership-lookup-interoperability.mjs`
- `six-native-known-answer-audit.mjs`
- `tests/six-native-known-answer-audit.test.mjs`

Safety model: reject unknown repository remotes, unexpected source SHA, symlinks, untracked/dirty files and mismatched tracked Git blob identities BEFORE importing any native signer/lookup/mTLS module. The imported signer harness uses ephemeral Ed25519 keys and synthetic account/tenant/ownership data. DuckNote's native PostgreSQL integration in the imported lookup QA uses a strict test simulator rather than actual PostgreSQL.

The authenticated HTTP staging, native app resource permissions, LIVE per-app payment allocations, DataDuck native integration, rollback-safe revocation, secrets/TLS provisioning and eight-service release decisions remain **open and unapproved** under PR #190. The presence or success of the operator tool **does not** turn on any native service or login route.

This source-only PR must pass `npm run check` and `npm test` on Node 22 and 24; an operator later needs to run the command from `NATIVE_OWNERSHIP_KNOWN_ANSWER_VECTORS.md` on clean commit-pinned six native checkout trees. A green public GitHub Actions run is not evidence of that operator run.

## Manual GitHub Actions source check (private repositories)

All six original native repositories are private. The regular `DuckBio-site` GitHub Actions token cannot read them; an automatic attempt on the PR failed in the **clone step**, before any signer proof ran. This is an access-control boundary, not a signer compatibility test failure.

The optional `.github/workflows/workspace-six-native-genuine-signer-qa.yml` is now **manual-only** (`workflow_dispatch`) and requires `confirm_read_only_source_audit: true` plus a separately approved `DUCKBIO_NATIVE_READ_TOKEN` repository secret. Any fine-grained token must have **read-only contents** access to **only** CytoDuck, DuckNote, DuckPipe, DuckTrain, DuckMan and LabDuck, and must not grant write/Actions/administration privileges. The credential is injected into the checkout step only; the signer test step does not receive it.

Do **not** configure or trigger this job from an unreviewed branch. Workflow availability may require a separately reviewed workflow version on the default branch. The original PR did not create or configure a secret or activate the job. If the required secret, repository authorization or operator confirmation is absent, this real-source check remains **BLOCKED**, not passed. No production keys or native databases are required for this offline test.
