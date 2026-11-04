# Workspace native SSO — combined authorization + signed ownership QA preview

**Status (2026-11-04): DRAFT, OFFLINE, NON-AUTHORIZING, NOT DEPLOYED.**

This is the first isolated **two-parent merge preview** of two independently developed Workspace security tracks:

1. **PKCE + authorization epoch** #171 → #170 → #168 → #166 → #149 → #145 → #141. Code exchange/session proof pins exact app audience, local native identity and parent session. Canonical organization/seat/role permission generations are validated both sides of awaited native ownership. The `createWorkspaceNativeBrokerDenyAdapter` deliberately returns **null** for all native app grants even when the canonical inspector returns a positive candidate.
2. **Native ownership verification + source/lookup interoperability** #176 → #174 → #167 → #164 → #162 → #150 → #145 → #141. Pinned Ed25519 verifier with HTTPS/TLS validation; six existing dormant native signers and read-only native ownership lookup contracts; real temporary SQLite data and a strict mock DuckNote PostgreSQL-query seam.

The two tracks touch **one overlapping file**: `workspace-server/package.json`. Its `npm run check` script includes the full unique syntax-check set from both parents. All other additional files on the PKCE track were unchanged on the native verifier track relative to their common #145 ancestor. A **real merge commit with both parents** preserves both independent histories, with no fast-forward to `main`. This PR is a combined review target, **not** permission to merge downstream drafts or activate a service.

## New combined end-to-end offline regressions

The merged `tests/signed-native-ownership-cross-store.test.mjs` uses:
- Real disposable Workspace **identity and organization SQLite** stores and a synthetic independently verified LIVE-shaped subscription transition.
- The actual Workspace **signed Ed25519 native ownership verifier** using an ephemeral key and in-process transport. It is NOT a connected native backend or actual subscription.
- The updated **role/seat/native mapping authority audit generation** and selected-tenant inspector from #168.
- The real **PKCE HTTP broker** and explicit **native deny adapter** from #149/#171.

The combined tests demonstrate:
- Cryptographically valid native ownership + active current membership/role + synthetic LIVE-shaped seat + exact scoped binding yields a **candidate only**; the HTTP broker must respond `403 access_denied` and mint **zero codes and zero child proofs**.
- In-flight **permission revoke-and-regrant (ABA)** during a valid signed native answer is rejected even if final role, permission and native identity are unchanged; the private binding revision changes.
- In-flight **native link revoke-and-rebind** to the identical native user and tenant during signed verification is rejected, and the private binding revision changes.

The existing tests from both parents also cover exact PKCE audience/identity, six-app signer signatures, malformed callbacks/key rotation, SQLite authority audits, tenant leakage prevention, and the offline operator-only lookup module runner.

## Review decisions and release blockers

- **Do not wire a positive preflight candidate into broker `getAccess`.** It intentionally returns `null` and is not an entitlement. Never infer a paid seat or a native role from a signed ownership response.
- **Do not deploy or merge** until the overlapping independent PR stacks are reviewed/rebased with their other concurrent Workspace changes (including session-epoch, cross-store recovery and Stripe LIVE evidence). A green combined CI here does not mean those additional stacks are present.
- Native backend signers/lookups remain **unmounted** and lack active reviewed authenticated HTTPS endpoints with real independently operator-provisioned ownership mappings. The actual six private native modules **have not been run** in this repository's public CI. DuckNote's Postgres query is only simulated here, not backed by a PostgreSQL service.
- Review rollback and rotation of independent authorization epochs after SQLite backup restores: database audit sequence values alone are **not rollback-proof**.
- Separate runtime source/release evidence, real live paid seats, explicit per-request native resource permissions, isolated HTTPS staging, negative tests and audit/log controls are still required.
- DataDuck is the **seventh app** and is not enabled by the original six-app SSO grant path.

No user, app login, subscription, native app repository, customer data or production runtime was changed.
