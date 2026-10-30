# DuckBio — scientific software suite

DuckBio develops six independent scientific applications and a public marketing
preview. Repository/product names have changed; legacy runtime identifiers remain
compatible. Documentation status: **30 October 2026**.

| App and current repository | Former name | Purpose |
|---|---|---|
| [DuckNote](https://github.com/dennisbsj/DuckNote) | EEL | Electronic laboratory notebook |
| [CytoDuck](https://github.com/dennisbsj/CytoDuck) | GoFlo | Flow cytometry analysis |
| [DuckTrain](https://github.com/dennisbsj/DuckTrain) | ManTrain | Training and competency |
| [DuckPipe](https://github.com/dennisbsj/DuckPipe) | MethPipe / Prove It | Methods and validation workspace |
| [LabDuck](https://github.com/dennisbsj/LabDuck) | LIMSMan | Laboratory information management |
| [DuckMan](https://github.com/dennisbsj/DuckMan) | DuckMan | Controlled documents and revisions |

## Website source and publishing status

The static marketing preview is at
[dennisbsj.github.io/DuckBio-site](https://dennisbsj.github.io/DuckBio-site/).
The documented publishing source is **`development` → `/docs`**, using GitHub
Pages **Deploy from a branch**. The source homepage is
[development/docs/index.html](https://github.com/dennisbsj/DuckBio-site/blob/development/docs/index.html)
and pricing is
[development/docs/pricing.html](https://github.com/dennisbsj/DuckBio-site/blob/development/docs/pricing.html).

This README is on `development`; the marketing files are in this checkout's
`docs/` folder. It aligns the previously stale development README with main's
verified publishing-source documentation without changing website content.

Root HTML on `main` is not the publishing source. The existing
`development/docs/.nojekyll` skips Jekyll; there is no need to restore an old
custom deployment workflow. This README-only PR neither pushes to a publishing
branch nor changes `docs/`, Pages configuration or the published website.

The preview is **static marketing**, not a completed SaaS platform. Pricing is
tentative; live Stripe checkout, unified customer login, billing, inbox and
messaging must not be described as launched. No domains, payments, licenses,
app databases or production runtime are changed by this documentation.
The former [celluloid-consulting-site](https://github.com/dennisbsj/celluloid-consulting-site)
is a historical source/QA archive, not the current app runtime source. Preserve
its snapshots/backups; do not execute its old hosting scripts or access cHosting.

## Application backend and review status

All six app backends use Node.js technology, with **separate app data**.
DuckNote uses PostgreSQL; CytoDuck, DuckTrain, DuckPipe, LabDuck and DuckMan use
private SQLite for their backend records. Scientific workspaces and some file
bytes can still be browser-persistent. LabDuck's PHP→Node source migration has
synthetic database/hash/session/backup/rollback evidence; retained PHP is only a
compatibility reference, not a required Node interpreter.

The reviewed API/migration/security/recovery changes remain in draft PRs and
app `qa/duckbio-validation-20261030` snapshots, not merged default branches or
confirmed production releases. Read the [dated QA report](https://github.com/dennisbsj/celluloid-consulting-site/blob/16b300b232acd0dac82681d24a6bd6c2e0370ef0/DUCKBIO_QA_20261030.md)
for exact commits, test scope and limitations. DuckTrain's explicit evidence
server copies do not recover files that were never copied; DuckPipe still has
prototype areas. No common identity/database, formal regulatory validation or
commercial release readiness is implied by sharing Node.js technology.

## Shared policy/UI and legacy checkout names

The canonical shared source is maintained in
[DuckBio-site](https://github.com/dennisbsj/DuckBio-site):
`suite-permissions.json`, `suite-ui.js` and the two `scripts/sync-suite-*.py` tools.
Each application vendors its own reviewed copy; no app loads its runtime code
from the marketing site. The older website's copies are historical and must not
silently overwrite newer app branding or reviewed fixes.

The sync tools still address legacy **local directory names** and internal
permission keys. For a deliberately prepared sibling-checkout layout:

| Current GitHub repository | Local directory expected by existing sync tools |
|---|---|
| `dennisbsj/DuckNote` | `EEL` |
| `dennisbsj/CytoDuck` | `GoFlo` |
| `dennisbsj/DuckTrain` | `ManTrain` |
| `dennisbsj/DuckPipe` | `MethPipe` |
| `dennisbsj/LabDuck` | `LIMSMan` |
| `dennisbsj/DuckMan` | `DuckMan` |

For example, clone `dennisbsj/DuckNote` into a directory named `EEL` when using
these unmodified sync tools. This is a local path alias, not a repository rename.
From the DuckBio-site checkout, with the six sibling directories prepared:

```sh
python scripts/sync-suite-permissions.py --check
python scripts/sync-suite-ui.py --check
```

Checks report drift or missing sibling paths. Review differences before any
intentional `--write`; never use it merely to silence drift, because app-local
DuckBio changes may be newer than a shared baseline. This README change does not
run the sync tools, change shared policy/UI, or alter installed app permissions.

Legacy `Celluloid Science Apps`, `CelluloidSuiteUI`, `cc-suite-theme`, policy app
keys, environment variables, stored IDs, filenames and backup formats remain
compatibility contracts. Public product names are the DuckBio names above.

## Design and release boundaries

Keep the software-only light navy/blue/aqua/coral design, existing product icons,
reviewed logo/favicon variants and verified product visuals. Preserve Home,
Applications, Pricing, How it works, About and Support navigation. No people
photography. Tagline: **Serious science. Smarter software.**

GitHub Pages is public even when source is private: never place credentials,
private configuration, app runtime files, customer data or backups in `docs/`.
Publishing marketing content does not deploy any app. App release/cutover,
secret custody, retention/restore and hosting decisions remain separate.
