# DuckBio Workspace: offline staging preflight

This is a **read-only configuration check**, not a deployment, network smoke test, production authorization, database migration, or permission to use live customers. It does not open SQLite, provision accounts, call billing, run a server or contact any app.

## Run against a private staging configuration

Store the same UTF-8 JSON `SUITE_*` string settings planned for the private Workspace broker in a file **outside public website files, GitHub Pages and app repositories**. On the Linux staging host restrict the file to its owner (`chmod 600`). Never commit it, paste its secrets into a GitHub issue or upload it as a CI artifact.

```bash
cd workspace-server
npm run staging:preflight -- --config /srv/duckbio-private/workspace-staging.json
```

**Runtime startup guard:** When the private Workspace server is started with `SUITE_STAGING_ACK` present (including a value loaded through `SUITE_ENV_FILE`), it validates the complete synthetic staging profile **before creating SQLite databases or initializing the broker**. An invalid, empty or misspelled acknowledgement now fails closed. This is an additional guard for deliberately marked staging environments, **not** a production-mode restriction and **not** a substitute for independently running this CLI preflight, verifying file permissions, ownership, DNS, TLS and staging isolation. Runtimes without that staging marker remain unchanged; do not treat omitting the marker as permission to bypass staging review.

The command exits **0 only if every local gate passes**; otherwise it exits nonzero, printing **only fixed error codes**, never client secrets, user IDs, database content, or config values. No outward connections are attempted.

The private JSON file must use string values for the runtime's settings:

- `SUITE_STAGING_ACK=synthetic-accounts-only` (explicit operator acknowledgement; it is **not** enforced by the runtime itself).
- `SUITE_MODE=broker`, `SUITE_BUILD_SHA=<the reviewed full 40-character Git commit>`, canonical HTTPS `SUITE_ORIGIN`, and either the same `SUITE_ISSUER` or no override.
- `SUITE_ORIGIN` and all six `nativeOrigin` values must be **clearly staging-labelled public-looking HTTPS names**, such as `https://staging-workspace.YOUR-DOMAIN` and `https://ducknote-staging.YOUR-DOMAIN`; these are placeholders, not deployed addresses. The check rejects ordinary production origins, retired `celluloidconsulting.net` hosts, loopback/IP literals, reserved/example domains, GitHub Pages and shared Pages-like hostnames, and non-default HTTPS ports. Labels `staging`, `stage` or `qa` must appear in a subdomain. This is **only a static string policy**, not DNS ownership, network reachability, TLS certificate verification or proof that an address is safe to visit. Validate all real hosts independently before any staging DNS or server changes.
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

## Generate a new private synthetic-only staging configuration (optional)

Once a **separate staging server and a domain owned/approved by the operator** are available, the private Workspace source can create an owner-only broker configuration without manually inventing or reusing six client secrets. This command does **not** provision a server, control DNS/TLS, register real user accounts, install native apps, send mail, or create databases.

On a trusted Linux staging machine, first create a private directory **outside all Git repositories and outside the public website** with permissions 0700. The existing directory must have no symlinks in its resolved path:

```bash
install -d -m 700 /srv/duckbio-private/staging
cd workspace-server
npm run staging:generate -- \\
  --base-domain YOUR-APPROVED-DOMAIN \\
  --private-root /srv/duckbio-private/staging \\
  --build-sha YOUR-REVIEWED-40-CHAR-WORKSPACE-COMMIT \\
  --confirm-synthetic-only
```

Replace the example domain and SHA with the **actually reviewed values**. For `--base-domain`, use the controlled parent DNS domain only (no protocol, paths or ports). The generator derives the seven staging-labelled hostnames `staging-workspace.<domain>` and `staging-{goflo,eel,methpipe,mantrain,duckman,limsman}.<domain>`. This is only an offline naming convention: **no address is assumed to exist or be owned simply because it passes validation**. Arrange DNS/TLS ownership separately before any network test.

The resulting `workspace-staging.json` contains a random 48-byte client secret for **each** native app and an independent one-time `SUITE_SETUP_TOKEN`. The file is owner-only (0600); the command does not print tokens or passwords, never overwrites an existing file (including a symlink), and removes incomplete temporary output after errors. Staging database and UI paths are defined but not created. The parent directory must already exist and be owner-only, and Git worktrees, `docs`, and `public_html` are rejected. Do not include the JSON or any extracted keys in version control, CI logs, support tickets, or screenshots.

Use the existing offline validator before any startup:

```bash
npm run staging:preflight -- --config /srv/duckbio-private/staging/workspace-staging.json
```

The private backend still requires a **separately reviewed copy** of the private Workspace UI in the configured `SUITE_ASSET_ROOT` before web access. Only configure a native app with **its own** client secret from the file; never give the full JSON to native apps or browsers. The central setup token must be securely removed from runtime configuration after the one-time synthetic administrator bootstrap. **Never point this generator, its keys or the resulting databases at real production services.**

Since regenerating would silently invalidate existing native app secrets, the generator deliberately cannot rotate an existing file. Any later SHA/configuration update or secret rotation requires a separate reviewed, backed-up procedure; do not delete the generated file to bypass that safeguard. The previous manual release gates and verified restore/rollback remain mandatory.

## Export exactly one native staging credential (offline, no deployment)

The synthetic central `workspace-staging.json` deliberately contains **six**
independent native client secrets. **Never install or share that entire broker
configuration with one native app.** Once the private central configuration
has passed preflight, export just one native registration at a time into a
**fresh, empty, separately owned 0700 destination** on a trusted operator
machine:

