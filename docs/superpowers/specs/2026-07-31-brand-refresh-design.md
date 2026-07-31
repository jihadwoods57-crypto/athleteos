# OnStandard Brand Refresh — Design Spec (2026-07-31)

Founder-approved 2026-07-31 after three visual rounds (artifact: "OnStandard — the lit dial, final finish").
Decision trail: full redesign explored and rejected → refine the existing Performance Dial →
R2 (lit) + R6 (dimensional) fusion → **F2 "Balanced" intensity locked** → two-tone wordmark locked →
landing palette unification locked.

## The problem

The audit of 2026-07-31 found four different logos shipping simultaneously (Performance Dial,
email checkmark-square, admin/trainer gradient squares, a dead divergent `src/brand/Logo.tsx`),
four wordmark treatments, five partly-conflicting color token sets, and the dial hand-copied as
inline SVG in 8+ files. `assets/brand/onstandard-mark.svg` still carries the superseded blue-only
gradient. The landing site runs an intentionally divergent black+gold palette.

## Decisions (law)

1. **One mark.** The Performance Dial, exact existing geometry (viewBox 0 0 100 100):
   - Track: `M33 81.4 A34 34 0 1 1 67 81.4`, stroke 12, round caps
   - Progress: `M33 81.4 A34 34 0 0 1 50 18`, stroke 12, round caps
   - Marker: circle (50,18) r=10.5 bezel + r=6 core
2. **Two finishes, one geometry.**
   - **Lit** (F2 Balanced): glow + glassy depth, hand-built in SVG (gradients + blur filters,
     no AI raster). Used ≥120px: app icon, splash, landing hero, OG image, share card.
   - **Flat**: clean vector. Used <120px and in constrained contexts: favicons, nav marks,
     in-app logoMark, emails (as hosted PNG). Must be theme-adaptive (on-dark AND on-light
     variants — fixes the hardcoded on-dark logoMark breaking light theme).
3. **One wordmark.** Two-tone: "On" in ink (`#EEF3FB` on dark / `#0F172A` on light) +
   "Standard" filled with the signature sweep gradient. Plus Jakarta Sans 800,
   letter-spacing -0.04em. Lockup ratios per LOGO.md: gap ≈ 0.32× mark height,
   mark ≈ 1.6× cap height. Retired: ONSTANDARD all-caps, single-tone mixed case,
   the email checkmark-square, plain gradient squares.
4. **One color law.** Sweep `#34D399 → #22D3EE → #3B82F6` (on-dark tip may use `#60A5FA`);
   Athlete Blue `#2563EB` (light primary) / `#3B82F6` (dark); canvas `#070B14`.
   Kill: t.html `#3d7dff/#2fd4c8`, admin `#33c6d6`.
5. **One source of truth.** Masters in `assets/brand/` + `scripts/gen-brand-assets.mjs`
   renders every raster. `docs/brand/LOGO.md` rewritten to match; it must stop pointing at
   `src/brand/Logo.tsx` (deleted — dead code drawing a mark that never shipped).
6. **Landing unifies.** Gold palette retired; landing moves to product dark-navy + lit
   blue/teal. Photography regenerated cool-lit via existing gpt-image-2 pipeline
   (same compositions). Hero video: ffmpeg re-grade first; Kling regen only with founder
   spend approval.

## Master assets (new/rewritten in `assets/brand/`)

| File | Content |
|---|---|
| `dial-flat-dark.svg` | Flat mark, on-dark (track `rgba(255,255,255,.16)`, marker bezel `#0F172A`) |
| `dial-flat-light.svg` | Flat mark, on-light (track `#DCE7FB`, marker bezel `#FFFFFF` + stroke) |
| `dial-lit.svg` | F2 finish: sweep arc + tight glow (feGaussianBlur), glassy inner shade, enamel marker with fine dark bezel + halo |
| `icon-tile.svg` | App icon: lit dial at ~61% on `#070B14` tile (superellipse-safe margins) |
| `wordmark-dark.svg` / `wordmark-light.svg` | Two-tone lockup, text converted to paths |
| `lockup-dark.svg` / `lockup-light.svg` | mark + wordmark at law ratios |

