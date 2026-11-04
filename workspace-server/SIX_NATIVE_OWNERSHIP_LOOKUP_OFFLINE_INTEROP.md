# DuckBio – six genuine native ownership lookups + signers, offline

**Draft-only, unmerged, undeployed.** This QA PR extends the pinned-source native signer rehearsal in #174, which is stacked on #167 → #164 → #162 → #150 → #145 → #141. It is independent of #170–#171 broker hardening and the parallel Stripe LIVE evidence work.

## Newly verified native backend source on 4 November 2026

The six native apps' current `main` branches contain **both** dormant ownership signers and *separate authoritative native storage lookup modules*. Contrary to the older signer-only integration notes, the **lookup code already exists** (and has its own isolated native tests). The missing part is a reviewed, authenticated live endpoint and independently provisioned real Workspace-to-native mappings. The current modules do not expose the lookup/signers via active production routes.

- CytoDuck, DuckPipe, DuckTrain, DuckMan, LabDuck: `server/workspace-native-ownership-lookup.cjs` — independently query-only SQLite native `accounts` plus exact active `workspace_native_ownership` rows, valid time windows, duplicate checks, wrong tenant/account denial.
- DuckNote: `server/workspace-native-ownership-lookup.js` — a read-only PostgreSQL `REPEATABLE READ` transaction against `eln_workspace_native_ownership`, `eln_users`, `eln_organizations`, `eln_memberships`, with active user/member and duplicate checks.

The operator source gate independently verifies the exact six native `main` SHAs already pinned in #174, the correct owner/repo origin, clean worktrees, and the exact tracked **lookup** file Git blob — including symlink rejection — before dynamic import. After execution, the source gate runs again. It does not fetch or clone private repos automatically.

## Offline operator command

Only with all six **existing**, clean private checkouts at the exact pinned SHA (see `SIX_REAL_NATIVE_SIGNER_OFFLINE_INTEROP.md`):

```sh
cd workspace-server
node six-native-ownership-lookup-interoperability.mjs \
  --sources-root /srv/duckbio-private/offline-reviewed-six \
  --confirm-offline-native-lookup-only
```

The runner dynamically loads all six **real native lookup factory exports** and the six **real native signer exports** from those pinned private source trees. It creates synthetic identities/tenants and disposable private database fixtures.

For five apps, it creates **real, isolated temporary SQLite databases** with synthetic native account and explicit mapping rows; the lookup modules execute their actual read-only SQL against these databases. For DuckNote, it uses a strict, in-process **PostgreSQL query simulator**, *not a running PostgreSQL server*; the real DuckNote lookup module's query flow and transaction handling execute, but PostgreSQL engine/DDL behavior is not proven here.

For **all six** it tests valid `inspect`, `bind`, `migrate`, wrong central/native account or tenant, revoked/expired mapping, deleted native user, duplicate current mappings, and a restored valid mapping. Before the temporary stores are destroyed, it connects the **actual six lookup functions → actual six native Ed25519 signer functions → actual Workspace draft Ed25519 verifier** through the same synthetic in-process transport, and checks fresh challenges, cross-tenant rejection, tampered signatures, signer outage and replay.

No native account database from a checkout is opened; only newly created temporary synthetic databases are used. No native private module is copied into the central public repository. The private operator must provision no production keys or credentials. The output never contains raw native identities, signing keys, source paths or bearer credentials.

## Public CI versus operator-only actual native source

The public DuckBio-site CI **cannot access the six private repositories** and does not run the actual native modules. It runs synthetic factory ABI/integration regressions verifying the exact same disposable SQLite and query-simulator harness, deny boundaries, and signer-to-Workspace connection. Green CI is **NOT** confirmation that the operator command ran against the six genuine native source files.

```sh
npm run check
node --test tests/six-native-ownership-lookup-interoperability.test.mjs
npm test
```

## Activation blockers — explicitly not satisfied

1. Privately provision and audit explicit account+tenant ownership mappings in every native datastore (no email matching or automatic trust of the central link).
2. Configure per-app private signing keys and authenticated private HTTPS service handlers with replay/rate-limit controls; do not mount dormant lookup/signers as public routes without security review.
3. Run the operator actual-six-module rehearsal, then a separate **genuine running PostgreSQL** test for DuckNote and seven-service HTTPS staging acceptance using real native accounts, controlled test organizations and monitored revocation.
4. Combine the currently independent Workspace PR stacks, including session-lock/authorization audit, non-authorizing canonical inspector, SSO audience revision, actual LIVE paid seat evidence, rollback-safe recovery and per-resource native permissions. No paid seat, SSO proof or app authorization can be inferred from a signed ownership assertion alone.
5. Obtain operator approval of staging and release boundaries. DataDuck remains a separate seventh app not covered by this original six-native ownership contract.

Every CLI result has `deploymentAuthorized:false`. No merge, production deployment, app change or license activation is made by this PR.
