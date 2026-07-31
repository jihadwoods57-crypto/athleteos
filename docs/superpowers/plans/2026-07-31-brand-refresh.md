# OnStandard Brand Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One mark (Performance Dial, F2 lit + flat finishes), one two-tone wordmark, one color law, one asset pipeline — applied to every OnStandard surface with zero survivors from the four legacy logo variants.

**Architecture:** Hand-built SVG masters in `assets/brand/` are the single source of truth; `scripts/gen-brand-assets.mjs` renders every raster from them via the ms-playwright headless chrome shell (`chrome-headless-shell.exe --screenshot`). Websites/emails embed one canonical lockup snippet; the proto embeds one `logoMark()`; everything else is generated.

**Tech Stack:** Plain SVG/HTML/CSS, Node ESM scripts, chrome-headless-shell for rendering, ffmpeg for webp/regrade, gpt-image-2 (existing pipeline) for landing photo regen.

## Global Constraints

- Sweep gradient (law): `#34D399 → #22D3EE → #3B82F6` (`#60A5FA` allowed as on-dark tip).
- Athlete Blue: `#2563EB` (light primary) / `#3B82F6` (dark). Canvas: `#070B14`.
- Banned hexes after rollout: `#E8B44A` `#F5C866` `#C4922E` (gold), `#3d7dff` `#2fd4c8` (t.html), `#33c6d6` (admin).
- Wordmark: `On` ink (`#EEF3FB` dark / `#0F172A` light) + `Standard` sweep-filled; Plus Jakarta Sans 800; letter-spacing -0.04em. No ONSTANDARD all-caps lockups (score-tier copy "OnStandard" as a tier name is NOT a lockup and stays).
- Dial geometry (never redrawn): track `M33 81.4 A34 34 0 1 1 67 81.4`, progress `M33 81.4 A34 34 0 0 1 50 18`, stroke 12 round caps, marker (50,18) r10.5+r6, viewBox `0 0 100 100`.
- Git: explicit `git add <paths>` only (concurrent committer on shared tree); re-check `git branch --show-current` = master before every commit; NEVER touch the pre-existing dirty files (proto css, proto.zip churn) except where a task explicitly edits them.
- Emails must reference the mark as hosted PNG `https://onstandard.app/assets/brand/email-mark.png` (Gmail strips inline SVG).

---

### Task 1: Master brand SVGs

**Files:**
- Create: `assets/brand/dial-flat-dark.svg`, `assets/brand/dial-flat-light.svg`, `assets/brand/dial-lit.svg`, `assets/brand/icon-tile.svg`
- Delete: `assets/brand/onstandard-mark.svg`, `assets/brand/onstandard-icon.svg` (superseded blue-only gradient)

**Interfaces:** Produces the four master files consumed by Task 2's generator and referenced by LOGO.md (Task 10).

- [ ] Write `dial-flat-dark.svg` — exact current logoMark geometry, sweep gradient, on-dark track/marker.
- [ ] Write `dial-flat-light.svg` — same geometry; track `#DCE7FB`, marker bezel `#FFFFFF` with `stroke="#DBEAFE"`, core `#2563EB`.
- [ ] Write `dial-lit.svg` — F2 finish, hand-built: padded viewBox `-25 -25 150 150`; layered progress path (wide bloom blur≈10 opacity≈.32, tight glow blur≈4.5 opacity≈.6, crisp stroke, glass sheen overlay stroke white .16 width 4.5 blur .7), glass track `#161F30` + top highlight `rgba(255,255,255,.06)`, marker = halo (blurred white, opacity .5) + bezel `#0F172A` + radial enamel core (`#FFFFFF→#D8E4F5`) + specular dot.
- [ ] Write `icon-tile.svg` — 1024 tile, bg `#070B14` with faint radial `#0F1B33` wash top-center, lit dial centered at 61% scale.
- [ ] Render each to PNG via chrome-headless-shell harness page; visually compare dial-lit against the approved F2 reference (`scratchpad/fusion/f2-balanced.png`); iterate filters until it matches the F2 character (tight glow, enamel marker, no mud).
- [ ] Commit: `git add assets/brand && git commit -m "feat(brand): master dial SVGs — flat dark/light + hand-built F2 lit finish + icon tile"`