```bash
# Example for DuckNote (private paths are operator-selected examples).
install -d -m 700 /srv/duckbio-private/handoff-eel
cd workspace-server
npm run staging:native-handoff -- \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --app-id eel \
  --private-output-root /srv/duckbio-private/handoff-eel \
  --confirm-one-app-only
```

The command creates one **0600**, never-overwritten file,
`workspace-native-eel.json`, containing **only** the selected app's
`appId`, `clientId`, `clientSecret`, `workspaceOrigin`, `issuer`,
`nativeOrigin` and the precise registered `redirectUri`. It omits
the five other credentials, broker's `SUITE_SETUP_TOKEN`, central
database locations, account details, billing configuration and any
organization ID. It refuses existing output files, nonempty directories,
symlinks, unapproved/public paths, and equal or nested central/private
broker directories. It never connects to DNS, starts a server, enables
billing, or prints the secret or private paths.

Repeat with **separately created private destinations** for
`goflo`, `eel`, `methpipe`, `mantrain`, `duckman` and `limsman`.
Transfer each registration **only** to the corresponding native app
operator using a separately approved protected transfer or secrets
manager. Restrict each host's access to its own credential, and
securely delete the transient handoff file according to the
organization's reviewed key-handling procedure.

**This is a private registration receipt, not a runnable native environment
file.** The native application still needs its own isolated database,
application origin, independently configured **exact organization binding**
and any application-specific keys (e.g., DuckNote's encrypted vault key or
DuckMan's proof key). The local/native authorization and MFA checks must
continue to apply. Do not invent an organization ID or automatically grant
app seats; no purchase, user registration or runtime integration is performed
by this export. For any future secret rotation, use a separately approved
backup/rekey procedure rather than regenerating this output over a deployed
app. The subsequent seven-origin HTTPS smoke and authenticated staging
integration remain separate gates.

## Disposable SQLite recovery drill (no staging server or credentials required)

Before deploying a staging database or creating real DNS records, the private Workspace repository can exercise a **completely temporary synthetic recovery** using the same runtime and SQLite adapters. This is a local test of startup, native app isolation and **offline** backup/restore mechanics, not a copy of any existing installation:

```bash
cd workspace-server
npm run staging:recovery-drill -- --confirm-disposable-only
```

The command intentionally accepts **no source database path, config path, hostname, private key or customer identifier**. It creates an owner-only temporary directory, generates fresh synthetic six-app credentials, starts Workspace **only on 127.0.0.1**, and uses its real HTTP endpoints to bootstrap an imaginary administrator. It verifies no native app seats were granted. It shuts down Workspace before touching SQLite, creates verified binary copies of all four private SQLite databases (auth, identity, organizations, communications), restores the copies into a new empty temporary directory, then restarts the private Workspace runtime there. It confirms the original synthetic administrator can log in with the same test password and the synthetic organization survives while native app grants remain empty. It checks SQLite `PRAGMA quick_check` on source and copied files and deletes all temporary material at the end.

Every external network call in the drill is blocked. Although the synthetic configuration contains staging-labelled `duckbio.net` origin strings for validation, the process never resolves or contacts those names. No public website, live app, server account, external backup, private staging environment or production database is accessed.

**Important:** This exercise copies files only after the synthetic runtime has stopped and closed its databases. Copying SQLite files from a running service, especially a WAL-mode database, is **not** a safe backup plan. A real environment requires an operator-approved hot-backup/snapshot procedure, private encryption, access controls, retention, off-host backup verification, credentials/session-rotation review, recovery-point objectives and a genuine restoration test against the selected server. A PASS here is **not** proof that a live staging or production backup is safe, recoverable or deployed.

## Prepare the private Workspace web assets for a new staging installation

The current private Workspace UI includes the login/account entry pages and the implemented user-administration, messaging, owner and app-connection screens. **Static GitHub Pages is not the private backend.** Those web files must be copied into a fresh, owner-only private `SUITE_ASSET_ROOT` before first login can be tested on a staging server.

Use a trusted checkout of the exact **reviewed Workspace commit**. The private `workspace-staging.json` must contain that same complete 40-character SHA in `SUITE_BUILD_SHA`; do not use `main` loosely or mix a later untested source revision with the pinned six-app integration baseline. The Git checkout must have no uncommitted tracked changes or untracked source files.

```bash
cd workspace-server
npm run staging:preflight -- --config /srv/duckbio-private/staging/workspace-staging.json
npm run staging:prepare-ui -- --config /srv/duckbio-private/staging/workspace-staging.json --confirm-first-install
```

The asset installer refuses any invalid synthetic configuration, unreviewed or dirty Git checkout, non-private root, symlinked root, public Pages directory or preexisting `SUITE_ASSET_ROOT`. It copies the 14 explicitly reviewed private HTML/CSS/JS files and six existing source app SVGs, with 0700 directory and 0600 file permissions. It checks local script/style dependencies, writes a private SHA-256 integrity manifest and never touches SQLite, credentials, DNS, email, payment or the network. The operation creates **a new UI directory only** and never updates an installed one; if source copying fails, only the newly created incomplete directory is removed.

This is not a deployment script or a live release/rollback mechanism. It does not prove that the private backend is running or that HTTPS/TLS is configured. Before any staging launch, verify installed app packages, the tested broker/native SHA baseline, local service binding, server logs without secrets, reliable **backup/restore of live WAL-mode databases**, and the separate operator-controlled HTTPS proxy. UI rollouts and credential rotation require a future atomic release-directory switch and rollback review; do **not** delete a running asset directory to make this first-install command accept it.
