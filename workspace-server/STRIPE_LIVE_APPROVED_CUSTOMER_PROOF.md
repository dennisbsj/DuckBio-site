# Workspace Stripe LIVE customer/tenant approval gate — private DRAFT

This is an **unmounted, unmerged, non-authorizing** private Workspace adapter, stacked on draft #172 (canonical Stripe LIVE pins) and #169 (bounded LIVE reader). It introduces no route, payment, checkout, customer migration, purchased-seat update, app access, Stripe charge or SSO grant.

## Two independent trust sources, both required

1. **DuckBio-controlled operator approval.** `createStripeLiveApprovalGate` requires a privately configured, pinned Ed25519 SPKI public key and matching `keyId`. A trusted, offline/internal organization onboarding authority must separately ascertain the correct Workspace organization and Stripe customer relationship before it signs an **exact** approval containing: version `duckbio.stripe-live-binding-approval.v1`, key ID, unique event key, Workspace organization, Stripe subscription/customer/price, plan, sorted six-app selection, seat count, monotonic revision, issued and expiry times. Signature: Ed25519 over UTF-8 `JSON.stringify` of the ordered field array defined in `canonicalStripeLiveBindingApprovalBytes`. Approval TTL is at most 5 minutes; invalid, forged, replay-conflicting, expired or mismatched tuples deny. **No signing private key is present in this repository.**
2. **Independent, read-only Stripe LIVE API requests.** `createStripeLiveCustomerReader` requests only `GET https://api.stripe.com/v1/customers/{customerId}` with an operator-provisioned `sk_live_` credential. HTTPS and normal TLS verification remain active, redirects are prohibited, response bytes are bounded at 32 KiB and malformed UTF-8/JSON denies. Customer must match exact ID, `livemode:true`, not be deleted and carry the approved organization's exact `metadata.organization_id`. The existing `createStripeLiveBillingReader` independently obtains the matching LIVE subscription with the exact Stripe customer ID, organization metadata, price ID, licensed item quantity and plan shape. **Customer metadata alone is NOT proof of Workspace ownership**, even if it matches. It is a corroboration of an independent operator-signed approval.

After both async Stripe checks, the approval's signature and expiry are rechecked. Only then is an **opaque one-use in-memory object** handed to the canonical `organizationStore.pinVerifiedStripeLiveBinding`. Configure the store with the very same gate's `verifyLiveBillingBindingEvidence` callback at construction. A forged/serialized JSON object, browser parameter, raw webhook event, arbitrary JS object or a token from a different gate cannot substitute for that object. Once consumed, it cannot be reused.

### Private integration example (illustrative, NOT mounted)

```javascript
const customerReader = createStripeLiveCustomerReader({
  secretKey: privateStripeLiveSecret // fetch uses authenticating LIVE bearer + TLS
});
const subscriptionReader = createStripeLiveBillingReader({
  secretKey: privateStripeLiveSecret
});
const approvalGate = createStripeLiveApprovalGate({
  approvalKeyId: reviewedOperatorKeyId,
  approvalPublicKeyPem: reviewedOperatorEd25519PublicKey,
  customerReader, subscriptionReader
});
const organizationStore = createOrganizationStore({
  databasePath: approvedPrivatePath,
  verifyLiveBillingBindingEvidence: approvalGate.verifyLiveBillingBindingEvidence
});
// From authenticated, audited, PRIVATE back-office onboarding ONLY:
await approvalGate.verifyAndPin({
  organizationStore,
  approval: operatorSignedApproval,
  signature: operatorEd25519Signature
});
```

Neither the approval creator nor its signing private key is implemented here. No HTTP handler accepts the approval or token. Production operators must independently prove the Workspace tenant's right to use that Stripe customer (not merely rely on mutable Stripe metadata), manage signing keys and rotations, restrict this operation to a reviewed back-office authority, and audit approvals. The current customer reader performs a separate source-level check, not a customer ownership challenge. A compromised approved operator key or attacker-controlled Stripe account metadata must be considered in threat modeling.

## Payment and entitlement hard stops

A successful private pin **is not a payment** and is not authorization to grant an app seat, mark an invoice paid, call `applyVerifiedSubscriptionTransition`, change a native role, migrate an identity or enable a browser login. The existing Stripe subscription reader returns only `manual_review` or `candidate_for_manual_review`; no provisioner in this PR issues grants. Neither a signed webhook nor Stripe LIVE metadata is treated as full billing evidence: refunds, disputes, actual charge settlement, proration/reconciliation and revision ownership remain separate blockers. DataDuck remains excluded and the six original app repos are untouched.

## Verification and release

Real disposable Workspace organization SQLite, ephemeral synthetic Ed25519 keys, private callback non-replay, synthetic Stripe customer/subscription HTTP JSON responses, wrong metadata/tenant/price, forged signatures, stale/expired approval, and provider unavailability are tested offline. No real Stripe account, secret or provider endpoint was contacted. Full production release requires a real independently authorized approver, operator key provisioning and rotation, guarded HTTP/internal access, HTTPS TLS tests, customer ownership challenge, webhook/refund/dispute reconciliation, backup/restore of the new pin tables and cross-service staging tests.

**Keep draft/unmerged/undeployed** pending #140 security gates.
