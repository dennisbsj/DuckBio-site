# Original six native apps — security enforcement audit and integration handoff

**Source review: 4 November 2026. Status: a source-based review, NOT a tested central-policy enforcement release.** Owner: six-original-app native integration lane. The other Workspace backend conversation owns shared organization, role, subscription, seat and identity APIs. DataDuck has its own development lane and is **not part of this audit**.

## Executive result

All six original native applications retain independent authenticated backend sessions and their own local role/entitlement enforcement. They were individually tested with the fixed central Workspace SSO broker for PKCE, session proof issuance, session binding and linked communications. **Those facts do not establish that a centrally edited Workspace role, custom permission or purchased/revoked app seat is enforced in any native scientific/regulated resource endpoint.**

The current Workspace shared organization permissions catalog explicitly reports `rolePolicyEnforcedByNative:false`. Its native broker introspection and communication APIs are a distinct contract from each native app's authorization of laboratory data, methods, analyses, training, documents and signatures. The old broker proof binding itself cannot be treated as an access grant.

**No unconditional switch to central policy may be merged until the other backend conversation publishes a reviewed, authenticated, monotonically versioned, organization-scoped entitlement/policy contract with well-defined failure and revocation semantics.** Doing so now would either break users, re-enable revoked access, or create a brittle second source of truth. There is NO production go-live approval from these existing native SSO/QA tests.

## Verified code surfaces and local permissions

| App / repository | Current app-side session and permission authority | Existing Workspace binding | Release-blocking integration gap |
|---|---|---|---|
| CytoDuck (`dennisbsj/CytoDuck`, `goflo`) | `server/auth.cjs`: native `sessions` and `accounts.suite_role`; loaded `suite-permissions.json` `GoFlo` roles; `requirePermission`, `commitActor`, and per-request `protectedAccess` license check. Existing race/role/license tests: `tests/auth-boundary.test.cjs`. | `server/workspace-native-link.cjs` binds opaque PKCE broker proof to local session hash, local user ID and one configured private native organization ID. `/api/suite/workspace/*` is a linked communications boundary. | Workspace custom role/permission downgrade and live app-seat withdrawal are NOT shown to affect a protected analysis, gating, review or export request. |
| DuckNote (`dennisbsj/DuckNote`, `eel`) | `server/index.js` authenticates native ELN session, membership role and native entitlement; local roles owner/admin/scientist/reviewer/read_only; approval and write routes use native authority. Existing native tests include `server/workspace-native-identity.test.js`. | `server/workspace-native-identity.js` binds the **exact native session + user + organization + membership** with a second active-entitlement check. `server/workspace-native-http.js` separately handles Workspace connect/unread/callback. | Central Workspace app-seat/custom role changes still have no verified enforcement at native document edits, signatures, approvals, attachment access or export; tenant mapping needs explicit reviewed equivalence rather than email matching. |
| DuckPipe (`dennisbsj/DuckPipe`, `methpipe`) | `server/auth.cjs`: local accounts, sessions, local `suite_role` / `MethPipe` permissions, license check, and revalidation before method/workspace/workflow writes. `tests/authorization-boundary.test.cjs` covers changing roles, sessions and local grants while uploads wait. | `server/workspace-native-link.cjs` validates broker proof issuer, audience, local user and a single configured native organization. | No proven live central `method.edit`, `result.sign.*` or per-app seat enforcement before scientific mutations, imports and exports. |
| DuckTrain (`dennisbsj/DuckTrain`, `mantrain`) | `server/auth.cjs`: native users, local roles Learner/Trainer/QA/Admin/ReadOnly, local entitlement and per-record learner completion/trainer signoff checks; `tests/auth-boundary.test.cjs` tests role/session/licence changes during requests. | `server/workspace-native-link.cjs` binds local session/user/single fixed native organization to broker proof. | A centrally revoked `training.signoff`, `qualification.manage`, organization membership or active seat is not yet demonstrated to deny native evidence/signoff at commit time. |
| DuckMan (`dennisbsj/DuckMan`, `duckman`) | `server/index.cjs`: native account roles admin/editor/reviewer/read_only, independent native session and licensing; `currentWriteUser` checks local authority before file/library/role writes. `tests/server-auth-boundary.test.cjs` includes revoke-during-upload negative tests. | `server/workspace-session-link.cjs` stores per-native-session broker proofs sealed with a private key. `server/workspace-native-broker.cjs` introspects broker proof for linked communication. | Central role/seat revocation is not verified to block a native document revision, effective issue, independent approval, controlled copy, file download or native role change. |
| LabDuck (`dennisbsj/LabDuck`, `limsman`) | `server/auth-base.cjs` and `server/index.cjs`: native session, auth version, Analyst/QC/QA/isAdmin role, native entitlement and reauthentication; `tests/node-auth-boundary.test.cjs` checks revocation during protected operations. A PHP compatibility path also exists. | `server/workspace-native-link.cjs` binds broker proof to one configured native organization/user/session; Node `api.php?action=workspace_*` routes remain separate from scientific command handling. | Central role/seat and cross-organization changes not yet proven to stop native sample edit, approval, batch release or export; any old PHP route must be reviewed alongside Node for a future supported rollout. |

