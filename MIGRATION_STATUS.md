# DuckBio migration checklist

Updated: 2026-10-28. This is a **staging milestone**, not proof of production migration.

## Verified completed

- [x] Created private `dennisbsj/DuckBio-site` repository.
- [x] Copied `suite-permissions.json` and `suite-ui.js` **byte-for-byte** from the previous website source.
- [x] Confirmed the SHA of both shared files matches each of the six app repositories (DuckMan, EEL, LIMSMan, MethPipe, GoFlo, ManTrain).
- [x] Copied and updated the two sibling-repository sync scripts; only their comments/docstrings were reworded.
- [x] Copied six existing product SVG icons from the old site.
- [x] Drafted six **documentation-only** pull requests (not merged). Each changes exactly `MANUAL_DEPLOY.md` and `SUITE_UI_STANDARD.md`.

## Draft app documentation pull requests

| App | Draft PR |
| --- | --- |
| DuckMan | https://github.com/dennisbsj/DuckMan/pull/15 |
| EEL | https://github.com/dennisbsj/EEL/pull/81 |
| LIMSMan | https://github.com/dennisbsj/LIMSMan/pull/22 |
| MethPipe | https://github.com/dennisbsj/MethPipe/pull/14 |
| GoFlo | https://github.com/dennisbsj/GoFlo/pull/190 |
| ManTrain | https://github.com/dennisbsj/ManTrain/pull/20 |

## Outstanding / do not skip

- [ ] Independent archive/export of entire previous website repository, including any binary screenshots and other static assets. **Product icons alone are not the full asset backup.**
- [ ] Design and implement the new software-only marketing website after design approval. Preserve preferred concept #1, no pictures of people and no consulting service descriptions.
- [ ] Inventory all old website contact, license/payment, redirect and deployment functions. Decide which must be replaced and verify that no consumer still depends on them.
- [ ] Verify sync scripts with all seven repositories checked out as sibling folders and `--check`; GitHub SHA equality was verified, but local script execution has **not** been performed as part of this migration.
- [ ] Review/merge documentation PRs only after tests and migration planning. Existing app-local shared files must not be modified merely for a rename.
- [ ] Preserve compatibility contracts: `Celluloid Science Apps` suite field, current policy version, `cc-suite-theme` key, `CelluloidSuiteUI` API and related event names until specifically migrated/tested.
- [ ] Decide and implement any future shared customer portal/identity system separately. Current apps are not guaranteed to provide one shared login.
- [ ] Verify planned hosting, DNS, HTTPS, Stripe/billing, licensing, data storage, app domains, backups and rollback procedures.
- [ ] Verify each live application and release against the actual deployed runtime. LIMSMan PHP-to-Node cutover requires its own independent preflight and validation.
- [ ] Archive old `dennisbsj/celluloid-consulting-site` only after it is no longer referenced by deployment scripts/active systems; **do not delete yet**.
- [ ] Delete the old repository only following a separate explicit approval and successful independent backup and production verification.

## Operational boundaries

No external deployment, app release, DNS change, running database migration or source repository deletion has been performed by this migration stage. Shared file imports are non-destructive.
