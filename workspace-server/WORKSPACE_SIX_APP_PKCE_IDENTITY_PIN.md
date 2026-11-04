# Six-app PKCE native identity pin — review-only

This draft is stacked on #168 → #166 → #149 → #145 → #141. Its scope is the existing Workspace broker handoff only. It does **not** activate native SSO, change any native app repo, implement DataDuck, grant app permissions, or deploy production code.

## Fixed failure mode

Previously, a PKCE authorization code was bound to the parent session, client, app, state/challenge, redirect, and (on the new #166 branch) optionally a grant generation. At exchange, the broker obtained the **current** native local identity. If a grant changed between code issuance and redemption without an accompanying `bindingRevision` change (including historical unbound grants), the code could be redeemed for a **different native user or tenant**.

The code now records the *exact normalized* `localIdentity` (`userId` plus optional `organizationId`) inside the **private short-lived authorization code record**. On PKCE exchange, after atomic one-time consumption and rechecking the trusted parent and current app grant, both the revision **and exact native identity snapshot** must equal their issued values. Changes deny with `401 invalid_grant` and never mint an app proof.

A historical code record without the new snapshot is intentionally rejected. These codes expire in at most 60 seconds; a fresh authorization flow is required on upgrading to this broker version. Existing issued session proofs continue to use their normal live entitlement checks.

This protection is complementary to — not a substitute for — revocation-generation checks in #166 and #168: a revoke-and-regrant using the same exact native identity requires a monotonic authorization revision; a live subscription and native backend authority must still be verified independently.

## Real storage and six-app coverage

`tests/shared-auth-pkce-identity-pin.test.mjs` runs the real Workspace broker's HTTP authorize/exchange/introspect APIs with a disposable, durable **SQLite** authentication store, and six registered synthetic native clients:

- LabDuck (`limsman`)
- DuckNote (`eel`)
- DuckPipe (`methpipe`)
- DuckTrain (`mantrain`)
- DuckMan (`duckman`)
- CytoDuck (`goflo`)

It exercises native user switches in legacy mode, tenant switches despite stable revisions, unchanged strict revisions, malformed old code rows lacking identity snapshots, and withdrawn grants. Synthetic identity adapters are used only for test inputs; native backend ownership, HTTPS production topology and genuine paid-seat verification are not claimed.

From `workspace-server`:

```sh
npm run check
node --test tests/shared-auth-pkce-identity-pin.test.mjs tests/shared-auth-broker-binding-revision.test.mjs tests/native-six-app-pkce-contract.test.mjs
npm test
```

## Release boundary

Keep draft, unmerged and undeployed. #149 continues to return `null` for native broker `getAccess`. A future authoritative adapter must not infer permission from a positive #168 preflight, and security gating remains under #140 / #26.
