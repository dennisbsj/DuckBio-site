# DuckBio — scientific software suite

DuckBio develops six scientific applications and a public marketing preview.

## Where the website actually lives

The GitHub Pages website is hosted at:

**https://dennisbsj.github.io/DuckBio-site/**

The publishing source is **`development` → `/docs`**, using the existing GitHub Pages **Deploy from a branch** setup. The actual Pricing page is `development/docs/pricing.html`; the actual homepage is `development/docs/index.html`.

**Do not update root-level HTML files on `main` to change the published website.** Updates to `main` do not publish the development-site pages. The earlier root-level test pages and custom GitHub Actions deployment workflow have been removed.

The published site is a static marketing preview: pricing is tentative, Stripe checkout is not live and authenticated customer portal features must not be described as launched.

The existing `development/docs/.nojekyll` file skips Jekyll site building. GitHub Pages manages deployment of that source branch; no custom publishing workflow is needed.

## Canonical app suite files — preserve compatibility

- `suite-permissions.json`: shared roles and permission policy.
- `suite-ui.js`: shared login/header/theme helper.
- `scripts/sync-suite-permissions.py`: verifies/updates six app-local copies.
- `scripts/sync-suite-ui.py`: verifies/updates six app-local copies.
- `assets/app-icons/`: existing application icon assets.

All six apps retain their own release copies and must not load runtime code from the marketing site.

Some existing internal names (`Celluloid Science Apps`, the `cc-suite-theme` key and related globals/event names) are compatibility contracts, not the public brand. Preserve them until their replacement has been tested across the six app repositories.

When all seven repositories are checked out as siblings, verify synchronisation with:

```sh
python scripts/sync-suite-permissions.py --check
python scripts/sync-suite-ui.py --check
```

Only use `--write` after deliberately changing an approved shared contract and verifying the app impact.

## Release boundaries

Publishing `development/docs` does not deploy any application, change licenses, alter databases, set up Stripe payments, change domains or migrate hosting. Review and test these separately.

The GitHub Pages site is public even if the repository is private. Keep credentials, private configuration, databases and application runtime data out of the published `docs` folder.

## Website direction

Keep a software-only, light navy/blue/aqua/coral visual style. No photos of people. Use real product icons and verified product visuals. Maintain links for Home, Applications, Pricing, How it works, About and Support. Treat a shared customer login, billing, inbox or compliance certification as planned until implemented and verified.

Tagline: **Serious science. Smarter software.**
