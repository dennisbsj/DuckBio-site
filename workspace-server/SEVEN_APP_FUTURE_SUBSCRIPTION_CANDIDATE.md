# Future seven-app subscription selection — source candidate only

**Not part of the current licensed Workspace runtime. No live Stripe, paid seat or native DataDuck entitlement is created by this change.**

The original six-app `APPLICATIONS`, current six-app `Single/Mixed/Bundle` subscription drafts, verified LIVE ledger and independent native authorizations remain unchanged. They must not be replaced or migrated automatically.

The future approved catalog has seven distinct app IDs: `goflo`, `eel`, `methpipe`, `mantrain`, `duckman`, `limsman`, `dataduck`.

- **Single:** exactly one selected app.
- **Mixed:** any 2–6 distinct selected apps.
- **Bundle:** exactly all seven apps.
- `seatsPerApp` is a proposed 1–10,000 positive integer, not a purchased quantity.

`inspectFutureSevenAppPlanCandidate()` in the existing `dataduck-integration-candidate.mjs` validates this future selection grammar. Its return value always includes `proposalOnly:true`, `purchaseAuthorized:false`, `migrationAuthorized:false`, `licensesGranted:false` and `accessGranted:false`. A six-app old Bundle is explicitly invalid as a **new seven-app Bundle**; adding DataDuck would require a separate verified customer purchase/upgrade and independent updated native authorization. A six-app selection can remain a Mixed candidate for **future** purchases, but it never silently modifies an existing six-app purchase.

This module does NOT compute exact EUR/DKK amounts, choose discounts, create Stripe prices, allocate app seats, promise existing Bundle migration or enable the disabled DataDuck app. Before any real seven-app billing, separately approve the final new catalog price mapping and customer migration policy, reconcile signed LIVE provider payments and refunds, implement per-app seat capacity/revocation, test native permissions on every protected operation, then complete isolated eight-service staging and explicit release approval. No old subscription may be auto-expanded based on a UI selection.

See [PR #190](https://github.com/dennisbsj/DuckBio-site/pull/190), [PR #198](https://github.com/dennisbsj/DuckBio-site/pull/198) and [DataDuck draft PR #1](https://github.com/dennisbsj/DataDuck/pull/1).
