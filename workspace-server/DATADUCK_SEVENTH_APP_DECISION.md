# DuckBio product decision: DataDuck is the seventh standalone app

**Decision date:** 3 November 2026. **Commercial scope approved;
technical activation NOT approved or deployed.**

DataDuck is its own DuckBio product, with app ID `dataduck`,
per-app user seats, app-specific roles and permissions, and
organization-scoped access. DataDuck is to appear in the
customer-facing plans **Single, Mixed and Bundle** once the
integration has passed its release gates.

| Plan | Intended DataDuck-inclusive selection |
| --- | --- |
| Single | Exactly one app; DataDuck is individually selectable |
| Mixed | Any 2–6 DISTINCT apps, including DataDuck |
| Bundle | All 7 apps, including DataDuck |

**Do not invent new prices or automatically amend older contracts.**
Existing six-app Bundle subscriptions must remain valid with their
original six-app entitlements until explicitly changed or migrated
using independently verified billing evidence. An old six-app
Bundle must NEVER silently grant DataDuck. Seat counts remain
**per app and per organization**, with no universal unused-user quota.

## Safe source-only implementation

`workspace-server/dataduck-integration-candidate.mjs` already
provides a fail-closed identity/client compatibility candidate,
not a billable seventh native client. This decision adds
`DATADUCK_COMMERCIAL_PLAN` and a pure
`inspectFutureSevenAppSelection()` validator, with
`orderable:false`, `licensesGranted:false` for **every**
prospective plan result — even valid choices.

The current Workspace checkout, organization assignments, registered
six-app SSO clients, historical staging preflight, public website
and subscription/Stripe processors are deliberately **unchanged**.
No DataDuck paid seats can be issued from this candidate contract.
The corresponding isolated DataDuck repository also remains a
draft, loopback-development-only service. Green unit tests are not
customer account integration or HTTPS staging.

## Release prerequisites for enabling the seventh app

1. Review DataDuck's native Workspace PKCE callback, broker
   introspection, organization/user UUID mapping and session
   revocation against the central server.
2. Implement a verified-live seventh-app entitlement and a
   compatible seven-app subscription transition, including
   grandfathered six-app Bundle subscriptions, safe idempotent
   receipts and locked per-app capacity.
3. Add DataDuck's native roles and permissions only to an approved
   server-enforced catalog, with explicit Admin assignment.
4. Extend app creation, invitations, provisioning, permission UI,
   Single/Mixed/Bundle selection and subscription presentation.
5. Test seven independently registered native clients over approved
   synthetic-only HTTPS environments, not merely six-app staging
   or test-mode Stripe observations.
6. Update website pricing/cards in the separate website workflow
   while preserving its established layout and brand artwork.
7. Obtain explicit go/no-go review for public launch, data privacy,
   retention, operational backups, keys, monitoring and scientific
   claims.

**No migration, purchase, Stripe live event, native account, domain,
GitHub Pages website, existing DuckBio app or production server was
changed by this document/contract.**

See DataDuck's isolated development PR:
https://github.com/dennisbsj/DataDuck/pull/1
and the current Workspace seven-app candidate file.
