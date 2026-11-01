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
