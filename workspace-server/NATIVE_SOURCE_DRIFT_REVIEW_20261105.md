# Six-native signer source drift review — 5 November 2026

This is a **read-only, date-stamped source inventory**, NOT a new trusted source lock, native integration, authenticated database run, production grant or staging acceptance. The six native GitHub repositories are private.

## Repository HEAD drift vs historical signer source lock

| Original native app | Historical reviewed HEAD (in Workspace source audit) | Current `main` at inspection | HEAD changed? |
|---|---|---|---|
| CytoDuck (`goflo`) | `ba22006b75b75d6b1fbe680c3d59116768806798` | `ba22006b75b75d6b1fbe680c3d59116768806798` | No |
| DuckNote (`eel`) | `c64da055b82e0f8a499c5dd6ef47eaaa089be13f` | `83f3892442eabb64f050934d435d39c4e72b3d8b` | Yes |
| DuckPipe (`methpipe`) | `cd5369134c230c5afcbd0fc4a4bf9a136d5211b7` | `6acd3fec8d8a3c057b15fb79c9f47351c54c8294` | Yes |
| DuckTrain (`mantrain`) | `f25eabfbb0cb9ebac45c77948a14b217fa458733` | `977bc15111004b71f9fc6e95d8facbb4bc2a3bcd` | Yes |
| DuckMan (`duckman`) | `f8a86c10db6b6ec86b6224a8c81b90cebcf652d2` | `a1cf2ff6ba7f1d7d95cbd7a8af1d3a3149667257` | Yes |
| LabDuck (`limsman`) | `48a2ee834f1bcc6eb3f910ad5399cc4883acb2bd` | `e03f49d3df81719db6fc7c5d6c64a050edec9641` | Yes |

**Result:** All 18 original `server/workspace-native-ownership.*`, `server/workspace-native-ownership-lookup.*` and `server/workspace-native-ownership-https.*` Git blobs are **still byte-identical** on these six currently inspected main commits compared with the original Workspace pinned source blob inventory. However, **5 of 6 repository commit identities have changed**, and changed surrounding code/dependencies can affect behavior. An old blob hash is not a complete reviewed native release or proof that the actual native HTTP pipeline enforces central licensing.

The genuine source-runner in [#196](https://github.com/dennisbsj/DuckBio-site/pull/196) intentionally pins the **historical reviewed repository SHAs**, not the newer main commits. Do not silently replace the lock with `main` or accept the 18 unchanged source blobs as new head approval. A source operator must explicitly review dependency changes, lock the new exact main commits or reviewed integration heads, provide read-only private Git access, and execute the genuine signer tests. Historical lock continues to provide reproducible evidence for the previous reviewed source.

## New native readiness relevant to Workspace

- **DuckNote [#146](https://github.com/dennisbsj/DuckNote/pull/146)** is an *open unmerged* (non-draft) native PostgreSQL lookup integration with real read-only membership/tenant checks and Ed25519 proof regression. It is not part of DuckNote `main`; no live signed native HTTPS sidecar or actual Workspace role grant is activated by that PR. It deserves independent review before updating native source pins.
- **DataDuck [#1](https://github.com/dennisbsj/DataDuck/pull/1)** remains a separate unmerged draft. At this inspection its head was `fb2a5c470b6781bc3817ea9d61be5b3c58b87f5a`. Its active development `src/server.mjs` does not mount the dormant Workspace SSO/PKCE adapter, and Workspace `dataduck` remains a proposed seventh app only with no purchased LIVE seat or active native broker grant.
- Other original apps have ongoing native security/feature drafts. These remain owned by their respective app developers; no cross-repo merges are included here.

## Pre-activation gates

Require exact six-native repository SHA and full dependency/source review; approved private operator read access; operator-run genuine Ed25519 signer/lookup/mTLS source interoperability; independently authenticated native app service authorization and live paid-seat revocation on each real protected endpoint; authorized DataDuck native integration and a reviewed eight-origin source lock; complete real private HTTPS staging with separate organization/tenant data and rollback test. Use the canonical [activation runbook #190](https://github.com/dennisbsj/DuckBio-site/pull/190) and preserve every original PR as draft until security QA signs off.

No code, keys, services or native repos were changed by this inventory.