### Task 2: Asset generator + all rasters

**Files:**
- Create: `scripts/gen-brand-assets.mjs`, `web/landing/assets/brand/` (dir)
- Modify: `app.json` (android adaptiveIcon backgroundColor `#2563EB` → `#070B14`)
- Regenerate: `assets/icon.png`, `assets/splash-icon.png`, `assets/android-icon-{background,foreground,monochrome}.png`, `assets/favicon.png`, `web/landing/assets/favicon.png`, `web/landing/assets/apple-touch-icon.png`, `web/landing/assets/og.png`, `web/landing/assets/brand/email-mark.png`

**Interfaces:** Consumes Task 1 masters. Produces `email-mark.png` URL used by Tasks 7–8; og.png/favicons used by Task 5. Generator contract: `node scripts/gen-brand-assets.mjs` regenerates everything idempotently; builds temp HTML per asset (fonts from `web/landing/assets/fonts` if needed for og), screenshots at exact pixel sizes via `chrome-headless-shell.exe --headless --screenshot --window-size=WxH --force-device-scale-factor=1`.

- [ ] Write generator: asset table (source svg, size, bg, out path); og.png composes lit dial + two-tone wordmark + "Prove the work." on `#070B14`; android-foreground = flat dial with adaptive safe-zone margins; monochrome = white flat dial; favicon renders from `dial-flat-dark.svg` at 64.
- [ ] Run it; Read every output PNG to eyeball; check favicon legibility at 16px (downscale check).
- [ ] Update `app.json` adaptiveIcon backgroundColor.
- [ ] Commit: `git add scripts/gen-brand-assets.mjs assets/*.png web/landing/assets/favicon.png web/landing/assets/apple-touch-icon.png web/landing/assets/og.png web/landing/assets/brand app.json && git commit -m "feat(brand): one-command asset pipeline + regenerated icons/splash/og from masters"`

### Task 3: Proto app mark + share card

**Files:**
- Modify: `proto/redesign-2026-07/js/components.js:229-247` (logoMark), `proto/redesign-2026-07/js/share-card.js:173-177`
- Delete: `src/brand/Logo.tsx`

**Interfaces:** `logoMark(size, uid)` signature unchanged (5 call sites keep working). Share card keeps `shareScoreCard` API; only the footer lockup drawing changes.

- [ ] Rewrite `logoMark()` theme-adaptive: read `document.documentElement.getAttribute('data-theme')`; dark → track `rgba(255,255,255,0.16)` bezel `#0F172A` core `#FFFFFF`; light → track `#DCE7FB` bezel `#FFFFFF`+`stroke #DBEAFE` core `#2563EB`. Same geometry verbatim.
- [ ] share-card.js: replace canvas `ONSTANDARD` all-caps fill with the lockup: draw flat dial (Path2D from the three geometry elements, gradient stroke) at ~56px beside two-tone wordmark — `On` in `#EEF3FB` + `Standard` in sweep gradient, `'800 40px "Plus Jakarta Sans", Archivo'`, letter-spacing manual −0.04em via canvas `letterSpacing` if available.
- [ ] Delete `src/brand/Logo.tsx`; grep `src/` for importers (expect zero).
- [ ] Headless-render welcome/signin/roles dark AND light; render a share card via the harness; eyeball all.
- [ ] Commit: `git add proto/redesign-2026-07/js/components.js proto/redesign-2026-07/js/share-card.js && git rm src/brand/Logo.tsx && git commit -m "feat(brand): theme-adaptive logoMark + share-card lockup; delete dead divergent Logo.tsx"`

### Task 4: Landing re-skin — palette + lockups (7 pages)