## Generated rasters (via `scripts/gen-brand-assets.mjs`, headless-chrome screenshot of masters)

`assets/icon.png` (1024) · `assets/splash-icon.png` · `assets/android-icon-{background,foreground,monochrome}.png` ·
`assets/favicon.png` (64, flat) · `web/landing/assets/favicon.png` · `web/landing/assets/apple-touch-icon.png` ·
`web/landing/assets/og.png` (1200×630, lit dial + two-tone wordmark) ·
`web/landing/assets/brand/email-mark.png` (80px, flat-dark on navy chip — hosted for email clients; Gmail strips SVG).

`app.json`: android adaptiveIcon `backgroundColor` → `#070B14` (matches new tile; was `#2563EB`).
**New app icon requires a new TestFlight/native build — icons cannot ship OTA.** OTA covers everything in proto.

## Surface rollout (complete list — no exceptions)

1. **Proto app** (`proto/redesign-2026-07/`): `components.js logoMark()` → theme-adaptive flat mark;
   5 call sites unchanged; `share-card.js` → draw dial mark + two-tone wordmark (canvas), keep tier/captions;
   rebuild `assets/proto.zip` (`scripts/build-proto-zip.mjs`) → OTA. Remember trust.js/meal.js/coach.js renderers untouched (no brand element).
2. **RN shell**: delete `src/brand/Logo.tsx` (dead, divergent).
3. **Landing** (`web/landing/`): all 7 pages re-skinned to unified palette (site.css v4);
   nav/footer lockup = canonical SVG (self-contained gradient defs per instance — the footer
   currently references the nav's gradient id and breaks if nav is removed); privacy/terms/reset
   brand blocks unified; reset.html checkmark chip → flat dial; photo set regenerated cool-lit;
   hero video re-graded; og/favicon/apple-touch regenerated; JSON-LD unchanged (name only).
4. **Trainer page** `web/landing/t.html`: canonical tokens, mark square → flat dial, wordmark.
5. **Admin** `web/admin/{index,flags,reset}.html`: canonical tokens (`#33c6d6` → `#22D3EE`),
   mark square → flat dial, lockup with "Command Center" sub-line kept.
6. **Auth emails**: `scripts/gen-auth-email-templates.mjs` → header uses hosted
   `email-mark.png` + two-tone wordmark (HTML spans), sweep bar kept; regenerate all 13 in
   `supabase/email-templates/`. config.toml wiring remains commented — flagged to founder, not changed here.
7. **Edge-function emails** (currently unbranded): `guardian-request`, `claim-reminders` get the
   branded header; `admin-alert` sender name unchanged.
8. **Edge-function pages**: `guardian-verify` consent page + `billing-return` return page get
   flat dial + two-tone wordmark + canonical colors.
9. **Marketing cards**: `web/marketing-src/cards.html` lockup → canonical (two-tone wordmark);
   re-render all 12 PNGs via existing Playwright element-screenshot pipeline.
10. **Lockscreen product shot** `web/landing-src/lockscreen.html`: fake app icon → match the real
    new `icon-tile` render; re-render `vc-1-lockscreen.webp`.
11. **Docs**: rewrite `docs/brand/LOGO.md`; fix `DESIGN.md` claim to be true.

## Non-goals

- No change to score-tier naming ("OnStandard" as the 90+ band), push copy, AI persona names,
  `window.OnStandardNative` bridge namespace, bundle ids, or the `onstandard://` scheme.
- No Supabase config.toml enablement of custom email templates (founder decision).
- No new TestFlight build submitted by this work — assets are made ready; build/submit is a
  separate step the founder triggers.

## Verification

- `gen-brand-assets.mjs` run is idempotent; every raster diff-reviewed visually.
- Proto: headless screenshots of welcome/signin/roles in dark AND light; share-card render check.
- Landing: full-page screenshots of all 7 pages at 390px and 1280px; grep proves zero
  occurrences of retired hexes (`#E8B44A`, `#3d7dff`, `#2fd4c8`, `#33c6d6`) and zero
  `ONSTANDARD` all-caps wordmark instances outside the score-tier copy.
- Emails: rendered HTML previews of all 13 + 2 function emails.
- Repo-wide grep: no `brandDial`-style cross-references, no checkmark-square lockups left.
