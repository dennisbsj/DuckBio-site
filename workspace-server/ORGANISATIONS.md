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

## Signed Stripe webhook verification (test mode, not yet routed)

The `stripe-test-webhook.mjs` verifier accepts only private `whsec_` configuration, verifies the HMAC SHA-256 `Stripe-Signature` over the **original raw bytes** within a five-minute timestamp tolerance, rejects tampered/expired/live events and emits only event ID/type/object ID plus payload digest for durable idempotent recording. Do not parse/transform JSON before verification and never process success redirects as proof of payment. This is a security primitive only: incoming HTTP webhook routing, durable event storage and full subscription reconciliation must still be implemented before even test-only entitlement activation, let alone live billing.
