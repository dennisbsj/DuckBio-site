# DataDuck as the seventh DuckBio Workspace app — integration contract

**Status (3 November 2026): SOURCE-ONLY CANDIDATE. No shared login, native session, payment, production release or staging installation has been authorized.**

## Product and ownership

- **App:** DataDuck, ID `dataduck`, repository `dennisbsj/DataDuck`.
- **Existing six app IDs remain unchanged:** `goflo`, `eel`, `methpipe`, `mantrain`, `duckman`, `limsman`.
- DataDuck remains an **independent scientific data, plotting and analysis app**, not Workspace and not DuckMan. Workspace owns central user accounts, organization membership and license administration; DataDuck owns native scientific data, project/tenant authorization and native role enforcement.
- **Native roles already implemented in DataDuck's local prototype:** `Admin`, `Analyst`, `Reviewer`, `ReadOnly`. Do not promote a Workspace organization admin to a DataDuck native Admin implicitly. Pending future customizable roles/permission overrides must preserve native server-side route enforcement.
- The active `Single`, `Mixed`, `Bundle` and verified LIVE subscription flows are **six-app commercial products today**. Simply adding a new app cannot alter existing customers' purchases, their bundles, seat quantities, discounts or billing. The DataDuck commercial price/Bundle inclusion and migration policy need explicit review before live purchase or checkout changes.

## What this source change does

1. Defines a stable DataDuck ID, known native role names, exact private HTTPS client/callback candidate and a source-only registration audit in `dataduck-integration-candidate.mjs`.
2. Exposes `DataDuck` as `upcomingApps` in the **private administrator organization overview**, with status `unreleased-integration-candidate` and `licensingAvailable: false`. The Workspace UI shows it as *Integration in progress* rather than inventing paid seats.
3. **Does not** append DataDuck to the six production `APPLICATIONS`, `SUITE_CLIENTS`, entitlement/identity grant allowlists, subscription drafts, live Stripe app mapping, or the six-app historical source QA lock. DataDuck role assignment, purchase, app connect, native session and data access must remain denied.
4. Adds negative source-level tests for malformed or reused seventh client secrets, invalid origins/redirects, absent seventh registration, cross-user/org entitlement mismatch, Stripe TEST/shadow entitlements, and current purchase/role rejection. A passing audit **never returns an access grant**.

## Actual integration work required before DataDuck becomes selectable

1. **DataDuck native readiness:** Review and merge the functionality currently in [DataDuck draft PR #1](https://github.com/dennisbsj/DataDuck/pull/1), which is *not* on the native `main` branch. Its v0.23 HTTP Workspace adapter is deliberately unmounted, uses a synthetic broker and test dispatcher, and does not protect the running scientific API. The real DataDuck server must enforce the Workspace session and native authorization on **every** scientific/project/export/derived-data/admin endpoint, including mid-request role, seat and organization revocation.
2. **Shared identity:** Add one dedicated private `dataduck` client registration with unique server-only secret, fixed approved HTTPS callback `<DataDuck native origin>/auth/callback`, PKCE S256, one-time state, explicit central-to-native user UUID and organization UUID linking, secure cookie handling, cross-tenant denial, MFA and revocation. Never link by email or copy role/organization assertions from the browser. Existing six clients must remain untouched.
3. **Licenses:** Implement independently verified per-user/per-organization **DataDuck-only** live entitlements with server-side paid seat capacity and revocation. A broker identity proof alone does **not** grant a seat. Require an approved seventh-app billing/Bundle policy before any paid grant. TEST Checkout, draft/subscription shadows and the new `upcomingApps` flag are never entitlements.
4. **Administration:** Move DataDuck from `upcomingApps` into the role dropdowns, app-specific user creation, user editing, Buy users, audit and custom-role/permission administration **only after** the actual seat+server authorization path has been tested. Native `Admin/Analyst/Reviewer/ReadOnly` permissions should map to the real DataDuck route policy; a Workspace custom role must not expand its native authority without explicit compatible native enforcement.
5. **Versioned staging:** The existing historical source lock describes **Workspace + six native apps = seven services/HTTPS origins**, not eight. Preserve it as verified six-app evidence; create a separately versioned **Workspace + seven native apps = eight origins** lock, source/secret isolation audit, Caddy routes, seven distinct native systemd services and exact QA runs. Do not rename old seven-service tests to eight or claim they include DataDuck.
6. **End-to-end acceptance:** Test real native DataDuck + actual private Workspace broker with synthetic users, trusted HTTPS, Chromium, real DB, correct license source, no implicit account creation, native role and permission edits, cross-org/identity denial, CSRF/Origin checks, replay/expiry, disabled users, broker outages, backup/restore and rollback. Then test **all seven native apps concurrently** with the broker and verify existing six still work. Never substitute stubs for that final proof.

## Explicit no-go

Until each step above has passed: no installation, purchase, production login, hosted connection, DNS/TLS, live customer account, database migration or change to six-app subscription products. The [Workspace integration issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26) and [DataDuck release issue #2](https://github.com/dennisbsj/DataDuck/issues/2) remain open.

The new contract is **preparation and visibility, not completed integration**.
