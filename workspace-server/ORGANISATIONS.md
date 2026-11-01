# DuckBio Workspace organization administration
The server-side `organization-store.mjs` enforces app-specific seat limits and individual user roles in SQLite. Roles come from the existing six-app policy. Organizations are isolated; assigning roles consumes only that app's purchased seats. The last organization administrator cannot be removed.

**Purchases are not active.** `applyVerifiedSeatPurchase` is an internal method for a future server-side, signature-verified billing adapter. No browser API can increase seats. Single, Mixed and Bundle selections are validated and purchase references are idempotent. Do not call this method from an untrusted HTTP handler.

This store does not create central identity accounts, process payments, send invitation emails, or modify native app permissions. It is a tested backend building block; those links require separate reviewed integrations. No production/customer data is involved.
