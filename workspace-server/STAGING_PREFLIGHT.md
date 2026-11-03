# DuckBio Workspace: offline staging preflight

This is a **read-only configuration check**, not a deployment, network smoke test, production authorization, database migration, or permission to use live customers. It does not open SQLite, provision accounts, call billing, run a server or contact any app.

## Run against a private staging configuration

Store the same UTF-8 JSON `SUITE_*` string settings planned for the private Workspace broker in a file **outside public website files, GitHub Pages and app repositories**. On the Linux staging host restrict the file to its owner (`chmod 600`). Never commit it, paste its secrets into a GitHub issue or upload it as a CI artifact.

```bash
cd workspace-server
npm run staging:preflight -- --config /srv/duckbio-private/workspace-staging.json
```

The command exits **0 only if every local gate passes**; otherwise it exits nonzero, printing **only fixed error codes**, never client secrets, user IDs, database content, or config values. No outward connections are attempted.

The private JSON file must use string values for the runtime's settings:

- `SUITE_STAGING_ACK=synthetic-accounts-only` (explicit operator acknowledgement; it is **not** enforced by the runtime itself).
- `SUITE_MODE=broker`, `SUITE_BUILD_SHA=<the reviewed full 40-character Git commit>`, canonical HTTPS `SUITE_ORIGIN`, and either the same `SUITE_ISSUER` or no override.
- `SUITE_CLIENTS` is a **JSON-encoded string**, not a nested object. It contains exactly six independent private client registrations. Each has `id`, `appId`, `secret`, `nativeOrigin` and a single `redirectUris` entry matching `<nativeOrigin>/auth/callback`. Secret values must be private, unique and at least 32 characters.
- `SUITE_AUTH_DB_PATH`, `SUITE_IDENTITY_DB_PATH`, `SUITE_ORGANIZATION_DB_PATH`, `SUITE_COMMUNICATIONS_DB_PATH` and `SUITE_ASSET_ROOT` are distinct absolute private paths. They must never resolve through `docs` or `public_html`, including symlinks.
- Outbound owner alerts, mail providers, public contact handlers and Stripe (including TEST Checkout) must be **disabled** for this isolated, synthetic-only validation profile.

| Customer-facing app | Private registered `id` and `appId` |
| --- | --- |
| CytoDuck | `goflo` |
| DuckNote | `eel` |
| DuckPipe | `methpipe` |
| DuckTrain | `mantrain` |
| DuckMan | `duckman` |
| LabDuck | `limsman` |

## Additional release gates (not automated by this check)

1. Record an **approved staging-only** origin for Workspace and separate HTTPS origins for the six native apps. Do not infer that an old `celluloidconsulting.net` host or a GitHub Pages domain is deployable.
2. Pin exact `main` commit SHAs and green GitHub CI results for Workspace and all six apps. Verify that the installed package matches those SHAs and that callbacks use these exact native HTTPS addresses.
3. Set up a brand-new private environment using only synthetic accounts and an isolated organization; no production database, session, Stripe customer, live webhook, real Resend mail key or actual customer mapping.
4. Test login, callback/PKCE, app-specific access (Single, Mixed, Bundle), independent native MFA and roles, per-app admin dropdown edits, user invitations, `Buy users` review-only state, unread counts, child-only disconnect and global logout against **running** staging services.
5. Test denied roles, cross-organization isolation, mismatched native IDs, expired sessions, failed central revoke and network outages. Confirm that disconnecting one app does not sign out another or the Workspace parent account.
6. Document verified private DB backups and a **tested restore**, exact domain/TLS ownership, release procedure, telemetry and rollback. Review live billing/entitlement gates separately; a Stripe TEST observation never grants real app seats.
7. Request a separate explicit go/no-go approval before any production routing, real accounts, DNS change, hosting cutover, payment activation or migration. The offline PASS message is never a substitute for that approval.

Current repository status: source-only, with no claim of staging or production deployment.

## Anonymous HTTPS staging smoke (only AFTER staging servers exist)

The offline gate above validates configuration **without any network traffic**. Once the operator has explicitly provisioned private, isolated staging domains for Workspace and **all six** native apps, run the next optional check from a trusted operator machine:

```bash
cd workspace-server
npm run staging:smoke -- --config /srv/duckbio-private/workspace-staging.json --confirm-read-only-staging
```

The smoke command requires the same owner-readable, private, synthetic-only configuration (including reviewed commit SHA) and the explicit confirmation flag. It uses **only anonymous GET requests** with no cookies, credentials, request bodies, or redirect following. It does not create users, make purchases, launch browsers, or write to databases. Its stable PASS/FAIL output includes app IDs and fixed diagnostic codes only, not URLs, identities, tokens, response bodies or secrets.

It checks:

1. The central Workspace `/api/suite/health` responds over the exactly configured HTTPS origin with `status: ok`, `mode: local`, `configured: true`, no-store headers, and a build version matching `SUITE_BUILD_SHA`. If this fails, **no native app is contacted**.
2. Each of the six registered native HTTPS origins denies unsigned access to its private Workspace communications configuration with JSON HTTP **401 or 403**. This catches wrong-domain static HTML fallbacks, unexpectedly public config endpoints and missing native authorization routes. LabDuck uses its Node-specific `/api.php?action=workspace_communications_config` route.
3. DuckNote's public `/health` reports `ok: true` and `database: true`; LabDuck's `/api.php?action=health` identifies its **Node** runtime and schema version 1.

A failed probe is not automatically retried. Network access must be enabled and valid DNS/TLS already configured; otherwise the check fails safely. A PASS demonstrates **only these limited anonymous HTTPS contracts**, not end-to-end authenticated SSO, native user mapping, real paid entitlements, backups, restore or production readiness. Complete the additional manual release gates above separately. Do not use the command against live production/customer origins.
