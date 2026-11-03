# Six original native apps — authenticated HTTP session and Workspace link staging acceptance

**Source code and test harness only. This procedure has not been executed against a real installed seven-service staging server.** It does not create, grant, revoke or modify sessions, roles, permissions, licensed seats, native records, backups or production assets. DataDuck is excluded.

## The remaining identity boundary this covers

[The six-native broker proof witness](SIX_NATIVE_AUTHENTICATED_STAGING_ACCEPTANCE.md) verifies central Workspace's six distinct broker proofs, organizations, session scopes and foreign-app rejection. It cannot tell whether each native app's **own current logged-in user session** and linked Workspace status refer to that same mapped native identity.

This third and separate opt-in witness, `staging-six-native-http-sessions-audit.mjs`, closes that **read-only native HTTP identity boundary**. It requires the full previous broker proof check to pass, which itself requires actual running seven-service systemd/process/HTTPS source verification, **before** it sends *any native browser session cookie*. All six native backends must already have been independently installed, logged into with synthetic disposable local users, and linked to Workspace using the real native SSO/PKCE flow by an authorized operator.

## Fixed native routes verified at the six pinned source versions

| Original app | Private native cookie name | Read-only own identity | Read-only Workspace link | Read-only protected communications |
|---|---|---|---|---|
| CytoDuck (`goflo`) | `science_goflo_session` | `/api/auth/status` | `/api/suite/workspace/status` | `/api/suite/workspace/unread` |
| DuckNote (`eel`) | `eln_session` | `/api/auth/status` | `/api/suite/workspace/status` | `/api/suite/workspace/unread` |
| DuckPipe (`methpipe`) | `science_methpipe_session` | `/api/auth/status` | `/api/suite/workspace/status` | `/api/suite/workspace/unread` |
| DuckTrain (`mantrain`) | `science_mantrain_session` | `/api/auth/status` | `/api/suite/workspace/status` | `/api/suite/workspace/unread` |
| DuckMan (`duckman`) | `duckman_session` | `/api/auth/status` | `/api/suite/communications/link-status` | `/api/suite/communications/unread` |
| LabDuck (`limsman`) | `LIMSMAN_SESSION` | `/api.php?action=session` | `/api.php?action=workspace_status` | `/api.php?action=workspace_unread` |

After the genuine-service+broker checks pass, the tool makes **exactly four GET requests per app** over its independently validated, configured native HTTPS origin:

1. With that native app's **own** valid pre-existing synthetic native session cookie, its `user.id` must match the **native local user ID from its existing successful central broker proof**, not its email or another user's native identity.
2. With the same cookie, its own Workspace-link status must be positive. DuckMan's native contract returns `{connected:true}`; the other five apps use `{enabled:true,linked:true}`.
3. With the same cookie, a read-only protected native communications endpoint must return HTTP 200 with valid bounded integer `chat`, `mail` and `notifications` counts (DuckMan additionally requires `connected:true`). A 503 or fabricated/malformed success cannot pass.
4. With the **next native app's different cookie** (not the correct cookie), the same application's identity endpoint must deny access or return `user:null`. It must never expose the first user's identity via another app's cookie.

The four requests are deliberately non-mutating **GETs**. No passwords, POSTs, code exchanges, refresh tokens, CSRF bypasses, app data writes, user/role updates, logout/revoke or external host discovery. Redirects, unexpected URLs, non-JSON 200 responses, response bodies over 4 KiB, non-200 successes and network failures do not pass.

This step verifies native **login identity/session separation and Workspace link at the time of the GET**. It does **not** prove native resource permissions or native paid-seat enforcement. A linked account and unread counter are not license grants.

## Required private operator inputs

The same private synthetic-only Workspace JSON, six original reviewed source SHAs and [broker proof bundle](SIX_NATIVE_AUTHENTICATED_STAGING_ACCEPTANCE.md) are mandatory. That earlier owner-only 0600 proof JSON contains six broker user IDs and organization IDs, plus previously generated positive/negative opaque broker tokens.

Provide an **additional, owner-only 0600 JSON file** of six existing synthetic native HTTP session cookie values, outside all Git repositories, public UI/assets, application data exports and CI. It has **exactly**:

- `version`: integer `1`.
- `scope`: `synthetic-six-native-http-session-cookies`.
- `workspaceSha`: `1a3b19c993fcd63ff625113cc2628b2642fe2d2f`.
- `sessions`: array of **exactly six records**, ordered `goflo`, `eel`, `methpipe`, `mantrain`, `duckman`, `limsman`. Each record has only `appId` and `cookie`, where `cookie` is the exact matching allowlisted name and an opaque base64url/hex token (for example, the cookie value after the response's `Set-Cookie` name). Every cookie must be distinct.

The native cookies and central broker proofs must refer to **the same six synthetic native users**, already linked normally. Do not put real accounts, production sessions, central browser cookies, payment credentials, cross-domain cookie strings or additional fields in either file. The CLI imports both with the same fail-closed private file reader, rejects symlinks and group/world-readable copies and never prints their contents. Operators should securely delete expired synthetic bundles afterwards, under their own retention policy.

Example command, **only on the previously approved, genuinely installed synthetic staging host**:

```bash
cd /path/to/trusted/tooling/DuckBio-site/workspace-server

node staging-six-native-http-sessions-audit.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --broker-proofs /srv/duckbio-private/proofs/synthetic-six-broker-proofs.json \
  --native-cookies /srv/duckbio-private/proofs/synthetic-six-native-cookies.json \
  --confirm-readonly-synthetic-sessions-only
```

These filesystem paths are **illustrative**. They are not evidence that this staging host exists. No real cookie/proof file is created or stored by GitHub CI. CI runs only simulated private HTTP replies, and the existing independent native browser and broker tests.

## Required follow-up acceptance

Even a future PASS on a genuine installed staging host would prove only: source-verified processes, anonymous seven-origin boundaries, central broker scoping and six native local session/link identity boundaries. It does not prove live subscription/seat withdrawal, default/custom role permission enforcement inside every protected scientific endpoint, native MFA, full concurrent multi-browser workflow, native data isolation and audit, backup/restore or rollback. Those checks remain separate release blockers.

The other Workspace conversation owns the central verified effective-permission/organization/paid-entitlement contract (currently being developed on separate draft PRs). The six-native integration lane will test its adoption when it is available. [Workspace issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26) remains open; no actual hosting or production changes are authorized by this procedure.
