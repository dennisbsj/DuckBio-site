# Workspace native inspection — in-flight liveness and seat revocation regression

**Test-only, draft.** Stacks on draft [PR #145](https://github.com/dennisbsj/DuckBio-site/pull/145), which uses the one canonical scoped native mapping from draft #141. No active broker/HTTP changes, native app repository edits, real Stripe calls, migrated customer accounts or DataDuck activation.

The new `tests/workspace-native-inflight-liveness.test.mjs` adds six disposable **real SQLite cross-store** checks. Its fixtures have central parent sessions in the Workspace identity database, separate memberships and verified-LIVE subscription **ledger rows** in the Workspace organization database, and canonical native user/tenant mapping metadata. Every trusted Stripe/native callback is **synthetic**, never an actual provider connection.

The tests verify:
1. **Expiry while waiting:** a previously paid seat expires during a slow native identity lookup; the central session remains active, but the candidate must be denied.
2. **Seat reservation while waiting:** a legacy/manual seat can allow creation of a pending invitation, but cannot replace the independently verified current LIVE seat required to cover both an already-assigned user and the invitation. The candidate must be denied until the pending reservation is revoked.
3. **Logout while waiting:** the old parent session is revoked while the native verifier runs, and a newly minted real parent session cannot resurrect the old session ID.
4. **Organization lock switch:** clearing and selecting the other genuine Workspace organization during native lookup cannot reuse the first tenant's native identity.
5. **Organization member suspension:** the current app assignment must fail after suspension, even though a current parent session and paid seat still exist.
6. **Native verifier exactness:** only literal `true` from a trusted verifier is acceptable; objects, strings, integers, null and network failures deny. All results retain `accessGranted:false`, `licensesGranted:false`, `loginEnabled:false`.

This test branch makes **no changes** to the canonical identity-store, PR #142's duplicate registry, PR #144's backup rehearsal, or PR #145's live candidate inspector. It adds only test coverage and this documentation. It is not a proof of real paid billing, native per-request resource authorization or end-to-end PKCE across HTTPS origins.

Run `npm test` in `workspace-server`; GitHub Actions runs on Node 22 and 24. Keep draft/unmerged/undeployed; actual source-of-truth consolidation and operator/native attestation gates in issue #140 remain mandatory.
