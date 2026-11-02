# DuckBio Workspace organization administration
The server-side `organization-store.mjs` enforces app-specific seat limits and individual user roles in SQLite. Roles come from the existing six-app policy. Organizations are isolated; assigning roles consumes only that app's purchased seats. The last organization administrator cannot be removed.

**Purchases are not active.** `applyVerifiedSeatPurchase` is an internal method for a future server-side, signature-verified billing adapter. No browser API can increase seats. Single, Mixed and Bundle selections are validated and purchase references are idempotent. Do not call this method from an untrusted HTTP handler.

This store does not create central identity accounts, process payments, send invitation emails, or modify native app permissions. It is a tested backend building block; those links require separate reviewed integrations. No production/customer data is involved.

## Operator-only first organization setup

After creating the private central administrator with `shared-auth/manage-identity.mjs`, the server operator can register an organization in the **private** Workspace database:

```bash
node setup-organization.mjs --identity-db /srv/private/identity.sqlite --organization-db /srv/private/organizations.sqlite --id lab-1 --name "Example Lab" --owner-id <existing-verified-account-uuid> --nickname Admin
```

The CLI reads the existing identity database **read-only**, requires the exact account ID to be an active central administrator, and refuses aliases into public web directories. A transaction creates the organization and its first admin membership, with **zero purchased seats and zero native app roles**. Only a separate signature-verified billing service may add seats. Never expose this operator command as an HTTP API and never print account, email or database secrets in logs. Synthetic tests verify this flow and rejection of member accounts/duplicate organizations.

## Organization invitations and removing users

The organization administrator can create a seven-day, one-use invitation to their **currently selected organization**. The API stores only a SHA-256 digest of its random 256-bit token. The administrator receives a private invitation URL for secure manual sharing; **email delivery is not connected**. An existing DuckBio account must sign in with the exact invited email, while a new recipient can create a password and central member identity when accepting the invitation. Invitations grant organization membership only, **zero app roles and zero seats**. Native app access is not inferred from email or organization membership.

The **Remove** control removes the user's membership and all their Workspace app-role/permission assignments in that organization. It does not delete central identity or any other organization's memberships or application data. The final organization administrator cannot be removed. Session-bound organization checks fail closed if membership is removed.

This is isolated preproduction source; no mail or billing integration, production account cutover, actual app role enforcement or deployment has occurred. All invite links are bearer credentials: deliver them privately and avoid posting in tickets or public chat.

## Subscription drafts

The admin's Subscriptions tab shows paid/assigned per-app seat counts from private SQLite, and allows a selected-organization admin to create and cancel **unpaid subscription drafts** for valid Single (one app), Mixed (two–five apps) or Bundle (six apps) selections with a common positive seat quantity. These draft records are durable and tenant-isolated. They are not invoices, Stripe subscriptions, orders, or granted licences; creating/canceling one never calls `applyVerifiedSeatPurchase` or updates seat counters. To buy or change a paid subscription, a signed, idempotent Stripe checkout/webhook and billing reconciliation integration is still required, followed by staging tests. **Do not call the draft flow a completed purchase.**

## Optional automatic invitation email

Manual invitation links are used unless **both** `SUITE_RESEND_API_KEY` and `SUITE_INVITATION_FROM` are configured in the private Workspace broker environment or `SUITE_ENV_FILE`. The sender (e.g. `DuckBio <support@your-verified-domain.example>`) must be verified with Resend; use a real receiving address and proper SPF/DKIM/DMARC. Secrets must never be committed or placed in the public `development/docs` website. When configured, the broker sends a plain-text invitation with a hashed idempotency key. A successful provider API acknowledgement returns `delivery: email` to Workspace without exposing the bearer link. If the provider times out or rejects it, the pending invitation is revoked and its seat reservation freed. This can result in a delivered but unusable link on ambiguous timeouts; the admin can invite again. **Provider acceptance is not a guarantee of inbox delivery.** Automated tests never send live emails. No live provider or production origin has been configured.

## Stripe test Checkout adapter (not yet connected to UI)

The isolated `stripe-test-checkout.mjs` adapter accepts only a private `sk_test_` secret and an explicit plan/app-combination price map such as `{"Mixed:eel,goflo":"price_ACTUAL_TEST_PRICE_ID"}`. The price must be a preconfigured recurring Stripe test price with the intended plan discount; Workspace does not invent any amount. Every test Checkout request includes the exact draft/organization metadata and an idempotency key supplied by a future persistent checkout-intent store. It rejects live keys, unconfigured prices and non-Stripe redirect hosts. Unit tests use synthetic Stripe responses; no Stripe account, real payment, production integration or licensing activation has been configured. A durable intent and authenticated server checkout route are required before enabling any checkout UI.

## Test Checkout intent storage

`stripe_test_checkouts` is a private, transactional SQLite ledger keyed by the subscription draft ID. The first authenticated admin request pins a Stripe test Price ID and a deterministic idempotency key. Repeating the same request returns the same parameters, while changing the price fails. Saving the returned test-only Checkout URL is idempotent and checked against Stripe's checkout host. After a checkout attempt starts, the draft cannot be canceled through the draft UI (ambiguity about remote Stripe session). The ledger never issues purchased app seats or processes webhook payments. Existing drafts remain unaffected until a test checkout is explicitly initiated. Next: wire an authenticated checkout endpoint, then signed webhook reconciliation before any production billing.