The six `suite-permissions.json` files describe app-specific **native** role policies. They are not proof that central Workspace custom roles are synchronized, distributed or enforced. A linked Workspace account does not automatically entitle the holder to any app function.

### Explicitly NOT flagged as newly discovered native bypasses

The above review did **not** demonstrate a new exploitable bypass in these specific local-auth flows. They already have substantial role/session/licence race tests. The gap is architectural: central Workspaces and native apps have independently valid security sources. Do not describe this as an existing anonymous login bypass, and do not switch existing local access controls off.

The existing standalone/native source documents also explicitly describe a **single authorized native organization per installation** for CytoDuck, DuckPipe, DuckTrain and related deployments. Do not claim that multiple Workspace organizations can share a single such native database just because Workspace has multi-organization accounts. DuckNote has its own native organization memberships, but equivalent central-to-native bindings are still subject to verified mapping and operator authorization. Scoped native identity records in Workspace draft PRs are not yet a live broker authorization contract.

## Contract required from the OTHER Workspace-backend lane before native implementation

Provide a private, fully authenticated native-server contract or reviewed local verifier (not browser-supplied and not merely an SSO identity document) with:

1. **Exact identity/tenant binding:** immutable central user ID, exact Workspace organization ID, app ID, native local user ID and native organization ID, tied to a concrete authenticated native session and an independently verified scoped identity mapping. No email-based joins, cross-tenant fallback or silent legacy migration.
2. **Actual grant:** current verified active membership, effective explicit permissions for the one app and resource/action, and current verified purchased app-seat/entitlement. A pending, missing, revoked, suspended, wrong-app or wrong-tenant grant is denied. Require explicit policy and grant version or revision. Preserve existing native approval/signature independence.
3. **Revocation coherence:** session parent/child revocation, password/role changes, organization changes, app-seat withdrawal and license expiration must invalidate effective access with a monotonic security revision. Define refresh/cache TTL and bounds; a stale cached allow may not outlive a revocation.
4. **Error behavior:** timeouts/invalid signatures/unavailable central service must never turn into local `allowed`, implicit Admin, or a legacy role bypass. Define explicit fail-closed behavior and handling of ongoing native operations (recheck before mutations and after async waits).
5. **Migration and rollback:** how already-purchased/native standalone accounts are explicitly mapped, how native credentials and historical audit signatures are preserved, and whether a previously unsupported centralized policy remains disabled until the operator approves activation. No destructive data changes or automatic license transfer.

Until this contract is published and approved, the native integration lane will **not** invent its response shape, sign new grants, alter Workspace role catalogs, or claim that SSO alone enforces subscription seats.

## First authenticated native acceptance matrix after contract publication

For each of the six real native backends, run these against a **separately authorized, installed seven-service synthetic staging**, with distinct local/central accounts and two isolated Workspace organizations:

| Scenario | Must happen | Native evidence |
|---|---|---|
| Wrong native user, app or Workspace org binding | Deny before any sensitive content, no data write | Native API 401/403, unchanged stored records/audit |
| App seat revoked / membership disabled | Existing native session cannot continue protected reads/writes after the agreed revocation barrier | Native API denial, exact central grant revision and absence of post-revocation commits |
| Remove one specific permission while leaving other permissions | Forbidden native operation denied, unrelated allowed action remains available | One denied write/signature and one authorized operation |
| Downgrade role, revoke session or remove seat during an in-flight request | Recheck at commit time, fail closed and leave scientific/document/audit history intact | Native transaction and exact data snapshots |
| Two organizations with same Workspace account | No cross-tenant record or identity reuse; one-org app installation remains single-tenant where applicable | Two independent real native identities, denied wrong-org operations |
| Central authorization service times out or returns malformed data | Deny sensitive operation; no blind local fallback to paid/legacy grant | Native denial with unchanged persistent state and no secret exposure |
| Real PKCE exchange, native MFA and global logout | Broker and native session mapping accurately follows agreed logout/grant policy | HTTPS browser/API traces without token leakage |
| Backup/restore/rollback of revoked access | Old snapshot must not silently resurrect central permissions, seats, membership or child sessions | Independent real Workspace/native DB restore plus post-restore unauthorized attempts |

Use the existing [complete offline seven-source prestart](SEVEN_COMPLETE_OFFLINE_PRESTART.md), [genuine seven-process and anonymous HTTPS witness](SEVEN_GENUINE_STAGING_ACCEPTANCE.md), [six native broker-proof witness](SIX_NATIVE_AUTHENTICATED_STAGING_ACCEPTANCE.md), and [six native HTTP session/link witness](SIX_NATIVE_HTTP_SESSION_STAGING_ACCEPTANCE.md) as prerequisites. **Those existing checks do not substitute for this final authorization matrix.**

## Safe current next step

Continue independent native backend verification for the six original apps and add **native-specific negative/positive permission tests only where real missing coverage is found**. Keep the shared Workspace policy and entitlement implementation in the other conversation. Once it publishes the private verified contract, update the native integrations in separate, app-owned feature branches and PRs; run each native test suite and combined staging checks. Do not deploy customer data, activate old cHosting jobs, alter live Stripe or mark production ready.

Track the integration work and source SHA changes in [Workspace issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26). DataDuck will be integrated as a **separate final stage** after all six originals and the shared Workspace contract pass staged acceptance; its independent source development does not need to stop while this happens.
