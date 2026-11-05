# Native organization link audit table-loss guard

Source-only draft security change. The most recent native-link SQLite AUTOINCREMENT audit row is used as a binding generation. Losing the entire suite_identity_org_native_audit table can cause the same audit ID to recur after unlink/rebind, potentially reviving a stale native proof.

The helper runs inside the existing BEGIN IMMEDIATE transaction as the first-time global grant-version migration. It reserves PRAGMA application_id=0x4455434b (ASCII DUCK) as an independent, persistent SQLite header marker. Global grant generations retain PRAGMA user_version=1. The native marker is written only if organization/native link adapters are enabled.

- Fresh native-enabled DB: native tables and header marker created atomically.
- Existing legacy DB with BOTH native tables and no header: mark without changing audit IDs.
- Previously marked DB with either native table missing: refuse startup; never re-seed IDs.
- Half-present unmarked native schema: refuse startup.
- Native adapters disabled: standalone identity database behavior unchanged.

This protection does not survive a rollback of the ENTIRE SQLite database including its header. Retain coherent DB + WAL/SHM backups and invalidate outstanding parent sessions and child proofs on recovery. Never reset application_id to repair a damaged schema.

Local real SQLite regression tests: node --test tests/native-org-audit-schema-guard.test.mjs (8 cases). Full exact-head Workspace Node/Chromium QA, signed native ownership, independent LIVE billing and eight-service HTTPS staging remain mandatory. No runtime mount, merge or deployment authorized.