**Files:**
- Modify: `web/landing/css/site.css` (v4 header + token block), `web/landing/index.html`, `{athletes,coaches,trainers,dietitians,parents}.html`, `privacy.html`, `terms.html`, `reset.html`, `web/landing/js/site.js` (only if tier colors reference gold)

**Interfaces:** Produces the canonical HTML lockup snippet reused by Tasks 5–8: 28px flat dial SVG (self-contained gradient defs, unique id per instance) + `<span class="brand-name">On<b>Standard</b></span>` where `.brand-name{color:#EEF3FB;font-weight:800;letter-spacing:-0.04em}` and `.brand-name b{background:linear-gradient(90deg,#34D399,#22D3EE,#3B82F6);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800}`.

- [ ] site.css: retire gold tokens — `--gold*` → lit blue/teal system on `#070B14` (accent `#3B82F6`, bright `#60A5FA`, cyan `#22D3EE`, ring vars already correct); sweep every gold usage (buttons, rules, tier chips, hovers); update the v3 header comment to v4 "One brand — the lit dial world".
- [ ] index.html: nav + footer lockups → canonical snippet (footer gets its OWN gradient defs — kills the cross-reference bug); dial-tier band colors re-checked; og:image cache-bust query if needed.
- [ ] 5 role pages: same two lockup swaps each.
- [ ] privacy/terms: `.brand` block → canonical two-tone (already two-tone; align hexes/weights).
- [ ] reset.html: green checkmark chip → 60px flat dial; copy unchanged.
- [ ] Grep gate: zero `#E8B44A|#F5C866|#C4922E` in `web/landing/` (excluding src-png sources); zero `brand-name">ONSTANDARD`.
- [ ] Screenshot all 7 pages at 390 and 1280 wide; eyeball.
- [ ] Commit landing files explicitly.

### Task 5: Landing imagery — photos cool-regrade/regen + hero video regrade

**Files:**
- Create: `web/landing-src/cool-regrade.mjs` (ffmpeg color-grade pass) and/or rerun `role-heroes-gen.mjs`/`hf-gen.mjs` with cool-light STYLE
- Modify: `web/landing/assets/img/g-*.webp`, `web/landing/assets/video/hero-loop.mp4`

**Interfaces:** Consumes existing pipelines. Photo prompts change only lighting language: warm tungsten/gold → "cool moonlight-teal rim light, deep blue-black shadows".

- [ ] First attempt cheap path: ffmpeg regrade existing webp/video (curves: pull oranges toward teal, `colorbalance`/`selectivecolor`), render side-by-sides, judge honestly.
- [ ] If regrade looks fake: regen photos via gpt-image-2 pipeline with cool STYLE (same compositions/filenames); video stays regraded (Kling regen needs founder spend approval — flag in final report).
- [ ] Commit imagery.

### Task 6: Trainer page + Admin Command Center

**Files:**
- Modify: `web/landing/t.html` (tokens lines ~13-16, `.mark` line ~41, powered-by lockups lines ~126/199), `web/admin/index.html` (tokens line 19, `.mark` line 61, 6 lockup renders), `web/admin/flags.html`, `web/admin/reset.html`

- [ ] t.html: `--blue:#3d7dff→#3B82F6`, `--teal:#2fd4c8→#22D3EE`; `.mark` gradient square → 20px flat dial SVG; "COACHING · POWERED BY ONSTANDARD" → canonical-cased "Coaching · Powered by On**Standard**" lockup styling.
- [ ] admin 3 pages: `--teal:#33c6d6→#22D3EE`; `.mark` square → 26px flat dial; keep `Command Center` sub-line.
- [ ] Grep gate: zero banned hexes in `web/`.
- [ ] Screenshot each; commit.

### Task 7: Auth email templates (13)

**Files:**
- Modify: `scripts/gen-auth-email-templates.mjs` (lockup block lines ~63-74)
- Regenerate: `supabase/email-templates/*.html` (13 files)

