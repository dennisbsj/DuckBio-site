# Stripe LIVE post-payment financial review signals — private, source-only DRAFT

This branch extends the **existing** detached Stripe LIVE raw-body signature verifier and the existing private organization SQLite `stripe_live_event_log`. It does **not** start a new ledger, create a browser endpoint, call Stripe, modify any purchased seats, activate an entitlement, change the active Workspace broker or touch native apps/DataDuck.

## Why the event catalog needs extension

A `paid` invoice and a clean charge snapshot are not durable guarantees: Stripe emits separate events when charges are refunded, disputes change status or funds are withdrawn/reinstated, invoices are voided and credit notes are changed. Those later events must not be dropped silently. Stripe documents their types and resource objects at https://docs.stripe.com/api/events/types.

Supported **review-only** financial event families and their exact source-object prefixes:

- `charge.refunded` → charge `ch_`; `refund.created`, `refund.updated`, `refund.failed` → refund `re_`
- `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated` → dispute `dp_`
- `credit_note.created`, `.updated`, `.voided` → credit note `cn_`
- `invoice.voided` → invoice `in_`

All existing LIVE invoice, subscription and checkout event types keep their historical meaning. A shared, immutable source-code allowlist `stripe-live-review-event-catalog.mjs` now defines the exact prefix and the expected `data.object.object` kind for new financial events. Incorrect kind, prefix, TEST mode, Connect account, webhook signature or raw timestamp fails closed in the existing verifier. All successful verifier output is minimal: event ID, event type, Stripe resource ID, event epoch, SHA-256 digest of signed raw body, `mode:'live'`, `financialReviewRequired`, and explicit `licensesGranted:false`/`authorizesSeatChanges:false`. **No amounts, customers, payment tokens, email, metadata or webhook raw body are copied into the returned record.**

The existing SQLite journal persists only the already established `(event_id,event_type,object_id,event_created,raw_digest,received_at)` metadata columns. Existing event ID deduplication and conflict checks apply to every new type. Repeated delivery is idempotent. An event ID with changed type, object, timestamp or content digest cannot replace a prior event. Stored review classification is derived from event type, not from a claimed browser/proxy field. The private owner diagnostic `liveWebhookEvents` returns `financialReviewRequired` and `reviewCategory` but keeps `linkage:'unassigned'`; it does **not** claim a Stripe charge or refund belongs to any Workspace organization.

## Crucial non-authorizing limitations

A signed event demonstrates only that Stripe emitted the reported event to the independently provisioned LIVE endpoint. It does **not** prove payment was received, that a refund completed, that a dispute is lost or won, that an invoice should be deactivated, or that a Workspace tenant owns the Stripe object. `refund.failed` and `dispute.funds_reinstated` are review signals, **not automatic license decisions**.

A future reviewed back-office reconciler must correlate events to canonical tenant/customer/subscription/charge/credit-note records through fresh independent provider queries, handle out-of-order delivery and event-version semantics, establish revocation/re-grant policy, and maintain explicit review state. The current ledger does not create that policy, does not link these events to tenants, and is not deployed as a webhook route.

**Release blockers:** authorized LIVE webhook secret rotation and delivery, independent Stripe/customer/org trust, provider refunds/disputes/charge reconciliation, payment-reversal timing, reviewed tenant-safe alert routing, durable backup and privacy retention, testing with real LIVE provider API shapes, and full HTTPS staging. Keep this PR unmerged, unmounted and undeployed pending security issue #140.

## Verification

Offline tests use synthetic signed raw LIVE events, real disposable Workspace SQLite and no Stripe network calls. Every new type is checked for signature, correct object family and ID, persistence across SQLite restart, duplicate/conflict replay, tenant privacy and **zero** purchased seats / subscriptions. Existing invoice tests must remain green on Node 22 and Node 24.
