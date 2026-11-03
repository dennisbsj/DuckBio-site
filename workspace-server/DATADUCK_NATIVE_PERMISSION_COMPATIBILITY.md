# DataDuck native permission ↔ Workspace role compatibility (source-only)

**Source phase only — no native login, role grant, checkout, seat or deployment.**

This candidate tracks DataDuck draft PR #1 (v0.27, branch `feature/isolated-backend-foundation-20261103`), specifically the native authorization inventory in `src/workspace-route-policy.mjs` (Git blob `fed3c4f462157640160f948e7105056bc1346c93`). The code remains in **Workspace's repo only**; it does not import or modify the DataDuck backend.

## Canonical coarse native roles

DataDuck has four native roles, not the organization-wide Workspace admin role:

| Native DataDuck role | Read operations | Write/derive operations | Admin operations |
| --- | --- | --- | --- |
| Admin | Yes | Yes | Yes |
| Analyst | Yes | Yes | No |
| Reviewer | Yes | No | No |
| ReadOnly | Yes | No | No |

The unmounted DataDuck native API guard currently treats **Reviewer and ReadOnly alike** for its generic read-only routes. Do not infer a special reviewer approval permission that does not exist in the native policy.

## Future fine-grained Workspace catalog

The source-only `DATADUCK_WORKSPACE_PERMISSIONS` list is the exact 16 non-self route-classification names from DataDuck's v0.27 native policy: project, dataset, figure, data derivation, account-management, current session information and capabilities. Route names are **not** public URLs.

The two native session self-service endpoints (`auth.logout` and `auth.logout_all`) are not assignable privileges. A future integration must preserve their native session/CSRF checks, while avoiding a role policy that prevents an account holder from signing out.

`inspectDataDuckPermissionCompatibility` receives a **trusted native role** from DataDuck and a **trusted future effective Workspace permission array**; it reports only whether the two models would be compatible for one known native route name. It rejects wildcard policies, unknown roles/actions, duplicate/invalid permissions and native privilege expansion.

**Every output retains `accessGranted:false`, `licensesGranted:false` and `nativeEnforcementRequired:true`.** A positive `compatible` result is not an authorization or proof of membership. Real access must independently satisfy current active Workspace session/organization, verified per-app LIVE user seat, exact native user/org binding, native account status, DataDuck's project/dataset ownership and native route guard at the time of each protected request.

## Boundaries and next integration tasks

- No changes to the existing six-app canonical `suite-permissions.json`, the active `APPLICATIONS` array, Stripe plans/checkout, the private UI, production broker registrations or existing customer subscriptions. DataDuck still appears only as an upcoming integration candidate.
- The catalog requires **synchronization against DataDuck's native route policy** when that PR changes or merges. The pinned Git blob is a review reference, not automatic source synchronization.
- At activation, a Workspace role with `admin.user_role` cannot elevate an Analyst, Reviewer or ReadOnly native account into Admin: native role checks are separate and authoritative. Native Admin must be explicitly assigned and audited in DataDuck.
- Link the compatible native role/route mapping only after PR #128's commercial decision, PR #134's native UUID linkage, PR #135's seven-app seat transition and PR #136's central access preflight are reviewed; an appropriate actual native E2E security review is mandatory.

Run `npm test` from `workspace-server/` to execute the offline, immutable-contract tests. No DataDuck repository, native API endpoint, customer account or payment is touched by these tests.