- [ ] Generator: checkmark rounded-square → `<img src="https://onstandard.app/assets/brand/email-mark.png" width="30" height="30" alt="" style="border-radius:9px">`; keep sweep top bar; two-tone wordmark spans use `#0F172A`/`#2563EB` on light email bg (email = on-light context; "Standard" solid Athlete Blue — gradient text is unreliable in email clients; LOGO.md will bless this as the email fallback).
- [ ] Regenerate all 13; open one rendered preview to eyeball; commit generator + templates.

### Task 8: Edge-function surfaces (2 unbranded emails + 2 pages)

**Files:**
- Modify: `supabase/functions/guardian-request/index.ts` (email HTML ~lines 89-97), `supabase/functions/claim-reminders/index.ts` (~62-73), `supabase/functions/guardian-verify/index.ts` (~52-55), `supabase/functions/billing-return/index.ts` (~123-138)

- [ ] Both emails get the Task 7 header block (hosted PNG + two-tone spans + sweep bar).
- [ ] guardian-verify page: text-only wordmark → flat dial SVG (inline is fine — it's a web page) + two-tone wordmark; billing-return: add lockup above CTA, canonical colors.
- [ ] Deploy the four functions (`supabase functions deploy <name>` each — established practice); verify guardian-verify page over HTTPS.
- [ ] Commit.

### Task 9: Marketing cards + lockscreen shot

**Files:**
- Modify: `web/marketing-src/cards.html` (12 lockups, lines ~397-872), `web/landing-src/lockscreen.html` (appicon lines ~62-124)
- Regenerate: `web/marketing/*.png` (12), `web/landing/assets/product/vc-1-lockscreen.webp`

- [ ] cards.html: single-tone `OnStandard` → two-tone snippet; dial instances get self-contained defs.
- [ ] lockscreen.html: fake gold-tinted appicon → miniature of the real new icon-tile (lit dial on `#070B14`).
- [ ] Re-render via existing Playwright element-screenshot pipeline (headless-shell fallback if MCP locked); eyeball; commit.

### Task 10: Docs + law

**Files:**
- Rewrite: `docs/brand/LOGO.md`
- Modify: `DESIGN.md` (mark claim + any stale color notes)

- [ ] LOGO.md v2: geometry (verbatim paths), the two finishes + when each is used, F2 lit layer recipe, two-tone wordmark spec incl. email fallback (solid `#2563EB`), lockup ratios, canonical tokens, banned-hex list, full asset map (master → generated → surface), regeneration command, "no hand-copied SVG — masters only" rule; remove the `src/brand/Logo.tsx` reference.
- [ ] Commit docs.

### Task 11: Ship + verification sweep

- [ ] Rebuild proto zip: `node scripts/build-proto-zip.mjs`; commit `assets/proto.zip` + `src/proto/protoVersion.ts` (ONLY if tree state around them is mine to commit — coordinate with concurrent churn: re-check `git status` and take only brand-change hunks).
- [ ] Deploy landing via wrangler (established: `web/landing-src/deploy` + `CLOUDFLARE_API_TOKEN`); verify live: favicon, og:image, one role page, email-mark.png URL 200.
- [ ] OTA: `eas update` per runbook (compare bundle stamps first — memory: OTA ships proto.zip, not loose files; verify protoVersion hash changed).
- [ ] Full greps: banned hexes repo-wide (excluding docs history/src-png), `ONSTANDARD` lockups, `strokeDasharray="118 39"` (dead check-ring), checkmark-square path `M20 6 9 17l-5-5` outside reset-history.
- [ ] Final report: what shipped, what's flagged (TestFlight build for new icon; Kling video regen spend; config.toml email wiring).

## Self-Review

Spec coverage: Tasks 1–11 map to spec sections "Master assets"→1, "Generated rasters"→2, rollout items 1–2→3, 3→4/5, 4–5→6, 6→7, 7–8→8, 9–10→9, 11→10, verification/ship→11. Non-goals honored (no config.toml change, no TestFlight submit). Type consistency: `logoMark(size, uid)` unchanged; lockup snippet defined once (Task 4) and reused by exact description in 6–8. No placeholders remain.
