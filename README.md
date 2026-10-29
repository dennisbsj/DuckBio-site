# DuckBio — software for scientific workflows

DuckBio offers six focused scientific software applications: **GoFlo, EEL, MethPipe, ManTrain, LIMSMan and DuckMan**.

## GitHub Pages marketing website

The public **website preview** is hosted at:

**https://dennisbsj.github.io/DuckBio-site/**

This repository contains the GitHub Pages website source and shared application-suite assets:

- `index.html`: public homepage, navigation and app overview.
- `pricing.html`: proposed 2027 pricing, discounts, launch promotion and interactive estimate calculator.
- `assets/app-icons/`: existing app icons used on the public pages.
- `.github/workflows/pages.yml`: GitHub Pages publication workflow.

The website uses relative links (`pricing.html`, `index.html` and `assets/...`) so it works under the GitHub Pages project path `/DuckBio-site/`.

### Publishing

The GitHub Actions workflow publishes updates from `main` and also supports manual runs (`workflow_dispatch`). It uploads **only** the public HTML pages and SVG application icons. It does **not** upload the shared permission policy, suite UI runtime, sync scripts, databases or application source code.

If the site does not update after a merge, check **Actions → Publish DuckBio site on GitHub Pages** and **Settings → Pages**. The Pages build source must be set to **GitHub Actions** for the workflow to publish.

A successful GitHub commit alone is not proof that the public site has updated; confirm the deployment run and the actual served pages. The GitHub Pages site is a marketing preview, not an app deployment, Stripe checkout or a replacement for the six application hosting environments.

### Commercial status

Prices are the **tentative 2027 subscription proposal**:

- DKK 200 per user per app per month, excluding VAT.
- Multi-app discounts rising to 25% for all six apps (DKK 900/user/month).
- Organisation discounts for 5–19 and 20–49 users; 50+ by quote.
- Early-adopter campaign for subscriptions started from 1 January through 31 March 2027, with 20% off for the first 12 months.

No live purchasing or account provisioning is claimed on the GitHub Pages preview.

## Canonical shared files — preserve compatibility

- `suite-permissions.json`: shared roles and permission policy.
- `suite-ui.js`: shared login/header/theme helper.
- `scripts/sync-suite-permissions.py` and `scripts/sync-suite-ui.py`: verification/synchronisation scripts.

The six apps retain independent local release copies of these shared files. Existing names and storage/event keys inside them are compatibility contracts and **must not be renamed merely for website rebranding**.

When this repository and all six app repositories are checked out as siblings:

```sh
python scripts/sync-suite-permissions.py --check
python scripts/sync-suite-ui.py --check
```

Only use `--write` after intentionally changing an approved canonical file and checking application compatibility. GitHub Pages publication does not synchronize or deploy apps.

## Design principles

- Software products and subscription licensing, not consulting services.
- Light navy, blue, aqua and coral; no photography of people.
- Use real product icons and verified screenshots, not fake product UI.
- Public marketing pages and the future authenticated customer platform are separate products.
- Never advertise unified login, billing, messaging or certification as live until verified.
- Tagline: **Serious science. Smarter software.**

## Further work

Complete the remaining app detail, platform, solutions, about and support pages; validate the release and payment flows separately; and retain tested rollback arrangements for any future domain, hosting or application migrations.
