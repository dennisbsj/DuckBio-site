# DuckBio website — implementation status and next phases

## Scope and permissions

This site was authored **from scratch** in `docs/` on `development`. The first website version reused the six icon files already in `DuckBio-site`; in October 2026, five new standalone SVG website icons were added for the public product rebrand. It does **not** pull new website materials from the former site, modify any app repository, change deployed apps, change DNS, or charge customers.

The historical source repository and the shared `suite-ui.js` / `suite-permissions.json` contracts at repository root remain untouched. These compatibility contracts are intentionally separate from public DuckBio branding.

## Phase 1 — implemented on development

- Eighteen static HTML pages: home, applications, six individual products, pricing, seven-day trial concept, My Apps concept, about, support, and five legal/information drafts.
- Semantic navigation, CSS-responsive layouts, keyboard-visible focus indicators, mobile menu, product/category filtering, authentic product icons, unique page descriptions and the requested navy/teal/coral palette.
- Real app features grounded in repository READMEs. Missing screenshots and demo videos explicitly display placeholders, not fabricated UIs.
- Central, non-live `docs/assets/pricing.json`. All amounts/Stripe IDs are intentionally `null` until prices are approved. The browser presentation reads this config to render verified future prices.
- Trial, My Apps, and legal pages plainly indicate they are **not operational**. No false sign-in, trial-start, payment or contact forms.
- Prelaunch `noindex,nofollow` meta tags and `robots.txt` disallow all. **Before launch**, prepare canonical URLs, sitemap, structured data and approved legal/company information.
- No package dependencies and no custom GitHub Actions workflows. GitHub Pages can publish `development:/docs` when explicitly enabled by the owner. Publishing a private repository may require a GitHub paid plan and the published site is public.

## Phase 2 — central account system (NOT implemented)

**Do not implement login solely in a GitHub Pages static site.** Select a maintained identity provider after reviewing EEL's organisation membership model and the other five apps' separate Node/Passenger sessions.

Requirements before integration:
- Stable provider subject ID as account identity; verified email plus Google OAuth, secure identity linking and account recovery.
- Server-side central `account_id`, `trial_started_at`, `trial_expires_at`, `trial_used`; immutable server time and seven-day duration.
- Trial usable once per central account and available across six apps. Distinct identity providers should link only after secure ownership proof.
- An authenticated application launcher showing **server-derived** access decisions.
- Existing app accounts/roles/audit histories/data must be retained with explicit account linking and reversible cutover.

## Phase 3 — Stripe Billing (NOT implemented)

A private backend (not GitHub Pages) will:
1. Create Checkout sessions with approved per-app Stripe Price IDs.
2. Verify webhook signatures against raw requests and transactionally deduplicate event IDs.
3. Reconcile customer/subscription and `current_period_end` state; allow out-of-order events safely.
4. Compute server-authoritative entitlements; redirects do not grant access.
5. Launch Stripe Customer Portal for self-service billing, receipts and cancellation.
6. Preserve Early Adopter pricing for 12 months after a later regular-price increase as an explicit, time-bounded billing rule; notify customers per approved terms.
7. Test trial expiry, payment failures, cancellation paid-through periods and non-destructive data retention.

Stripe **test mode only** until separate production approval. No secrets or private customer information belong in this repository or in public browser bundles.

## Phase 4 — application entitlement integration (requires explicit approval)

The user has required **permission before any changes to any of the six app repositories**. Consequently, the website alone cannot lock/unlock existing app endpoints. Proposed contract for each app (after approval) includes verified central identity, server-side entitlement checks on protected routes, account mapping, and no loss of local role-based policy or existing users. Do not treat disabled website buttons as access protection.

## Phase 5 — publication (requires explicit approval)

- Approve actual subscription prices, company details, support channel, privacy/legal text and screenshots/videos.
- Verify provider choice, backend, Stripe test mode, backup/restore, email delivery, monitoring and user flows.
- Test desktop/mobile, keyboard/accessibility, cross-browser and slow-network behaviour.
- Decide Pages branch and folder; check GitHub plan eligibility. The static site may be hosted by Pages but secure account/commerce APIs need another host.
- Confirm no unwanted GitHub workflows; GitHub Pages may internally run its publishing workflow even with branch-based publishing.
- Run `python scripts/validate-site.py` locally from the repository root. It is an offline test without external packages.
- Migrate hosting/redirects only following a separate cutover approval and verified rollback plan.

## Test status

Static source checks can verify local links, internal anchors, unique page metadata, image alt attributes, no visible legacy branding, and disabled subscriptions. Browser/rendering and real account/commerce integration tests are **not yet complete**; they depend on deployment/approved infrastructure.

## Product display names — October 2026

The public DuckBio storefront now uses **LIMSDuck**, **DuckNote**, **DuckTrain**, **MethDuck**, **DuckFlow**, and **DuckMan**.

The underlying repository names and static legacy slugs for the five renamed products are unchanged until a separately approved repository/deployment migration. `GoFlo` is the existing repository spelling; it was not named `GoFlow`. The pricing configuration and image file paths retain stable internal identifiers until integration is designed and tested. The LIMSDuck website icon has been restored to the exact original LIMSMan artwork (retitled only). Four custom SVG website illustrations now represent DuckNote, DuckTrain, MethDuck and DuckFlow in a shared navy/white/teal scientific duck style. Prior website icon files remain available as fallback/archive. The DuckMan icon and corporate DuckBio logo are unchanged, and no live app logo or code was changed.
