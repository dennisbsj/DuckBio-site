# Stripe LIVE tenant/customer/subscription binding — dormant private draft

This is a **route-free, opt-in identity ledger** in Workspace's existing private organization SQLite. It adds no purchases, licenses, invoice payments, browser payment endpoints, checkout sessions or SSO/native-app grants. The original six apps are allowed; DataDuck is deliberately excluded.

## Problem being addressed

The existing `stripe-live-readonly.mjs` can check an externally supplied tuple of organization, Stripe subscription, customer, price, plan, apps and seats. Its comment explicitly requires this tuple to be independently trusted. A signed Stripe webhook in `stripe_live_event_log` is metadata **without an assigned Workspace organization** and cannot safely provide the tuple.

This draft supplies a canonical **private persisted pin** between a Stripe customer, one or more Stripe subscriptions and exactly one Workspace tenant. The pin is **NOT** evidence that the invoice was paid, not a live subscription status check, not authority to grant seats, and not a shortcut around the production billing verifier.

## Source-of-truth ownership and private API

The normal `createOrganizationStore` receives optional `verifyLiveBillingBindingEvidence`, which defaults to `null`. Without it, writes fail closed. The function must independently retrieve and authenticate a trusted LIVE Stripe customer/tenant onboarding record or equivalent vetted internal evidence. **It must never return caller/JSON/webhook fields unchanged** and must not trust arbitrary metadata or browser user selections. No implementation of such a trusted external verifier is shipped here.

Only after the separate verifier returns a normalized object can a private server call:

```javascript
store.pinVerifiedStripeLiveBinding(opaquePrivateEvidence)
```

The exact verified result must contain: `source:'stripe_live'`, unique `eventKey`, `organizationId`, `subscriptionId`, `customerId`, `priceId`, `plan`, `apps`, `seats` and positive monotonic `revision`.

- The existing org must exist. A Stripe customer can own multiple subscriptions, but a customer ID cannot be pinned to two Workspace organizations, and a subscription cannot change customer or organization.
- Different plan, price, app selection and quantity require a **new verifier-approved monotonic revision**. A complete duplicate with the same event key is idempotent. Reused event keys, same-revision mutation and stale revisions are denied in SQLite transactions.
- Source is LIVE only. Unsupported apps and DataDuck, malformed IDs, invalid plan/app combinations, TEST evidence and extra claims (including `licensesGranted:true`) are rejected.
- All pinning and revision history are stored in **the existing restricted organization SQLite**, not a competing account/tenant authority. Only a shortened digest, revision, number of apps and seat count are written to the org audit. Treat stored Stripe IDs as private financial metadata and include the new tables in reviewed SQLite backup, restore and retention procedures.

A future private reader can call `store.readPinnedStripeLiveBinding({organizationId,subscriptionId})`. The only returned tuple is the exact stored, frozen, current pin, with `licensesGranted:false` and `authorizesSeatChanges:false`. There is no browser route for either method.

## Read-only integration and asynchronous consistency

`createPinnedStripeLiveObserver({organizationStore,liveReader})` obtains this tuple directly from the private organization store, then invokes the existing Stripe LIVE read-only reader. After the network await, it **rereads the pin** and refuses a result if customer, tenant, price, plan, apps, seats or monotonic revision changed while Stripe was contacted.

It returns **only** `manual_review`, `candidate_for_manual_review`, or a non-authorizing `unavailable` result. It cannot grant a paid seat, set a role, issue a SSO code or make native access available. A missed payment, cancellation, refund, dispute or stale/ambiguous invoice remains outside this binding protocol and requires a separate verified LIVE billing transition review.

## Tests and production blockers

Disposable real SQLite tests verify tenant uniqueness, replay/idempotency, version conflicts, persistence after restart, exclusions and no purchased-seat changes. Synthetic LIVE fetch tests check that only pinned tuples can be inspected and that a price change **during the await** invalidates the observation. The tests deliberately use a synthetic private verifier whose opaque in-memory tokens cannot be supplied by normal JSON.

Activation requires: an independently implemented audited Stripe/customer-to-organization verifier, agreed provider event identity and monotonic revision policy, private key/secret provisioning, reconciliation with verified subscription transitions, verified refunds and disputes, reviewed DB backup/restore, tenant-specific audit and cross-origin HTTPS staging acceptance. **Keep this PR draft, unmerged and undeployed.**
