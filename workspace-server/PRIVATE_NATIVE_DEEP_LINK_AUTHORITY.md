# Native content deep links are navigation, never legacy SSO authority

**Status: draft source-only. No native resource, scientific data, paid entitlement or browser SSO activation.**

Previous private `/content/<global-id>` navigation checked native resolver `authorized:true`, exact HTTPS app origin and a central `organizationStore.accessFor` role assignment. That last check does **not** establish active verified-LIVE app seats, a current selected session-organization, current exact scoped native user/organization, or that an in-flight role/seat change didn't invalidate navigation. An old global grant is never suitable evidence for this route.

The reviewed update in `private-content-launch.mjs` now requires:
- A live, exact, server-side parent session and its selected organization with the persistent monotonic `sessionSelectionRevision` (#192).
- A fresh `verifiedNativePermissionCandidate` for that exact active account/org/app and `workspace.view`, including verified LIVE paid-seat capacity, current membership and effective permission, the current `authorizationAuditRevision` (#187/#197), and an expiry-limited paid period. This positive result **still has** `accessGranted:false` and `licensesGranted:false`.
- A real, previously verified **organization-scoped native link** with exact native user/org IDs, its independently monotonic `linkRevision`, and `linkOnly:true` from the separate native identity store. A legacy global grant is not consulted.
- An independent **trusted native resource resolver** which returns `authorized:true` and explicitly confirms the same native user/org and app/resource/Workspace organization. No email matching, guessed native user, or browser-supplied organization is permitted.
- After the awaited native lookup, re-read authentic parent session, selected organization epoch, current paid/role policy epoch, and scoped native identity/link generation. Any changed or missing value (including clear/reselect or revoke/regrant ABA) refuses navigation.
- A final exact, configured HTTPS app origin and path `/content/<opaque-id>`; no credentials, query strings, fragments or arbitrary redirect hosts.

This **intentionally fails closed** for unmounted native lookup and legacy environments without a reviewed scoped link. The native resolver contract must be extended to provide the exact native tuple; unresolved existing callers will not obtain a redirect until reviewed. Existing standalone SSO login is unaffected because it has a different access path.

An allowed 303 redirect is **not** a session token, signed proof, permission to read content, or permission to bypass the native app. The native backend must still perform its own current per-request authorization, CSRF and scientific-data access checks. These tests use synthetic trusted collaborators, not installed native services. DataDuck global content ID prefixes have not been enabled.

Integration dependencies: [PR #201](https://github.com/dennisbsj/DuckBio-site/pull/201), [native preflight #191](https://github.com/dennisbsj/DuckBio-site/pull/191), [session epoch #192](https://github.com/dennisbsj/DuckBio-site/pull/192) and [activation plan #190](https://github.com/dennisbsj/DuckBio-site/pull/190). No merges/deployments or live seat actions are authorized.
