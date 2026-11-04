# QA: canonical Stripe LIVE tenant pin + signed reversal in ONE real organization SQLite

This **draft QA integration branch** connects two previously separate unmerged Stripe LIVE workstreams:
- PR #172: organization-scoped Stripe LIVE customer/subscription pin with verified-callback injection, monotonic revisions and SQLite customer/tenant uniqueness.
- PR #182 → #177: signed Stripe LIVE financial reversal metadata journal and independent provider correlation to historical invoices.

It is deliberately **stacked on PR #182**, importing the exact opt-in pin schema and pin/read methods from #172 into the existing `organization-store.mjs`. The original private event journal and new private-only event read are preserved. This is a **temporary source-level integration checkpoint, not permission to merge two PR stacks without reconciling commits**.

## Contract

The same restricted organization SQLite now stores the independent pinned customer/subscription/tenant, authenticated reversal event log and all original organization policy state. It has only one canonical `createOrganizationStore` with:
- `verifyLiveBillingBindingEvidence:null` **by default**, so no caller can pin LIVE customer/source data without an approved private verifier.
- `pinVerifiedStripeLiveBinding(opaquePrivateEvidence)` — strict monotonic event/revision uniqueness, one Stripe customer to one tenant, no paid seats, no browser route.
- `readPinnedStripeLiveBinding({organizationId,subscriptionId})` — current exact private read.
- `recordVerifiedStripeLiveEvent` and `readVerifiedStripeLiveEventPrivate(eventId)` — signed journal with durable replay protection. No raw event, customer IDs or other payment source IDs in owner/browser diagnostics.
- Source-only `createStripeLiveFinancialEventCorrelator({organizationStore,secretKey,fetchImpl})` can now use **the same real store for both lookup types**, instead of the synthetic readPin callback used in earlier isolated unit tests. It rechecks the pinned revision and event digest after network awaits and returns only manual-review metadata.

The source-level pin from #172 **is not a paid invoice, charge, refund or dispute attestation**, and the signed event still does not prove the final financial state. Neither module applies billing transitions, purchases, native grants, SSO roles or paid seats. DataDuck is still excluded.

## Offline tests

`tests/stripe-live-pinned-event-real-sqlite-interop.test.mjs` exercises **real SQLite**, not a mocked organization store:
1. Signed event without an independently verified customer/subscription pin denies and performs zero Stripe GETs.
2. Exact persisted customer/org/subscription pin and HMAC-verified refund are stored in the same SQLite; fresh provider-synthetic refund → charge → PaymentIntent → historical invoice payment allocation → subscription chain correlates for **manual review only**.
3. Wrong tenant and attempted cross-org customer pin are rejected with zero paid seats and no provider requests.
4. Closing and reopening SQLite retains both identities, a duplicate webhook is idempotent, a repeated approved pin cannot add seats, and the private correlator still works.
5. A new approved revision/price/plan/seat count during a pending provider lookup forces **unavailable**, not a linked result.
6. Delayed/out-of-order signed financial events can both be *reviewed* against the same historic invoice, even though `subscription.latest_invoice` has moved forward.
7. Wrong historical customer or PaymentIntent allocation fails closed.
All authorization flags remain false; owner snapshots and correlation outputs omit customer, refund and invoice IDs.

All tests use a **synthetic opaque in-memory trust token**, a synthetic HMAC signing secret, synthetic provider response payloads and a synthetic `sk_live_`-shaped test key. The actual independently verified operator/Stripe approval bridge from #173 is **not** installed here; its separate approval test matrix must be required before real activation.

## Release gates

**Do not merge or deploy this QA branch.** PR #172 and PR #182 have different parent branches and require a reviewed integration/cherry-pick or consolidated merge with no duplicate store methods. Maintain explicit approved operator verifier (#173), audited LIVE Stripe account ownership, private key provisioning/rotation, provider API version pinning and refund/dispute final-state reconciliation, backup/restore with all pin tables, tenant-specific privacy/retention review, native/SSO release gates and real TLS staging smoke tests. No existing production route should call these dormant private methods.

The QA branch is an interoperability check, not evidence of LIVE payment verification or commercial readiness.
