# Offline native cross-store process crash drill (DRAFT)

This is an **isolated, synthetic-only fault-injection acceptance test**, stacked on the read-only dual SQLite snapshot auditor in [draft PR #159](https://github.com/dennisbsj/DuckBio-site/pull/159) and the opt-in SQLite final-commit write fence in [draft PR #158](https://github.com/dennisbsj/DuckBio-site/pull/158).

## Purpose

Verify actual OS process death with two separate Workspace SQLite files. All input is generated inside private disposable directories by the test. There are no production databases, native applications, real Stripe calls, browser routes, broker sessions, or DataDuck changes.

The test-only `tests/fixtures/native-two-store-crash-worker.mjs` reopens disposable identity and organization SQLite stores with the unmounted session-bound provisioner. Its private adapter returns **synthetic** trusted native ownership and synthetic LIVE-shaped subscription evidence. The child process deliberately calls `process.exit` in either of two critical positions:

1. **Exit 71: BEFORE identity commit**, immediately after obtaining the organization SQLite `BEGIN IMMEDIATE` fence. No canonical native link or audit row may exist. The OS must release the organization lock.
2. **Exit 72: AFTER identity commit**, when the provisioner's `finally` starts releasing the organization write fence. Exactly one canonical native link and one identity audit row must survive. The OS must release the lock even though the release method did not run to completion.

The parent then opens each actual SQLite DB, verifies integrity/foreign keys, checks exact link and audit counts, and asserts the ability to start a new `BEGIN IMMEDIATE` on **both** files. The recovered private read-only snapshot diagnostic from #159 is invoked on fresh, independent `VACUUM INTO` copies, with mode 0600; it must **never authorize recovery, login or licensing**, even for consistent pairs. A fresh synthetic signed-proof-like *test* retry must be idempotent after a successful commit; after the pre-commit crash it must create one link, not duplicates. Finally, the parent suspends a target user after a post-commit crash and proves the offline snapshot auditor flags the stale mapping and refuses approval.

## What a passing test does NOT prove

- **No real signed Ed25519 or native ownership endpoint is used in this crash drill**; the worker uses an explicit synthetic-only callback. Separate signed-protocol tests in earlier draft PRs cover the Ed25519 byte contract.
- A crash-robust all-or-nothing distributed transaction across SQLite WAL files **is not established**. The drill injects two deterministic process crashes at the final fenced commit boundary; it does not cover every kernel/power outage, partial disk flush, corrupt filesystem, or backup-pair skew.
- No real production tenant and payment ledger, native app ACL, HTTPS SSO, recovery approval, customer account or external hosting is accessed.
- A clean offline snapshot audit is only an inventory; actual recovery needs trusted new native identity attestation, verified live subscription reconciliation, operator review, stage acceptance and documented restore policy.

Keep the test-only worker **out of production bundles and all runtime imports**. Do not merge independently without coordinating #158/#159 and resolving #140. All PRs remain draft, unmerged, undeployed.
