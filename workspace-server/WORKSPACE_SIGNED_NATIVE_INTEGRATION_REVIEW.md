# Workspace signed native ownership + liveness — isolated integration QA

**Status: draft and unmounted, no auth grants or production activation.** This integration depends on [PR #193](https://github.com/dennisbsj/DuckBio-site/pull/193) and therefore the combined backend [#191](https://github.com/dennisbsj/DuckBio-site/pull/191), session-org ABA [#192](https://github.com/dennisbsj/DuckBio-site/pull/192) and PKCE native/app binding [#170/#171](https://github.com/dennisbsj/DuckBio-site/pull/171).

## Scope and sources
- Copy the unchanged **dormant** Ed25519 private signed ownership verifier (and original isolated unit tests/docs) from [#150](https://github.com/dennisbsj/DuckBio-site/pull/150).
- Copy the independent real-disposable-SQLite in-flight native verifier liveness regressions/docs from [#148](https://github.com/dennisbsj/DuckBio-site/pull/148).
- In the copied signed cross-store test, add **one new integration-only regression**: a genuinely valid Ed25519 response delivered after `session_organizations` clear/reselect of the same session/user/organization is STILL rejected by the durable revision check in #192.
- Add syntax-check entries for the imported files in the current Workspace manifest; preserve all active main staging QA and prior checks.

## Trust boundaries
The verifier uses privately configured HTTPS endpoint, bearer, pinned native Ed25519 key and response nonce/purpose/tuple/time signature validation. Its test transport and ephemeral Ed25519 signer are **synthetic**, NOT a native HTTPS server, real native database or proven merchant payment. The on-disk scoped Workspace identity and organization databases in cross-store tests are disposable and use test-only operator/paid-seat callbacks. It does not import into `shared-auth/runtime.mjs` or supply a broker grant. Positive preflight remains `candidateReady:true` but **`accessGranted:false`, `licensesGranted:false`, `loginEnabled:false`**. The deny adapter never returns access.

## Caveat about existing protocol text
The historical #150 protocol note described native implementations as not yet existing. Six native apps now have independent **unmounted** signer/lookup and loopback/mTLS source candidates, but those endpoints are NOT mounted in real services or accepted in authentic eight-service staging. The original #150 note is retained verbatim to preserve review provenance, and this note supersedes its historical status claim.

## Outstanding release gates
- Independently reviewed native mTLS endpoint/operator trust and native signer evidence matching the pinned public key; integrate QA #188 separately.
- Real native application owner/tenant membership checks, non-native bypass denial, native role/project/resource authorization per request.
- Independently verified paid LIVE Stripe evidence and explicit per-app Single/Mixed/Bundle seat policies. DataDuck remains an **unreleased seventh app**, not an active grant.
- Exact-head Node22/24 CI, isolated authenticated HTTPS eight-service staging, safe cross-database backup/restore, revocation after rollback, and human-approved production cutover. See [activation plan #190](https://github.com/dennisbsj/DuckBio-site/pull/190).

Never merge automatically, invent credentials, alter payment access or deploy from this source-only draft.
