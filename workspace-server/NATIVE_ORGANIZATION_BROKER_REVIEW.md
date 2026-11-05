# Private org-native broker access adapter (DORMANT)

Source-only candidate for eventual Workspace org-mode PKCE; **not imported by the active Workspace broker or runtime**, and should not be mounted until independent review and genuine eight-service staging acceptance.

Proposed private trusted stack: canonical live parent from identity-store; server-selected immutable session organization + monotonic selection revision; current active user; current custom role and workspace.view permission with a VERIFIED Stripe LIVE subscription allocation; explicit org-scoped native identity link + monotonic audit revision; signed private native ownership proof through createWorkspaceNativeAccessInspector; and all of these reread after the awaited native verifier. No email-based joining or legacy GLOBAL (user,app) grant fallback. DataDuck remains blocked until its native production authorization is reviewed.

On a positive private inspection it creates a broker-compatible localIdentity with the exact native user and native tenant, plus a deterministic SHA-256 bindingRevision containing all three durable revocation epochs, the role, paid period, and the parent/org/app/native tuple. The existing broker liveProof rechecks this binding at introspection. A changed epoch or current paid expiry denies before any new child proof.

***Scope and limitation***: this grant-capable adapter is intentionally dormant. Its 13 new isolated tests use synthetic trusted stores and a stub inspector, not actual signed native Ed25519 proofs, real Stripe or real app databases. It does not grant native scientific resource permissions, replace native MFA or authorize an active service just by being present in source. The existing live organization-mode identity adapter remains fail-closed and returns no grant. Do not wire this candidate to production without a genuine signed-native, per-app resource ACL, verified LIVE payments, a full exact-head Node/browser suite, eight HTTPS services, restore/rollback drills and explicit approval.

Focused offline tests: node --test tests/native-organization-access-adapter.test.mjs (13 cases on Node 22.16.0).
