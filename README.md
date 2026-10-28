# DuckBio — software for scientific workflows

This repository is the **new DuckBio website and shared application-suite source**. DuckBio is a software-only business offering six applications: **GoFlo, EEL, MethPipe, ManTrain, LIMSMan and DuckMan**.

## Status — migration in progress

**This repository is not yet a production website. Do not deploy it in place of the existing site or point live domains at it.**

The existing `dennisbsj/celluloid-consulting-site` repository remains the active website/deployment source until a separately verified cutover. Its historical content must not be deleted before backups and release verification.

The first migration step preserves the canonical authorization policy and shared app UI **byte-for-byte**. This keeps all six installed application copies compatible. Existing legacy names in these files (including `Celluloid Science Apps`, the `cc-suite-theme` local-storage key and their JS global/event names) are compatibility contracts, **not the new DuckBio marketing brand**. Do not rename these contracts during the repository migration. Rebranding them requires separate testing across all six apps.

## Canonical shared files

- `suite-permissions.json`: shared roles and permission policy.
- `suite-ui.js`: shared login/header/theme helper.
- `scripts/sync-suite-permissions.py`: verifies/updates six app-local copies.
- `scripts/sync-suite-ui.py`: verifies/updates six app-local copies.
- `assets/app-icons/`: selected pre-existing product icons.

The six apps each retain a local release copy of these shared files and **do not load their runtime code remotely from this website**.

When the site and all six repositories are checked out as sibling directories:

```sh
python scripts/sync-suite-permissions.py --check
python scripts/sync-suite-ui.py --check
```

Only after deliberately modifying an approved canonical file should the corresponding `--write` command be used; review diffs, run app tests and deploy each app separately.

## Website direction (not implemented yet)

- Software products and subscription licensing only; **no consulting services**.
- Keep the light navy/blue/aqua/coral look from preferred concept #1.
- No photography or illustrations of people.
- Home; All apps; six product details; Platform; Pricing; Solutions; About; Support/Contact.
- Public marketing site and authenticated customer platform are separate products.
- Avoid claiming unified login, billing, inbox, messaging, compliance certification or other features are live until implemented and verified.
- Use real product UI screenshots and product icons rather than fake application screenshots.
- Proposed tagline: **Serious science. Smarter software.**

## Safety gates before old repository can be retired

1. Preserve an independent archive/backup of the original website repository and public assets.
2. Move required website content/assets, rebuild and review the DuckBio site.
3. Verify shared policy and UI are still identical in all six apps.
4. Update remaining source links, sync instructions, deployment scripts and domain references in controlled PRs, not as a bulk blind replace.
5. Migrate hosting, DNS, HTTPS, licensing/contacts and any redirects; verify the production source and rollback.
6. Only then archive the old repository. Consider permanent deletion separately.

**No production deployment, DNS change, app migration or old-repository deletion is authorized by this README.**
