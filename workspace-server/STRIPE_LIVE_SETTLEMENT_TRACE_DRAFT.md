# Stripe LIVE invoice → payment → charge trace (DRAFT, PRIVATE, manual review only)

This standalone module is **not mounted** and is stacked on the existing private Stripe LIVE identity chain:
- #169 bounds the read-only LIVE subscription/invoice response streams.
- #172 pins the exact Stripe customer, subscription, price and six-app plan to a single Workspace organization with a monotonically increasing revision.
- #173 adds independently signed private operator approval and LIVE customer/subscription identity corroboration before an opaque one-use pin is persisted.

The current module `stripe-live-settlement-trace-review.mjs` adds a **separate diagnostic trace**. It never grants license seats, changes subscriptions, assigns roles, calls `applyVerifiedSubscriptionTransition`, issues SSO proofs or makes a browser route. DataDuck remains excluded.

## Why `invoice.status='paid'` is insufficient

Stripe documents that invoices can be marked paid outside Stripe and may be settled through multiple invoice-payment allocations, credits and different payment methods. Invoice payments can reference individual PaymentIntents; charge and refund/dispute conditions need independent verification. A single `paid` status or `invoice.paid` webhook is not proof that a DuckBio subscription should be authorized. Relevant upstream documentation:
- https://docs.stripe.com/api/invoices/object
- https://docs.stripe.com/api/invoices
- https://github.com/stripe/stripe-go/blob/master/invoicepayment.go
- https://docs.stripe.com/api/payment_intents/object
- https://docs.stripe.com/api/charges/object

## Private inspection sequence

For an exact server-side `{organizationId,subscriptionId}`:

1. Read the current **organization-owned private SQLite pin**. No pin, cross-tenant query or unsupported ID: no Stripe requests.
2. Require the existing independently configured LIVE subscription/invoice reader to produce strictly `candidate_for_manual_review`, never `licensesGranted:true`.
3. Independently GET the exact current LIVE subscription and latest invoice. Validate tenant/customer, current licensed price/quantity, invoice paid status, no out-of-band payment and positive paid amount; reject any nonzero pre/post-payment credit-note amount. This deliberately favors manual review over inferring settlement.
4. GET `/v1/invoices/{invoiceId}/payments?limit=100`, require one non-paginated, `paid` invoice-payment allocation with a matching LIVE invoice, currency and full amount, and a PaymentIntent reference. Multiple/partial allocations, different API object shapes, offline payments and credit balances require manual reconciliation.
5. GET the bound PaymentIntent and its latest Charge. Require exact customer/amount/currency and `succeeded` intent/charge; reject charge refund flags, any refunded amount, open/disputed status, uncaptured charges, and incomplete or nonempty refund collections.
6. **Reread the pinned customer/subscription/price/plan/seats/revision after all network awaits**, and deny if any pinned field changed (including a same-identity new monotonic revision). No result includes Stripe customer/invoice/charge IDs or secret keys.

Every request is a fixed-host, server-authenticated Stripe LIVE `GET` with redirect denial, no browser credentials, a 128 KiB streamed UTF-8 byte limit and request timeout. All unexpected provider shapes, connection errors and invalid JSON deny. The tracing result remains `state:'manual_review'`, including when all currently observable fields appear consistent. It always sets `licensesGranted:false`, `authorizesSeatChanges:false`, and `paymentEvidenceAuthoritative:false`.

## Deliberate limits

This is a **conservative snapshot**, not durable proof of settlement and not a complete refund/dispute reconciliation, which can change after an API read. Provider API version differences can make this particular chain unavailable and must cause **manual review rather than a fallback grant**. Stripe may support multiple legitimate payments, credit balances, ACH/bank flows, prorations and other arrangements that this strict profile does not automatically interpret. No amount equality here should be used as a paid-seat license decision.

Full go-live still requires a reviewed real provider API version, private operator ownership authority, independently checked event provenance and payment/refund/dispute reconciliation with fraud/race controls, secure provider credentials and rotations, final-approved entitlement transitions, and real HTTPS staging tests. The existing native/SSO/app workstreams and all real customer data remain untouched.

## Offline acceptance

Tests use real disposable organization SQLite, a synthetic pinned LIVE tuple, a fake non-authorizing baseline reader and synthetic Stripe HTTP responses. They cover a clean-but-non-authorizing chain, wrong tenant/unpinned subscriptions, out-of-band/credit-note invoices, split payments, wrong PI/charge, refunds/disputes, changed pin revision while waiting, oversized/malformed/error HTTP responses and zero paid-seat mutations.

Keep this PR **draft, unmerged and undeployed**.
