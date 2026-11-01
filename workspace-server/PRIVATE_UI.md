# Private Workspace interface

The `/workspace` page is served by the **private** Node account service, not by the public GitHub Pages site. It can sign in to the portable email/password account service and uses same-origin CSRF-protected HTTP calls to load organizations and user roles.

Admins can review purchased/assigned seats per app, and edit the role dropdowns of already-verified central accounts without exceeding app-specific seat limits. A new assignment requires the existing central account ID and exact account email; this does **not** create a login or link a native user by email. Organization creation/invitations, app-native identity mapping, Google sign-in and verified Stripe checkout are separate security-gated milestones.

The **Buy users** control provides a local selection review only. There is no checkout or server entitlement mutation, and the UI explicitly says so. The private backend must be hosted under an approved HTTPS origin with DBs and secrets outside the site root before any users can access it. No Pages deployment is authorized by this source-only PR.
