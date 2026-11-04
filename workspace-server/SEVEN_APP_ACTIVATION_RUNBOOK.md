# DuckBio Workspace activation sequence — seven native apps

**Status on 4 November 2026: NOT ACTIVATED.** This is a planning and review document, not evidence that a staging server exists, a successful deployed release, or approval to activate accounts, payment, DNS or production traffic.

The target is **Workspace + seven native apps = eight distinct services and eight independent HTTPS origins**: CytoDuck (`goflo`), DuckNote (`eel`), DuckPipe (`methpipe`), DuckTrain (`mantrain`), DuckMan (`duckman`), LabDuck (`limsman`), and DataDuck (`dataduck`). Workspace is a distinct shared identity/organization/seat administration service; DuckMan is document control, not Workspace.

This runbook adds **no runtime code**, no feature flag, no staging deployment and no purchase authorization. It does not revise the historical seven-service *Workspace + original six apps* source locks or claim those tests cover DataDuck.

## What activation means

| Milestone | User-visible effect | Authorizing evidence |
| --- | --- | --- |
| Source candidate | New code and tests may be reviewed in GitHub; no new sign-in or seats | PR reviews, exact code SHAs, green CI for every relevant component |
| Private staging | A synthetic test user may sign in to a separate Workspace origin and reach independently running native test apps | All eight real services installed on an approved private host, controlled HTTPS, synthetic separate databases, real authenticated end-to-end acceptance |
| Production | Real organization users can sign in and access only individually licensed apps | Separate reviewed go/no-go after staging, native permission/seat enforcement, verified billing and recovery, operational readiness and rollback |

**Do not confuse a GitHub Pages website update, a merged PR, a synthetic `PASS`, a UI `upcomingApps` card, or a Stripe TEST checkout with activation.** A staging host has not been demonstrated in this repository. No publicly accessible production service should be assumed.

## Gate A — source-only architecture and security

- [ ] Freeze an independently reviewed, **new eight-service source manifest** with exact `main` commit SHAs, workflow paths and successful CI for Workspace and all seven native apps. The original six-app locks must remain historical, immutable evidence.
- [ ] Require DataDuck's native scientific backend and authorization to be reviewed, merged to its own `main`, and able to deny unauthorized access to every project, measurement, export, derivative analysis and admin API. Do not modify DataDuck from the Workspace integration lane without coordinating its native owner.
- [ ] Implement and verify seven unique server-only client registrations with fixed HTTPS callbacks, PKCE S256, single-use state/code, secure native sessions, exact native user UUID/organization UUID mapping and cross-tenant denial. Matching email addresses must not create an identity link.
- [ ] Complete organization-specific standard and custom Workspace roles, app-specific permission edits and **native server-side enforcement** for all seven apps. UI hiding alone is not authorization; a Workspace admin is not automatically a native DataDuck Admin.
- [ ] Use a verified LIVE, server-enforced **per-app paid-seat contract**, including purchase quantity, assignment, revocation, term expiry and app-specific commercial policy. Explicitly decide how DataDuck affects Single/Mixed/Bundle pricing, new purchases and grandfathered six-app subscriptions. No implicit upgrade, free DataDuck entitlement, Stripe TEST grant or silent customer migration.
- [ ] Verify session removal, user disablement, role/permission downgrade, paid-seat removal, native MFA and native authorization against stale, replayed, concurrently edited and disconnected sessions; fail closed when broker or authoritative native policy is unavailable.

## Gate B — isolated private staging (never public GitHub Pages)

- [ ] Obtain approval for a private non-production Linux host and own eight explicit staging-labelled DNS/HTTPS origins with separate certificates/credentials. No retired cHosting endpoint, public `docs/` or real customer secrets/database.
- [ ] Generate and review **new versioned eight-service** systemd/Caddy/private config plans; the existing seven-service templates, staging audits and port/secret manifests are for **Workspace + six apps only**.
- [ ] Run the eight actual native/Workspace processes with isolated service identities, distinct native databases (DuckNote PostgreSQL; other native stores as applicable), owner-only secrets, exact source SHAs and valid HTTPS. No synthetic HTTP substitute counts as a real native service.
- [ ] Test two disposable organizations and multiple users in genuine browsers and against the seven actual APIs: login, PKCE/replay, native MFA, app launch, custom role edits, permission removals, per-app seats, no-seat/expired-seat denial, cross-tenant isolation, child-only disconnect, global logout, stale sessions, account disablement, outages and network failure.
- [ ] Show that a default-deny native API rejects an otherwise valid Workspace login with no matching native membership **or** no verified paid seat. Confirm purchasing/assigning one app does not change another app's access or existing six-app bundles.
- [ ] Verify actual encrypted/private backup, restore to a clean private host, alerting, auditing, rollback, TLS expiry/rotation and service restart/recovery. Synthetic, offline SQLite drills and anonymous HTTP `401` do not replace these checks.
- [ ] Record independent reviewers, dated test evidence, exact eight deployed SHAs, environment identity, unresolved risks and release decision.

## Gate C — production authorization

- [ ] Review licensing terms, DataDuck pricing, contractual/consent implications and verified LIVE Stripe webhook/correlation/seat accounting in a separate live environment. Reversals and billing changes may not silently confer paid seats.
- [ ] Require **explicit** operator go/no-go approval for production, after the complete Gate A and B evidence is reviewed. Do not use a CI pass or documentation checkbox as the approval.
- [ ] Deploy by controlled release with backups, monitoring and rehearsed rollback; confirm real same-origin HTTPS sessions and native app isolation. Production account creation, payments, DNS and traffic must remain unchanged before this approval.

## Current verified blockers / next handoff

1. [Workspace issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26) remains open for shared identity, effective roles, licenses and native authorization.
2. [DataDuck draft PR #1](https://github.com/dennisbsj/DataDuck/pull/1) is not merged to the native `main`; its own scientific/backend integration and releases are owned in the separate DataDuck conversation. The current [DataDuck candidate contract](DATADUCK_SEVENTH_APP.md) explicitly has `productionEnabled:false`, `stagingEnabled:false`, and never grants licenses.
3. The genuine [seven-service staging witness](SEVEN_GENUINE_STAGING_ACCEPTANCE.md) covers Workspace **plus six** native apps only and states it has not run against a real approved staging host; no eight-service evidence exists yet.
4. The [independent six-native database/mTLS CI QA](SIX_NATIVE_REAL_DATABASE_MTLS_CI_QA.md) records stronger six-app evidence, not the combined seven-native deployment or paid-seat rights.

**Next admissible activation:** an approved *private test environment* once Gate A is sufficiently implemented for safe real-source end-to-end staging and Gate B infrastructure exists. Public customer activation must await every gate and its independent authorization. No calendar date is established.
