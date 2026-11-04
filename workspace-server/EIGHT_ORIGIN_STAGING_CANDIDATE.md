# Eight-origin source candidate — Workspace + seven apps

**Status 4 November 2026: source template only; not deployment ready.**

The original seven-service source/staging plan means **Workspace + SIX native apps** and was never proof of DataDuck. This new file provides a *distinct* pure, read-only, no-side-effect candidate planning API, `staging-eight-origin-candidate.mjs`, for **Workspace + SEVEN native apps = eight separate HTTPS origins**. It never updates the six-app historical locks.

## Contract

`buildEightOriginCandidate({stagingDomain,entries})` accepts exactly eight known `{id,repo,sha,origin,callbackUri,sourceStatus}` records, each with a 40-hex commit SHA, exact private repository name, exact HTTPS staging origin and app callback. No client secret, entitlement, user identity, currency, payment, certificate or production host belongs in these records. Invalid or extra fields and missing/duplicate app IDs, callbacks or hosts deny. Workspace has `callbackUri:null`.

The eight proposed loopback ports are 3407–3414: Workspace; CytoDuck; DuckNote; DuckPipe; DuckTrain; DuckMan; LabDuck; DataDuck. They are **candidate-only** allocations, not ports bound by a running service. The generated Caddy text must not be copied directly into production or treated as TLS/identity validation. It neither creates config files nor starts services.

A valid proposal always returns `sourceIntegrityExternallyVerified:false`, `stagingAuthorized:false`, `deploymentAuthorized:false`, `nativePermissionsVerified:false`, `accessGranted:false`, and `licensesGranted:false`, even if an untrusted caller labels all eight records `merged-main`.

## Known external blockers

- DataDuck source is in an open unmerged draft PR #1 and native Workspace HTTP endpoints are unmounted in its real server. Source status remains `draft`; a future exact merged `main` SHA must be reviewed and re-pinned before staging acceptance.
- Native app backends have independent local authorization; central Workspace custom permissions and live per-app seat withdrawals are not yet proved at each protected scientific API.
- All six existing native repositories are private. The optional offline signer source CI requires an explicitly approved read-only six-repository credential and an operator-run test. The static pinned 18/18 source blobs and synthetic tests do not prove deployed signers.
- Workspace + seven native apps require real eight-origin private HTTPS, distinct native/central databases, controlled secrets, a trusted authorizing server-side seat/policy contract, true DataDuck authorization, TLS/mTLS, browser E2E, replay/revocation, backup/restore, audit/rollback and independent go/no-go.
- The commercial configuration must explicitly add DataDuck to **Single (1), Mixed (2–6), Bundle (all seven)** after an approved seven-app price/licensing policy. Do not silently convert previously purchased six-app bundles or issue seats without reconciled LIVE billing evidence.

See [activation runbook PR #190](https://github.com/dennisbsj/DuckBio-site/pull/190). This template makes no payment, user, app or deployment change and is not authorization to create staging. Its automated tests are offline and source-only.

## Future staging handoff

The staging operator must first verify the eight exact **merged** source SHAs from GitHub on a private host and obtain the user-approved staging domain, network/certificate/credential and data isolation plan. A reviewer must approve a separate eight-app **authoritative** source lock, exact seven-native systemd/Caddy units and successful CI on all eight commits. Use real native DBs and server-side permissions, not stubs, for staged acceptance. Keep the historical seven-origin lock immutable for traceability.
