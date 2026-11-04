# Stripe LIVE financial reversal → historical invoice → tenant correlation (DRAFT)

This is a private, **unmounted**, non-authorizing helper stacked on the signed event journal from PR #177. It extends the existing canonical organization SQLite with a **private-only** event lookup; it never exposes Stripe resource IDs through owner/public routes. A caller must also provide the **separately trusted and pinned Stripe LIVE organization/subscription/customer binding** implemented in PR #172. That binding is injected as `readPinnedSubscription` into the correlator until both PR stacks have been explicitly reviewed together. Never substitute browser-selected customer IDs, Stripe metadata alone, a raw webhook payload or a forged binding.

## Exact correlation contract

`createStripeLiveFinancialEventCorrelator({organizationStore,readPinnedSubscription,secretKey,fetchImpl})` creates `inspect({organizationId,subscriptionId,eventId,invoiceId})` for a reviewed **private worker only**.

- The Stripe event ID **must already exist** in the signed, durable private `stripe_live_event_log`. The worker reads the exact type, object ID, event time and original SHA-256 digest from private SQLite. Public/owner diagnostics continue to omit these source IDs.
- The requested organization/subscription must have a **current independently verified, revisioned private pin** to one Stripe customer. No pin or unknown signed financial event denies without contacting Stripe.
- `invoice.voided` uses the event invoice itself; a `credit_note.*` event requires retrieving the exact LIVE credit note and validating its customer + invoice.
- `charge.refunded` events identify a charge directly. `refund.*` and `charge.dispute.*` (both legacy `dp_` and current `du_` Dispute IDs) require independent LIVE refund/dispute GETs that resolve a charge. Because charges/PaymentIntents do not reliably identify an invoice in all API versions, a **private historical invoice ID candidate** is required. This ID is a hint, NEVER trust: exact historical LIVE invoice is fetched and independently checked against the pinned customer and subscription.
- For charge-linked events, the charge must point to the matching LIVE PaymentIntent, which must point back to that charge/customer. A non-paginated LIVE InvoicePayment allocation must independently link that PaymentIntent to the *same historical invoice* (one unique match, no fallback on amount or email).
- The current LIVE Stripe subscription is fetched to corroborate its customer and organization metadata. After **all** external awaits, the exact pinned tenant/customer/plan/price/seats/revision **and** signed journal record are reloaded and compared. A midflight rebind or later revision denies.
- Event receipt order is never treated as source chronology or payment outcome. A delayed reversal can correlate with an older invoice even after renewal or cancellation. This is why `latest_invoice` and `subscription.status='active'` are **not** required for source attribution.
- All provider requests are bounded 128 KiB UTF-8, HTTPS fixed Stripe host, read-only GET, redirect disabled and time-limited. Missing fields, unknown API shapes, invalid source link, mismatched customer/invoice/payment allocation, older schema or provider outages deny.

The only successful output is a **non-authorizing** `manual_review` result, marked `linksVerifiedForReview:true`, with the category and monotonic binding revision. There is **no** Stripe ID, email, amount, secret, payer name, payment result, entitlement or action token in the result. Denied outputs use `linksVerifiedForReview:false`. Both paths have `licensesGranted:false`, `authorizesSeatChanges:false` and `paymentEvidenceAuthoritative:false`.

## Security and rollout limitations

- **Correlation is not proof of funds lost, regained, refunded or settled.** It merely associates a signed Stripe financial event with one historical invoice on the expected subscription at the time of check.
- A signed event does not prove the event's status is final; a later event can supersede it. Reordering or replaying an event must not grant/revoke licenses. No persistence of an authorization or billing state is added.
- No automatic tenant attribution is written to `stripe_live_event_log`: owners still see `linkage:'unassigned'`. Correlation is available only through the private worker API, and separate tenant authorization/review is required before even exposing a linked indicator to a user.
- The current `main` still does **not** contain the #172 verified Stripe tenant pin. This integration cannot be mounted or safely instantiated against production until #172 and #177 are both reviewed and merged, with real operator authorization, provider API version pinned, TEST vs LIVE gating, least-privilege secret provisioning, backup/restore, GDPR/privacy checks, and real HTTPS staging.
- Do not route these APIs to browsers or owners as arbitrary lookup endpoints, and do not treat the synthetic test pin callback as a production trust source.
- No Stripe API calls, payments, license-seat changes, SSO or native app changes have been executed in development.

### Offline tests

The tests use real disposable Workspace SQLite and synthetic HMAC-verified Stripe LIVE webhooks, synthetic private revisioned tenant pins, and synthetic bounded HTTPS-style Stripe GET replies. Scenarios include signed refund/dispute/credit-note/void signals, legacy and current Dispute IDs, historical invoice linkage after cancellation, customer and subscription mismatch, wrong invoice hints, wrong PaymentIntent allocation, order inversion, provider failure, and in-flight binding revision changes. Purchased seats and active verified subscriptions remain unchanged.

Stripe source-object references:
- https://docs.stripe.com/api/events/types
- https://docs.stripe.com/api/refunds/object
- https://docs.stripe.com/api/disputes/object
- https://docs.stripe.com/api/credit_notes/object
- https://docs.stripe.com/api/invoices/object
- https://docs.stripe.com/api/invoice_payments

Keep this entire feature **DRAFT, unmerged, unmounted and undeployed** pending production authorization review.
