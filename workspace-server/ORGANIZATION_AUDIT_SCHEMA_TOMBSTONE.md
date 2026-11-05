# Organization authorization audit table-loss guard

Source-only security review. The verified LIVE native policy cursor relies on monotonically increasing AUTOINCREMENT IDs from organization_audit. Rebuilding this table after partial SQLite loss could reset those IDs; a later revoke/regrant with identical end state could match an old authorization generation.

Startup now performs a read-only audit-existence check under the same BEGIN IMMEDIATE write lock that protects base-schema initialization and session_organization_versions migration. It executes BEFORE CREATE TABLE IF NOT EXISTS can recreate organization_audit. The existing PR #208 PRAGMA user_version=1 migration marker distinguishes new databases from previously established schema. A genuinely old DB with both tables remains migratable without changing its audit IDs; a marked DB with lost audit, or a pre-marker DB with organizations but no audit, fails closed.

The change adds no customer billing, new login routes, native SSO grants, or staging deployment. Other independent audit tombstones remain unchanged. A full database rollback including its header cannot be distinguished; restore must invalidate old sessions, broker proofs and native credentials and use a coherent SQLite backup.

Regression QA: node --test tests/organization-audit-schema-guard.test.mjs (6 real SQLite cases, local Node 22.16.0). Full exact-head Workspace core/Chromium, signed real-native API, LIVE verified per-app seats, and eight independent HTTPS staging services remain mandatory before any merge or activation.