## Signed Stripe webhook verification (test mode)

The `stripe-test-webhook.mjs` verifier accepts only private `whsec_` configuration, verifies the HMAC SHA-256 `Stripe-Signature` over the **original raw bytes** within a five-minute timestamp tolerance, rejects tampered/expired/live events and emits only event ID/type/object ID plus payload digest for durable idempotent recording. Do not parse/transform JSON before verification and never process success redirects as proof of payment. This is a security primitive only: the HTTP ingress and event ledger are now implemented, but full subscription reconciliation must still be implemented and tested before any entitlement activation, let alone live billing.

## Durable Stripe test webhook event ledger

The private organization SQLite database now stores only **verified webhook event metadata** (event ID, type, object ID, timestamp, digest, and any matched local draft/organization). Replays of an identical event ID and digest are idempotent across restarts. Reuse of an event ID with different signed metadata is rejected. Unknown events are stored as unassigned, not attached to an unrelated tenant. Only an existing ready **test** Checkout session can be matched; a `checkout.session.completed` event still does **not** prove that an invoice is paid. No seat counters, subscriptions, app grants or native app accounts are changed. Full payment/subscription reconciliation remains a separate, mandatory step.

## Private Stripe test webhook HTTP endpoint

Only when private Workspace `SUITE_STRIPE_TEST_KEY`, `SUITE_STRIPE_TEST_PRICES_JSON`, `SUITE_ORGANIZATION_DB_PATH` **and** `SUITE_STRIPE_TEST_WEBHOOK_SECRET` are configured does the broker accept `POST /api/suite/billing/stripe-test-webhook`. Configuration missing the checkout/store dependencies fails startup; without the webhook secret, the endpoint returns 404. The `whsec_` secret belongs in the private environment, never in GitHub Pages or frontend code.

Stripe sends an unsigned browser session neither cookie nor CSRF token: this endpoint alone uses an HMAC SHA-256 over original raw bytes instead of browser authentication. Request host, method, JSON content type, timestamp (±5 min), signature, raw payload size (up to 64 KiB), and `livemode: false` are checked before the private SQLite ledger is written. Invalid signatures and malformed/oversized requests receive 4xx, and failed persistence returns 503 so Stripe can retry. Idempotent retries receive 200. The response `received: true` means **only that signed test metadata was stored**, never payment success. No event adds app seats or grants licenses.

This is not a public GitHub Pages feature and is not connected to a Stripe dashboard, live Stripe endpoint, deployed server, invoice verification, subscription reconciliation, or native app entitlements yet. Do not use a redirect query parameter, an email receipt, or merely `checkout.session.completed` to activate seats. All tests are synthetic and isolated from real services.

Out-of-order test webhooks are recorded as unmatched until an exact, valid test Checkout session ID is durably saved; the same transaction then links prior signed `checkout.session.completed` metadata to that draft's organization. A different session or organization is never inferred. This late association changes **metadata only**, not seats or payment status.

## Read-only test Stripe billing attestation

The isolated `stripe-test-reconcile.mjs` adapter makes three **server-side, test-key-only GETs** to Stripe: the previously pinned Checkout session, its subscription, and its latest invoice. It requires exact Checkout draft/organization metadata, subscription metadata, customer identity, one licensed subscription item with the pinned Price ID and purchased seat quantity, an active subscription, and a paid invoice with a positive amount, zero outstanding amount, paid timestamp and exact customer/subscription association. Unpaid or incomplete states stay pending; identity inconsistencies fail closed. It accepts either the newer invoice `parent.subscription_details.subscription` association or the older `invoice.subscription` field.

The adapter is deliberately **not connected to a browser route, background worker, webhook automatic processing, or licensing activation**. Its result is a read-only test attestation, not permission to call `applyVerifiedSeatPurchase`. Before issuing seats, the system still needs reconciliation persistence, subscription lifecycle and recurring billing handling, refunds/disputes, rechecks on changes, idempotent entitlement updates, and end-to-end staging tests. No real Stripe account or test dashboard is accessed by the synthetic CI tests.

## Admin-only test reconciliation API (opt-in)

The private broker only enables `POST /api/suite/organization/subscription/test-reconcile` when `SUITE_STRIPE_TEST_RECONCILE_ENABLED=true` is explicitly set alongside a private organization store, test Checkout key, and test price map. The request body is `{"organizationId":"selected-org","draftId":"existing-draft-id"}`. A signed-in **organization administrator** needs the selected organization and same-origin CSRF token. The backend reads only its own already saved and ready Checkout session/Price; clients cannot submit arbitrary Stripe session IDs. The server rechecks the live login, selected organization, admin membership, and pinned session after the read-only Stripe request. Pending and verified-paid-test statuses are returned to the admin but never treated as licenses.

This private diagnostic endpoint is not part of the public website or production payment experience. The result is **non-persistent** and may become stale immediately; it does not record a subscription, process renewals, activate seats, or grant permissions. Only synthetic fixtures are used in CI. A separate reviewed state machine, webhook/subscription processing, persistence, and revocation semantics are required before real billing.
