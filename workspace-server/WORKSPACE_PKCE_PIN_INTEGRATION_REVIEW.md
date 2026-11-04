# Six-app PKCE identity + audience safety integration — 4 November 2026

**Draft, source-only, no deployment.** This candidate builds on [Workspace PR #192](https://github.com/dennisbsj/DuckBio-site/pull/192), which builds on consolidated [#191](https://github.com/dennisbsj/DuckBio-site/pull/191). It **copies only the reviewed final broker implementation and test/doc files from #170 → #171**. Original PR branches and history are unchanged. PR #171 was based on #170 → #168 → #166, but the independent #168 authority implementation was intentionally **not** overlaid.

## Included trust boundaries

- At PKCE issuance, the authentic parent session ID and subject, **registered app ID and client ID**, exact sanitized native local user/organization tuple, and optional trusted broker binding revision are recorded in the short-lived, one-use server-side code. An app cannot alter its audience after issuance, even if an operator reuses a client ID for a different app.
- At exchange, the broker consumes the code and checks the same registered client/app, original parent session ID and subject, PKCE verifier, redirect URI/state, exact current native identity and optional native authoritative binding revision. A replaced native user, tenant or deactivated permission denies and mints no proof. An older code without a pinned localIdentity is invalid.
- Child session proofs persist exact client/app, original parent and native identity and are rechecked at introspection/native authentication. Old proofs without app ID deny; a wrong-app revoke must **not** log out an unrelated parent session.
- The separate native preflight and deny adapter from #191/#192 remain **non-authorizing**: a positive `candidateReady` never changes `getAccess() === null`. This does not enable real broker/native login, licensing, payment or any DataDuck client.
- Existing Workspace `main` QA/check scripts (including real native database/mTLS source gate) were preserved. The only manifest change is the added syntax check for the imported six-app PKCE identity pin tests.

## #168 vs #187 decision — no competing authority epochs

PR #168 derived a *fine-grained* per-account/app native audit revision (`authorityAuditRevision`) and SHA-256 `preflightBindingRevision`. Consolidated #187 uses an independently validated **monotonic organization-wide** `authorizationAuditRevision` read from `organization_audit` and compares it across native awaits. The #187 approach is more conservative (unrelated same-org audits may invalidate a candidate), but covers permission, role, membership and live-seat ABA. #192 independently protects **session-organization** clear/reselect with a separate persistent selection revision; the native link store has its own link revision.

**Decision:** retain the existing #187 `authorizationAuditRevision` + #192 session selection revision + native link generation. Do **not** duplicate #168 authority queries/hashes or treat the #168 preflight hash as an authoritative broker `bindingRevision`; the latter must come from a future separately reviewed trusted native grant source. #168's unique tests can be selectively ported after independent review if they cover missing threats.

## Verification / release gates

- Run **exact-head** `cd workspace-server && npm run check && npm test` on Node.js 22 and 24. Historical #170/#171 standalone passes do not qualify.
- Ensure negative cases across all six client app IDs: native local user/tenant changed between issuance and exchange, stale/missing legacy local pin, client ID reassigned to another app, sibling parent session substitution, revoked permission/proof, consumed/replayed code, and wrong-app revoke.
- Signed Ed25519 owner proofs (#150/#188), the separately developed native liveness/cross-service cases (#148), independently operator-approved live Stripe entitlements and six-app native resource authorization are **NOT** brought into this patch. These remain separate, necessary gates.
- DataDuck remains unavailable as a paid/active SSO client pending native backend acceptance and approved pricing/licensing.
- Do not merge, enable, deploy, create live seats or rely on positive preflight. Source-only tests do not prove actual eight-service staging or production security. See [activation runbook #190](https://github.com/dennisbsj/DuckBio-site/pull/190).
