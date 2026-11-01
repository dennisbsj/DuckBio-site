# DuckBio Workspace private account service — source migration

This directory is **server-side source**, not a GitHub Pages app or an activated customer login. It ports Codex's reviewed shared-identity broker, native-account gateway, private SQLite identity store and regression suites from [legacy account PR #27](https://github.com/dennisbsj/celluloid-consulting-site/pull/27). The code has no attached live customers, passwords, payments or app sessions.

## Important boundaries
- This repository's public website is published from `development/docs`, not from `main/workspace-server`. Keep runtime code, account databases, configuration and logs **outside** the public Pages docs folder.
- First-admin setup is explicit and one-use; app identities must be linked to native user IDs and to the exact DuckNote organization. Never link users based only on matching email.
- Old internal IDs `goflo/eel/methpipe/mantrain/duckman/limsman` are compatibility identifiers. The current customer-facing names are CytoDuck/DuckNote/DuckPipe/DuckTrain/DuckMan/LabDuck.
- The imported service still contains legacy example client origins and old asset routing. It is **not a production-ready configured Workspace** and must not be pointed at retired cHosting.
- Existing app backends remain independently authoritative for membership, native role/MFA and data. This change does **not** integrate live native gateway routes or implement per-app purchase entitlements.
- `npm test` runs synthetic account, CSRF, PKCE, native-user mapping, session-revocation, SQLite and portability tests. Production deployment, email delivery, checkout, Google login and web-based admin are separate milestones.

See [the Workspace issue](https://github.com/dennisbsj/DuckBio-site/issues/26) for the remaining work. Do not claim user login is functional or published merely because the backend source tests pass.
