# DuckBio — software for scientific workflows

DuckBio offers six focused scientific software applications: **GoFlo, EEL, MethPipe, ManTrain, LIMSMan and DuckMan**.

## GitHub Pages marketing website

**Website:** https://dennisbsj.github.io/DuckBio-site/

The public-facing static pages are `index.html` and `pricing.html` in the root of the `main` branch. The site uses relative links and the existing app icons in `assets/app-icons/` so links resolve under `/DuckBio-site/`.

### Publishing without a custom workflow

This site is designed for GitHub Pages **Deploy from a branch** rather than a custom GitHub Actions workflow. Keep the source set to the branch and folder containing the site; for the root-level HTML files, choose **main** and **/(root)** in **Settings → Pages → Build and deployment**.

An empty `.nojekyll` file in the root bypasses Jekyll processing. The custom publishing workflow added during the initial implementation was removed because it conflicted with the existing branch-based publishing setup and was unnecessary for a static HTML site.

**Important:** GitHub Pages can still use its own build/deployment workflow even when the source is a branch. Private repositories may consume GitHub Actions minutes. Check the Pages deployment status and account quota if publication is blocked; a new Git commit alone does not establish that the public site has updated.

**Publication security:** GitHub Pages makes the deployed site publicly accessible even when the repository is private. The root directory currently also contains shared application metadata/runtime files that are not intended as marketing assets. Before public commercial launch, isolate the public web files into a dedicated `/docs` publishing folder and change the Pages source folder to `/docs`, or use a separate public-only website repository. Do not upload credentials, databases or private application files.

The Pages website is a marketing preview, not an app deployment, Stripe checkout or a replacement for the six application hosting environments.

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
