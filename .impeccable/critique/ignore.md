# Critique ignore list

Findings reviewed and deliberately accepted. `impeccable critique` drops any finding whose rule
name or snippet matches a line here, so keep each line specific and keep the reason with it.

Last reviewed 2026-08-14, against a detector run of 14 findings.

## Documented parts of the design system

- **layout-transition — `transition: height` (app.css:34 and its inlined copy in index.html).**
  The deliberate iOS keyboard-resize mechanic: 220ms tuned to match the keyboard slide (see
  js/keyboard.js and the comment at the rule). Judged exception 2026-08-14; the layout-animation
  ban stands everywhere else.

- **Overused font — Plus Jakarta Sans.** The committed brand face (DESIGN.md), paired with Archivo
  as the display face for scores. The detector reads it as a generic AI-UI default; here it is a
  long-standing brand decision and PRODUCT.md says the system is law.

- **Colored box-shadow glow (#2563eb) on dark page.** This is `--sh-blue`, the primary-button
  lift, documented in DESIGN.md as the blue CTA glow. It marks the one action on a screen, on the
  brand's own hue. Note this is NOT the old score-ring aurora, which was a real finding and was
  removed 2026-08-08.

- **radial-gradient halo (#0d1830 → transparent) on dark page.** The canvas itself:
  `--bg` to `--bg-grad-top`, the wash behind the hero that also shifts with `data-daypart`. It is
  the app's ground, not a decorative bloom on top of it.

- **Pulsing status dot.** The only one in the app is the chat typing indicator
  (`.msg .tdots span`), tied to genuinely live state, which is exactly the use the rule reserves
  it for. The score ring's marker used to pulse forever too; that one was removed.

- **repeating-gradient decorative stripes.** The three `repeating-linear-gradient` uses are
  semantic hatching for a GAP in a record (`screens.css:408`, `:1540`, `.cs-mom b.gap`). Diagonal
  hatch means "no data here", not surface decoration.

## Detector false positives

- **Broken or placeholder image (×9).** `<img>` elements whose `src` is assigned at runtime from
  the photo store (`chat-attach.js`, `image-viewer.js`, `meal.js`, `coach.js`, `trust.js`). They
  are hidden until a real URL resolves and never paint a broken-image box. Their `alt` text was
  corrected 2026-08-08; the ones still empty sit inside `aria-hidden` wrappers and genuinely are
  decorative.

## Resolved, not ignored (kept here so they are not re-litigated as "accepted")

- Gradient text (11 sites) — **fixed**, all solid now.
- Layout-property animation (4 sites) — **fixed**, all `transform: scaleX()`.
- Low contrast (2) and a third dark-glow — lived in `practice-hq-mockup.html`, an unreferenced
  541KB design mockup that was shipping inside `assets/proto.zip`. **Deleted 2026-08-08**
  (recoverable from git; a related copy remains at `.fable5/proto/practice-hq.html`).

## Known, not yet addressed

- The proto bundle still ships its own test files: 24 `*.test.mjs`, ~192KB, inside
  `assets/proto.zip`. `scripts/build-proto-zip.mjs` walks the directory and excludes only
  `.DS_Store`. Not a design finding, but it is dead weight in every OTA download.
