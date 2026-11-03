# Six original DuckBio apps — authenticated broker proof staging witness

**Status: implemented as opt-in test tooling, NOT executed against a real seven-service staging host.** This is an independent integration-lane check of Workspace and the six **original** apps only: CytoDuck (`goflo`), DuckNote (`eel`), DuckPipe (`methpipe`), DuckTrain (`mantrain`), DuckMan (`duckman`), LabDuck (`limsman`). **DataDuck is excluded.** It neither edits nor depends on unfinished shared Workspace admin/roles/licensing code.

## What it tests, precisely

The already existing central Workspace native API supports a server-authenticated **read-only POST** to `/api/suite/auth/introspect`, with the correct native client's Basic secret and opaque native broker proof. It returns `active: true`, scoped to the native client, subject, local user/organization and expiry — or exactly `{active:false}` when the proof is not valid for that client.

The operator-only `staging-six-native-auth-proof-audit.mjs` first executes [the read-only seven-GENUINE-process/HTTPS gate](SEVEN_GENUINE_STAGING_ACCEPTANCE.md) using the six-app current source lock: verified seven pristine reviewed Git checkouts, seven real active systemd Node processes and seven configured HTTPS hosts. **Only after it passes** does this step make authenticated broker requests. It does **not** send requests to the six native origins with client secrets. It uses precisely the configured private Workspace HTTPS origin.

For each of the six native app IDs, it checks:

1. A **live, pre-existing, synthetic** broker proof returns HTTP 200 JSON with `active:true`, the exact issuer and audience, synthetic test account subject, correct synthetic native user ID, correct organization ID and a future expiry.
2. A **separate, pre-existing revoked/expired** proof for the same native app returns exactly `{active:false}`, without leaking an identity.
3. The next native app in the six-app order, authenticating with its **own** registered secret, sees `{active:false}` for the first app's live proof (no audience/token borrowing).

That is **18 read-only broker introspection requests** after one genuine seven-process/anonymous-HTTPS witness. This is a *broker-side audience/session/mapping acceptance check*, NOT a proof of native app resource permission enforcement, verified live paid seats, native MFA, multi-browser full PKCE flow or exact historical revocation event.

## Preconditions — cannot bypass

A separately approved operator must have already provisioned an **isolated synthetic-only** Linux staging installation with seven real, running services, seven valid HTTPS origins, distinct private app databases, synthetic-only users and private config, and pass the [current source-locked staging plan](CURRENT_SIX_NATIVE_STAGING_PLAN.md).

A trusted operator uses the existing *normal synthetic native PKCE SSO flow* in the private staging environment to obtain six **live** server-side native broker proofs, plus six separate **previously revoked or expired** proofs. The private operator harness must preserve the opaque tokens securely and place them in a **new owner-only 0600 JSON file**, outside every Git repository, CI artifact, native app public web root and backup. Do not print tokens, read them from browser/client JS, paste them into tickets, messages or GitHub, or use customer/production sessions. No new proof issuance, login, revocation or payments are performed by this auditor.

The file must have exactly four top-level keys:

| Field | Required value |
|---|---|
| `version` | Integer `1` |
| `scope` | `synthetic-six-original-native-broker-proofs` |
| `workspaceSha` | `1a3b19c993fcd63ff625113cc2628b2642fe2d2f` |
| `assertions` | Array of exactly six app records in the order shown above |

Each app record must have **exactly** these six fields: `appId`, `activeToken`, `inactiveToken`, `subject`, `localUserId`, `organizationId`. All 12 opaque tokens must be unique and match the normal native broker token format. Each `localUserId` and `organizationId` must begin with `synthetic-`. The `subject` is the *synthetic parent account's server identifier*, not the login email. No passwords, payment details, client secrets, cookies or production identifiers belong in the file; those are rejected as extra keys. The only client credentials accepted come from the already validated private Workspace staging config.

The auditor refuses invalid config, unknown/seventh app, different reviewed snapshot, duplicated tokens, unexpected field, absent owner-only proof file, foreign or inactive actual service, broken native source/HTTPS, invalid broker response, redirection, cookies, missing cache-control, oversized JSON or network errors. It does not print any response, user ID, URL, token, client secret or file content.

## Operator-only invocation after installation

The paths below are **illustrative only**; their presence is not assumed. Use a reviewed, newer operator tooling checkout, while the **seven running source trees** must match the immutable six-native current QA lock.

```bash
cd /path/to/trusted/verified/DuckBio-site/workspace-server

node staging-six-native-auth-proof-audit.mjs \
  --config /srv/duckbio-private/staging/workspace-staging.json \
  --sources-root /srv/duckbio-private/seven-reviewed-sources \
  --proofs /srv/duckbio-private/proofs/synthetic-six-broker-proofs.json \
  --confirm-synthetic-auth-proof-inspection-only
```

The tool is deliberately **not** run in GitHub Actions with real staging proofs. GitHub Actions executes isolated in-memory negative/positive simulations on Node 22 and 24, without access to actual staging servers, accounts or credentials. Never add the private proof file or a remote-test token to a repository or CI secret as a shortcut.

## Independent acceptance still required

Even if the above real-host gate eventually passes, a true seven-real-service **authenticated** end-to-end release test still requires each native backend to enforce user role/resource permissions and independently verified live entitlements, synthetic role update/seat withdrawal/tenant mismatch/expiry/revoke scenarios, real native MFA behavior, browser redirect/state/PKCE tests through the full seven-HTTPS deployment, genuine database restoration and operator rollback. Those tests are **not** implemented or asserted by the broker-only proof witness.

The central Workspace conversation owns the shared permission/entitlement enforcement contract (currently the new access inspector is unmerged and dormant). This conversation owns original six-native integrations and their acceptance tests. [Issue #26](https://github.com/dennisbsj/DuckBio-site/issues/26) remains open until independent staging and authorization requirements are satisfied. No live host, billing, production, customer data or DataDuck was touched by these test tools.
