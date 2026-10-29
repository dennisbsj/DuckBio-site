# DuckBio website — implementation status and next phases

## Scope and permissions

This site was authored **from scratch** in `docs/` on `development`. The first website version reused the six icon files already in `DuckBio-site`; in October 2026, five new standalone SVG website icons were added for the public product rebrand. It does **not** pull new website materials from the former site, modify any app repository, change deployed apps, change DNS, or charge customers.

The historical source repository and the shared `suite-ui.js` / `suite-permissions.json` contracts at repository root remain untouched. These compatibility contracts are intentionally separate from public DuckBio branding.

## Phase 1 — implemented on development

- Twenty static HTML pages: home, applications, six individual products, pricing, seven-day trial concept, My Apps concept, about, support, and five legal/information drafts.
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

The public DuckBio storefront now uses **LabDuck**, **CytoDuck**, **DuckPipe**, **DuckNote**, **DuckMan**, and **DuckTrain**.

The underlying repository names and static legacy slugs for the five renamed products are unchanged until a separately approved repository/deployment migration. `GoFlo` is the existing repository spelling; it was not named `GoFlow`. The pricing configuration and image file paths retain stable internal identifiers until integration is designed and tested. The LIMSDuck website icon has been restored to the exact original LIMSMan artwork (retitled only). Four custom SVG website illustrations now represent DuckNote, DuckTrain, MethDuck and DuckFlow in a shared navy/white/teal scientific duck style. Prior website icon files remain available as fallback/archive. The DuckMan icon and corporate DuckBio logo are unchanged, and no live app logo or code was changed.

## Approved website icon artwork (2026-10-29)

The six user-approved icon illustrations were extracted from the supplied six-panel image **without the wordmarks beneath them** and published as a compact 3×2 WebP sprite at `docs/assets/icons/duckbio-approved-sprite.webp`. The HTML image elements use the local transparent SVG `transparent.svg` with six CSS background-position classes to select the corresponding tile. The public product titles remain ordinary text outside the images. All 20 pages use a versioned stylesheet reference to avoid stale browser cache.

The original icon artwork and the previous website-only SVG experiments remain in the repository for reversibility. **No application repositories, live app branding, permissions, production data, main branch or authentication/payment integration were changed.** The image was optimised for small product icons; a higher-resolution master remains available in the user's supplied artwork, not in the website repository.

## DuckFlow → CytoDuck and corporate brand mark (2026-10-29)

The customer-visible cytometry product is now **CytoDuck** across the public website. Its new public URL is `docs/cytoduck.html`. `docs/goflo.html` remains as a redirect for existing links. The underlying `dennisbsj/GoFlo` repository, server, route integration identifiers, and `goflo` key in `docs/assets/pricing.json` are deliberately unchanged. The existing user-approved flow-cytometry artwork is retained and now labelled CytoDuck.

The DuckBio **company** brand icon is a minimal, smooth abstract duck silhouette distinct from the detailed illustrated app mascots; it has no glasses, shirt, laboratory implements or app-style square background. Website-wide headers use `docs/assets/duckbio-mark.svg`, dark footers use `docs/assets/duckbio-mark-light.svg`, and browsers use the main silhouette as the favicon. The existing DuckBio wordmark remains separate text. No application assets or repositories were modified.

## LabDuck public rename (2026-10-29)

The customer-visible laboratory management product is now **LabDuck**, replacing the former display name **LIMSDuck**. Public website references now use `LabDuck` and the canonical public product page is `docs/labduck.html`. The previous `docs/limsman.html` URL redirects to `labduck.html` for backward compatibility. Internal pricing key `limsman`, the website's preserved sprite class `logo-limsduck`, other technical product identifiers, and the original GitHub app repository remain unchanged, avoiding breaking integrations. The icon artwork (which contains no wordmark) is intentionally unchanged. This was a website-only change: no app code, app repository names, or production environment were modified.

The earlier typographical error `Eeletronic lab notebook` was corrected to `Electronic lab notebook` in public-facing website copy.

A new set of 50 exploratory DuckBio brand concepts was created for user review, reflecting LIMS, ELN, document management, cytometry, validation, and training. These concepts are NOT yet installed as the DuckBio corporate logo; final selection and trademark similarity review remain pending.

## Approved DB duck corporate logo and favicon (2026-10-29)

The user-approved compact **DB monogram with a white duck and cyan duckbill** replaces the earlier abstract-duck mark in the marketing site's header, footer and standalone launcher. The approved symbol is cropped from the selected image, optimised as a 256×256 PNG at `docs/assets/duckbio-brand-approved.png`, and also used as the PNG favicon on all website pages (including redirects). The adjacent DuckBio wordmark remains readable text that adapts to the site's light and dark themes. A rounded white backing maintains the correct appearance against the dark footer and navigation.

The superseded `duckbio-mark.svg` and `duckbio-mark-light.svg` remain in the repository for rollback but no longer appear in public page markup. The original full-size user-approved design remains in the conversation source artwork; the smaller image is the website delivery asset. All standard pages reference a refreshed stylesheet version for browser cache invalidation. **No app source code, app branding, repository names, production deployments, authentication or payments have been modified.**

## Canonical application display order (2026-10-29)

Use this single customer-facing order **everywhere** in the DuckBio marketing website and its interactive preview:

1. **Top row:** LabDuck → CytoDuck → DuckPipe
2. **Bottom row:** DuckNote → DuckMan → DuckTrain

The order applies to the homepage hero app preview and six product cards, the pricing-page app chooser (three columns on desktop), the All Apps interactive launcher (three columns on desktop), the Apps dropdown in every full website header, and the Products list in every full website footer. On narrower screens, preserve the same reading/tab order even when responsive CSS changes the number of columns. Keep icon sprite position mappings (LabDuck=s1, CytoDuck=s5, DuckPipe=s4, DuckNote=s2, DuckMan=s6, DuckTrain=s3), application links, prices, copy and existing code identifiers unchanged. The static marketing site alone was edited; no live app repository is touched.

## DuckPipe customer-facing rename (2026-10-29)

The method-validation app is now named **DuckPipe** (previously MethDuck) across the DuckBio marketing website. The canonical product page is `docs/duckpipe.html`, and the previous `docs/methpipe.html` URL remains as a fast redirect. All application navigation and footer lists, the homepage preview and cards, the pricing-page app chooser and FAQ, and the interactive launcher use DuckPipe. Its position in the canonical order is third: **LabDuck → CytoDuck → DuckPipe / DuckNote → DuckMan → DuckTrain**. The pipe-themed approved artwork and its existing technical CSS sprite class `logo-methduck` and launcher sprite slot `s4` remain unchanged, as does the `methpipe` pricing key. The actual app repository `dennisbsj/MethPipe` and application code have **not** been changed or renamed.
