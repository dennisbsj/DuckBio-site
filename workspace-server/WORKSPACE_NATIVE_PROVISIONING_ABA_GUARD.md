# In-flight Workspace native-provisioning authorization ABA guard (DRAFT)

**Source-only security hardening; not mounted in any broker, HTTP route, native app or billing system.** Stacked on [draft PR #152](https://github.com/dennisbsj/DuckBio-site/pull/152); its parent [#150](https://github.com/dennisbsj/DuckBio-site/pull/150) uses synthetic signed native proof and canonical [#141](https://github.com/dennisbsj/DuckBio-site/pull/141) stores the native identity metadata.

## Vulnerability that motivated this draft

A native ownership challenge may be slow. A pre-check plus post-check of only the **current** administrator and effective app permission does not detect an **ABA** sequence: administrator demoted then re-promoted, app permission disabled then re-enabled, or a seat reservation created then canceled while verification is in flight. Every individual check can see an eligible actor/target even though the underlying authorization policy changed between checks.

This proposal **fails closed on any audited organization mutation during the native challenge**, even when a later change restores the exact same visible rights.

## Implementation

- The existing private `organizationStore` gains a single **read-only method** `nativeProvisioningAuditRevision({organizationId,accountId,sessionId})`. It requires the exact currently locked session/organization tuple, then returns the latest **SQLite AUTOINCREMENT** `organization_audit.id` for that organization. No new table, data export, license, grants, site pages, native HTTP endpoint or active session mutation is introduced.
- All existing audited organization member, role, permission, paid subscription and invitation mutations advance this generation even when performed at the **exact same millisecond**. The lookup returns null for an invalid or different session/organization combination.
- The **unmounted** provisioning controller in #152 captures this generation **before** the native call and requires the identical generation at every subsequent authority callback. Signed native proof or app membership alone cannot override a changed audit generation.
- The guard also rejects unconfigured organization stores without the new method. Audited activity unrelated to the requested link may deny an in-flight operation; this conservative false negative is deliberate and safe to retry with a **new** native challenge.

## Real offline SQLite regression checks

The amended `tests/session-native-link-provisioning.test.mjs` uses both actual disposable Workspace identity/organization SQLite databases, and an ephemeral synthetic Ed25519 native signing fixture. It checks:

1. Demote and re-promote the **same** selected organization administrator during an awaited signed native reply. Although final admin membership is again valid, the link and private mapping audit must remain absent.
2. Disable and re-enable the target's `workspace.view` permission before signing concludes. Final effective permission is eligible; native bind is still denied.
3. Issue then revoke a pending paid app-seat invitation during verification. Although final live-seat-shaped capacity is again sufficient, native bind is denied.
4. Audit revision advances even when the test clock has **not moved**, and exact foreign/missing organization locks cannot retrieve a revision.

## What this does not guarantee

- The organization session-lock itself is not yet revisioned; a clear-then-reselect of the exact same session/tenant can look identical if neither operation emits an organization audit event. Add a dedicated persistent session-lock revision/epoch before this private controller is considered production-ready.
- This does **not** provide atomic transactions across separate identity and organization SQLite files/processes. An organization change occurring after the final read but before commit in another process remains a **release-blocking TOCTOU risk**. Future production activation requires a reviewed cross-store write coordination protocol or a fencing token with strong commit guarantees and fail-closed native enforcement.
- The native signed proof uses synthetic keys/transport and has not been implemented by the six native apps. Real LIVE billing evidence, authenticated browser admin UI/CSRF, exact native account status, HTTPS multi-origin E2E, production backups, security review and rollback remain mandatory.
- A valid result is **native mapping metadata**, not a login/authorization, paid seat or per-resource privilege. `accessGranted:false`, `licensesGranted:false` and `loginEnabled:false` remain unchanged in the canonical link view. DataDuck remains excluded.
- Keep #142's second scoped identity registry unmerged. Review the single canonical store sequence and do not enable real customers.

Review order: #141 → #145 → #150 → #152 → this draft. PR #144 covers separate synthetic identity backup/restore and #149 is a broker **deny-only** rehearsal; neither is modified here.
