# Six REAL native ownership signer modules ↔ Workspace Ed25519 verifier

**Status: operator-only, source-pinned, offline interoperability rehearsal. NOT LIVE SSO.** This QA branch is stacked on draft #167 → #164 → #162 → #150 → #145 → #141. It does not depend on the separate #170–#171 PKCE/audience hardening series. These independent draft series must be reconciled by code review before release.

> **Source refresh, 2026-11-04:** Each native repository advanced exactly one commit to add a dormant, explicitly configured loopback mTLS ownership sidecar. The previous signer and authoritative lookup modules were unchanged by those six commits (verified with GitHub commit comparisons). The six pinned review SHAs below now include the sidecars; they are not release approval.

## What was actually checked in the six native repositories

On **2026-11-04**, the actual private default-branch GitHub trees were inspected, including these existing, **UNMOUNTED** signer exports:

| Native app | Repo (private) | App ID | Reviewed commit | Source |
| --- | --- | --- | --- | --- |
| CytoDuck | dennisbsj/CytoDuck | goflo | `ba22006b75b75d6b1fbe680c3d59116768806798` | `server/workspace-native-ownership.cjs` |
| DuckNote | dennisbsj/DuckNote | eel | `c64da055b82e0f8a499c5dd6ef47eaaa089be13f` | `server/workspace-native-ownership.js` |
| DuckPipe | dennisbsj/DuckPipe | methpipe | `cd5369134c230c5afcbd0fc4a4bf9a136d5211b7` | `server/workspace-native-ownership.cjs` |
| DuckTrain | dennisbsj/DuckTrain | mantrain | `f25eabfbb0cb9ebac45c77948a14b217fa458733` | `server/workspace-native-ownership.cjs` |
| DuckMan | dennisbsj/DuckMan | duckman | `f8a86c10db6b6ec86b6224a8c81b90cebcf652d2` | `server/workspace-native-ownership.cjs` |
| LabDuck | dennisbsj/LabDuck | limsman | `48a2ee834f1bcc6eb3f910ad5399cc4883acb2bd` | `server/workspace-native-ownership.cjs` |

These exact SHAs are **code review pins for this offline rehearsal**, not staging release approval or the old six-app compatibility deployment lock. The native signers' own docs state that no authoritative trusted native-account-to-Workspace-org ownership endpoints are mounted, and that a native datastore mapping must still be implemented. Native source changes after these commits require a new separately reviewed attestation. **No native code is copied into the public central Workspace repository.**

## What is added to Workspace

`six-native-signer-interoperability.mjs`:

1. Opt-in operator-only CLI. Requires an absolute private root with restrictive permissions, exact six independent checkout directories, approved Git remotes, the six pinned HEADs, clean tracked/untracked worktrees, and no symlink substitution. Rejects a modified tracked signer. Rechecks source trees after the test.
2. Dynamically imports the **actual existing signer modules** from verified private checkouts (`DuckNote` is ESM; the five others are CJS). Does **not** mount any HTTP route or execute any app runtime entrypoint.
3. Generates disposable, independent Ed25519 keypairs for six signers, with **synthetic** native identity records, two synthetic organizations and synthetic ephemeral bearer tokens. The signer modules' actual `prove` methods talk to Workspaces's actual draft `createSignedNativeOwnershipVerifier` through an in-process `fetch` substitute. **No public/network fetch, real customer/user, persistent signing key, payment or native DB is used.**
4. For every app, exercises `inspect`, `bind`, `migrate`, exact central/native user and org mismatches, revoked native identity, altered signed payload, replayed nonce, and a native outage; all must fail closed except valid synthetic ownership.
5. Outputs only fixed six app IDs and pass/fail codes — never user IDs, keys, bearer credentials, private repository locations or response bodies. Always reports `deploymentAuthorized:false`.

### Operator execution — only when six private clones already exist

Use six clean local clone directories with exact names `CytoDuck`, `DuckNote`, `DuckPipe`, `DuckTrain`, `DuckMan`, `LabDuck` beneath a private root. The root must be mode 0700 on Linux, and all six clone HEADs must be the reviewed SHAs above; no automatic checkout or remote fetch occurs.

```sh
cd workspace-server
node six-native-signer-interoperability.mjs \
  --sources-root /srv/duckbio-private/offline-reviewed-six \
  --confirm-readonly-offline-native-signer-test
```

This command will **refuse to run** if the supplied checkouts do not already match those exact commits. The real private repos cannot be fetched by the central public GitHub Actions workflow: it has no cross-repository credential by design. Therefore **public CI only runs seven strict synthetic ABI/orchestration and source-rejection tests**, not the six actual private signer modules. Do **not** report public CI passing as proof that the operator-only genuine-source test ran.

### CI

```sh
npm run check
node --test tests/six-native-signer-interoperability.test.mjs
npm test
```

## Remaining blockers before real HTTPS SSO

- **Native team:** actual authoritative per-app user/tenant ownership lookup backed by each native datastore (DuckNote uses PostgreSQL, others have SQLite-native implementations), exact Workspace org/account mapping, and a private authenticated HTTPS endpoint that invokes the previously dormant signer. Native per-resource role/permission enforcement must stay separate and authoritative.
- **Workspace team:** reconcile drafts #167 and #171, preserve canonical tenant-lock epochs and paid-seat revocation checks, stage isolated test identities and read-only native ownership clients with reviewed key rotation.
- **Operator/staging:** prove seven genuine simultaneously running services, exact pinned/current source SHA, DNS/TLS + service identities, protected private keys, nonces/replay, and real signed endpoint replies. Synthetic signer module tests cannot satisfy these gates.

Keep this PR draft, unmerged and undeployed. DataDuck is intentionally excluded from the six original native apps' execution.
