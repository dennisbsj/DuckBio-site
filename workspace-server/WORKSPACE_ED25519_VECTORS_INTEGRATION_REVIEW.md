# Ed25519 known-answer integration (reviewed subset of #188)

**Source-only, not a deployed native ownership or paid-seat grant.**

This draft stacks on [#194](https://github.com/dennisbsj/DuckBio-site/pull/194) and imports only PR [#188](https://github.com/dennisbsj/DuckBio-site/pull/188)'s externally signed, immutable public test vectors and deterministic Workspace protocol-compatibility tests.

* Six distinct Ed25519 SPKI public keys, one per original app, and six known-answer signed proof tuples with independent precomputed expected UTF-8 bytes.
* Five tests prove exact canonical bytes, external signatures, 30 cross-app wrong-key checks, 78 single-field mutation denials, and that production key material is absent from the fixture.
* No private keys, bearer secrets, native source imports, app database, Stripe or external HTTPS are used.

**Deliberately not imported:** PR #188's operator-only `six-native-known-answer-audit.mjs` and `tests/six-native-known-answer-audit.test.mjs`: the operator harness depends on two earlier independent unmerged QA source modules, `six-native-signer-interoperability.mjs` and `six-native-ownership-lookup-interoperability.mjs`, not present in this stack. Bringing the runner without those dependencies would break CI; bringing the entire unreviewed dependency chain would cross the safety/coordination boundary. Real native signers still need independent exact-source verification and operator-controlled mTLS/HTTPS staging. The historical #188 text was adjusted in the imported docs to accurately describe this subset.

**Release boundaries:** no active broker grant, no native permissions, no paid seats, DataDuck remains unreleased, and all [#190](https://github.com/dennisbsj/DuckBio-site/pull/190) eight-service staging conditions remain outstanding. Verify exact combined head on Node 22/24 using `npm run check && npm test`; do not merge without independent review.


## Follow-up #196: complete operator-only dependency chain

The four exact offline QA prerequisite modules and the original #188 operator runner are now included in the stacked source-only integration. This **supersedes** the above #195 limitation about missing dependencies, but does not mean the real native source check has been run. Public CI uses synthetic factories. A separate operator-controlled run still requires clean six-native repositories at exact signed-source SHA pins; no native endpoints, live billing, or production logins are enabled.
