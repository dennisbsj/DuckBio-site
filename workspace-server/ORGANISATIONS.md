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
