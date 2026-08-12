# OnStandard — Design System

The committed visual language, documented so design work **refines within it**.

**Source of truth is code, not this file.** Everything below is read out of
`proto/redesign-2026-07/css/tokens.css`. That file is the system; this is its index. If the two
disagree, the CSS wins and this file is stale.

> Regenerated 2026-08-08. The previous version of this file described a light-canvas system
> (`#F8FAFC`, white cards, Athlete Blue spine) that the app had already moved off. The shipped
> app is **dark-first**. Anything planned against the old doc was planned against a product
> nobody was using.

## Themes: dark is the default, light is a first-class peer

`:root` is dark. `:root[data-theme="light"]` is the full mirror, stamped by `state.js` from the
athlete's own Dark / Light / System choice. Both ship, both are supported, and **every new rule
has to hold in both**.

The two rules that make that possible, and that get broken most often:

1. **Never hardcode a hue.** Use the token. A raw `rgba(52,211,153,.12)` freezes a wash at its
   dark value and shows as mint-on-white in light. Compose alpha from the RGB triples instead:
   `rgba(var(--green-rgb), .12)`.
2. **Gradient fills pair `--hue` with `--hue-deep`, never `--hue-bright`.** In light theme
   `-bright` is the *text-weight* variant and goes **deeper** (a 700), so a
   `linear-gradient(var(--green-bright), #16a34a)` inverts direction on light.

There is also a `data-daypart` layer (morning / evening) that moves **exactly one token**,
`--bg-grad-top`, on the same hour boundaries as `S.greeting`. It is not a third theme, and
nothing else may join it.

## Color

| Role | Dark | Light |
|---|---|---|
| Canvas `--bg` | `#070B14` | `#F8FAFC` |
| Hero wash `--bg-grad-top` | `#0A1120` | `#EFF4FA` |
| Card `--surface-1` | `#0E1421` | `#FFFFFF` |
| Elevated row `--surface-2` | `#131C2D` | `#F1F5F9` |
| Pressed / well `--surface-3` | `#1A2436` | `#E8EEF5` |
| Text `--text` | `#EEF3FB` | `#0F172A` |
| Secondary `--text-2` | `#9AA9C2` | `#475569` |
| Meta `--text-3` | `#7C8BA6` | `#5B6675` |
| Hairline / soft | `rgba(148,176,224,.10)` / `.055` | `rgba(15,23,42,.10)` / `.055` |

Strategy is **Restrained**: tinted neutrals carry the surface, Athlete Blue is the one accent that
carries action. Every neutral is tinted toward the brand's slate-blue. Never `#000`, never `#fff`.

**Athlete Blue (the spine)** — `--blue` `#3B82F6` / `--blue-bright` `#60A5FA` / `--blue-deep`
`#2563EB`. Light: `#2563EB` / `#2563EB` / `#1D4ED8`.

**Semantic hues, each with exactly ONE meaning.** This is a rule, not a description; a hue doing
two jobs is a bug.

| Token | Dark | Light | Means |
|---|---|---|---|
| `--green` | `#34D399` | `#16A34A` | nutrition, done, on standard |
| `--amber` | `#F5A524` | `#D97706` | **warning only** — at risk, off pace, injury |
| `--purple` | `#A855F7` | `#9333EA` | recovery |
| `--red` | `#F65757` | `#DC2626` | missed, alert |
| `--cyan` | `#38BDF8` | `#0284C7` | weekly check-in |
| `--danger-solid` | `#DC2626` | `#DC2626` | fill under white text on a destructive button |

Each also has `-bright`, `-deep`, `-surface`, `-border`, and an `--x-rgb` triple.

Neutral provenance and read-only status use `.status-pill.muted`, **not** amber. "Set for you" is a
fact, not a warning.

**Accent letters.** A requirement or score part carries a one-letter accent: `g` green, `a` amber,
`b` blue, `p` purple, `c` cyan. Resolve it through `accentVar(accent)` in `js/score-band.js`. Do
not write the ternary inline; four screens did, each with a different fallback.

**The sweep** — `--ring-a` → `--ring-b` → `--ring-c`, green → teal → blue. Dark
`#34D399 · #22D3EE · #3B82F6`; light `#10B981 · #06B6D4 · #2563EB`.

**Reserved for score surfaces, and the code complies** (resolved 2026-08-08; before that it had
drifted onto 29 non-score uses). A score surface is something that displays or produces an
OnStandard score: the daily ring (`components.js scoreRing()`), the onboarding score dial
(`ob2.js meter()`), the meal-quality ring (`meal.js`), the analyzing scan-line (`flows.css
.scanline`, the moment the meal score is being read), and the share card. Nothing else.
Progress geometry — onboarding step segments, Connected-Standards bars/columns/momentum, the
Plan tab underline — wears blue (the action accent) or its own status hue. If you are about to
put `--ring-*` on something that is not a score, use `accentVar()` or `--blue`/`--blue-deep`
instead; the reservation is what makes the ring mean "this is the number."

**Contrast is measured against `--bg`**, and the light values are tuned to clear AA on it
(`--red-bright` 6.2:1, `--cyan-bright` 5.4:1). `--text-3` is `#7C8BA6` on dark specifically because
`#64748B` only reached 4.14:1 there.

## Typography

`--font: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif`

`--font-display: 'Archivo', 'Plus Jakarta Sans', system-ui, sans-serif` — **reserved for scores.**
Archivo Expanded 900 is the same letterform as onstandard.app, so the number in the app and the
number in the marketing match. Use it for anything else and it stops meaning "this is the number
that matters." The fallback leads with Plus Jakarta Sans 800, so a failed font load degrades to
today's appearance rather than a system serif.

Twelve steps counting the two special-purpose ones (`--t-micro`, `--t-score`). Each is far
enough from its neighbour to read as a deliberate level. Do not add another, and do not reach
for a value between two of them. A step is only ever minted when a REAL populated tier exists
with no token naming it (`--t-score` 2026-08-08, `--t-micro` 2026-08-12), never speculatively.

| Token | Size | Use |
|---|---|---|
| `--t-micro` | 10px | tier badges, tags, pill text (`.co-tier`, `.xpill`) |
| `--t-eyebrow` | 11px | uppercase section labels, stat keys |
| `--t-xs` | 11px | meta, timestamps, captions |
| `--t-sm` | 12.5px | secondary body, list subtitles |
| `--t-base` | 14px | body |
| `--t-md` | 15.5px | emphasised body, list titles |
| `--t-lg` | 17px | card titles |
| `--t-xl` | 20px | section headings |
| `--t-2xl` | 24px | screen titles |
| `--t-3xl` | 34px | stat numerals |
| `--t-hero` | 52px | the score |

Weights 400–800. Tracking: `--num-tight` −0.03em on numerals, `--title-tight` −0.02em on headings,
`--track-eyebrow` 0.14em on uppercase labels, `--track-key` 0.06em on small stat keys.

> **The scale is now enforced by a ratchet, and Home is migrated** (2026-08-08). Two things
> changed from the earlier warning that stood here:
>
> 1. **Home — the flagship — is on the tokens.** Its twelve distinct computed sizes (9.5 through
>    88px, three of them on-scale) were snapped to the nearest step: hero chrome, eyebrows, group
>    labels, record rows, result cards, the celebration, the ring's `/100` and delta. The ring
>    numeral got a real tenth step, `--t-score: 88px`, instead of a magic number in `app.css` —
>    and `--t-eyebrow` moved from its aspirational 10px to the 11px every real eyebrow has always
>    been, because tokens describe the system, not a wish.
> 2. **Drift now fails the build.** `npm run lint:type`
>    (`proto/redesign-2026-07/tools/type-scale-ratchet.mjs`, inside `npm run verify` next to
>    `lint:copy` and `lint:xss`) records every file's raw `font-size: Npx` count in a checked-in
>    baseline and fails if any file's count ever rises. New files start at a ceiling of zero.
>    Unmigrated screens are legacy debt that can only shrink; after a migration lowers a count,
>    `--write` locks the new lower ceiling in.
>
> Baseline at the time of writing: ~900 raw declarations across 57 files, monotonically
> decreasing by construction.

## Shape

Five radius steps. `--r-tile` and `--r-btn` are **aliases** of `--r-card-sm`, kept so no rule had
to change. They are not levels. Do not add a sixth.

| Token | Value | Use |
|---|---|---|
| `--r-micro` | 4px | a mark, not a container: progress fills, bar segments |
| `--r-chip` | 11px | chips, small icon tiles |
| `--r-card-sm` | 16px | inner surfaces, buttons, icon boxes |
| `--r-card` | 22px | a top-level card |
| `--r-pill` | 999px | pills, avatars, circles |

## Spacing

`--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 20 · `--s6` 24 · `--s7` 32 · `--s8` 40 ·
`--s9` 56. Screen padding `--pad-screen` 20px. Tab bar `--nav-h` 96px (one token: it was written
in three places and had three chances to disagree).

Vary spacing for rhythm. Uniform padding everywhere is monotony.

## Elevation

| Token | Dark | Light |
|---|---|---|
| `--sh-card` | `0 1px 0 rgba(255,255,255,.05) inset, 0 8px 24px rgba(0,0,0,.36)` | `0 1px 2px rgba(15,23,42,.06), 0 8px 22px rgba(15,23,42,.09)` |
| `--sh-raised` | `0 14px 40px rgba(0,0,0,.48)` | `0 10px 30px rgba(15,23,42,.10)` |
| `--sh-blue` | `0 10px 30px rgba(37,99,235,.40)` | `0 8px 22px rgba(37,99,235,.28)` |
| `--score-lift` | teal halo + dark drop | teal halo only (dark ink needs no drop) |

Cards do not draw a border on dark; the inset top highlight is what gives them an edge. On light
there is no highlight to use, so the lift carries it alone. Either way a card should look
**placed, not drawn**.

## Material

`--grain-opacity` — film grain over the canvas: `0.045` dark, `0.022` light. Two jobs: it breaks
the banding a large very-dark radial gradient produces on OLED, and it gives a flat fill the read
of a material rather than an empty buffer. Above ~0.06 it stops looking like a surface and starts
looking like compression noise. Light runs at half amplitude because the noise tile is
light-on-dark and reads twice as loud on a near-white ground.

## Motion

- `--ease-out` `cubic-bezier(.16, 1, .3, 1)` and `--ease-out-quart` `cubic-bezier(.25, 1, .5, 1)`.
  **Ease out only. No bounce, no elastic.**
- `--dur-1` 160ms · `--dur-2` 280ms · `--dur-3` 460ms · `--dur-ring` 1400ms.
- Named animations: ring draw, bar grow, overlay slide-up, meal scan-line, spinner, subtle pulse.
- **Never animate a layout property.** Bar fills are `width: 100%` with
  `transform-origin: left` and an inline `transform: scaleX(<0..1>)`; the track clips with
  `overflow: hidden` and owns the radius.
- Motion conveys state, never decoration. Entrance animations are gated so a same-route repaint
  does not replay them.
- `prefers-reduced-motion` blocks exist in `screens.css` and `app.css` and must stay honoured.
- `expo-haptics` is installed; use light haptics on log, complete, and submit.

## Components

In `js/components.js`. Improve the primitive so polish propagates; avoid per-screen one-offs.

`Txt` · `Card` / `Row` · `Btn` (primary / ghost / green) · `Chip` · `Toggle` · `ProgressBar` ·
`Ring` (animated SVG score/macro ring) · `Slider` · `Pill` · `Avatar` · `Input` · `Screen` / `Body`
· `composer` · `backHead` / `titleHead` / `avatarHead` · `planStyleCard` · `sparkline`.

**State primitives — every data-bearing surface owes the user all four.** These are not optional
and not for coach screens only:

- `skeletonRows(n, label)` — loading. A skeleton shaped like the list it stands in for, never a
  spinner in content.
- `emptyState({icon, title, body, action})` — empty. Teaches, and carries a **direct** action.
  Never a dead pointer at a control somewhere else on the screen.
- `errorState({title, body, retryId})` — honest failure plus retry. Never fabricated data.
- `permissionState({title, body})` — role-scoped denial with no dangling controls.

`segBar(done, total, label)` renders the "N of M discrete things done" strip. One builder, and the
`label` is required because the strip is a `role="img"`.

## Iconography

Inline SVG, 2px stroke, round caps and joins, `currentColor`, from `js/icons.js`. **No emoji.**
`icon()` warns to the console on an unknown key rather than silently emitting a path-less `<svg>`.
Add the glyph to `P` before you use its name.

The logo mark is the **Performance Dial** (`docs/brand/LOGO.md`): one geometry, two finishes (lit
for large rendered surfaces, flat for small), one two-tone wordmark, used across the app icon,
in-app, onstandard.app, admin, emails, and marketing. Masters in `assets/brand/`, rasters via
`scripts/gen-brand-assets.mjs`.

## Score thresholds

One ladder, in `js/score-band.js`. Three numbers, defined once: **60**, **80**, **90**.

| Tier | Range | `cls` |
|---|---|---|
| OnStandard | 90–100 | `g` |
| Locked In | 80–89 | `b` |
| Building | 60–79 | `a` |
| Off Standard | 0–59 | `r` |

`ON_STANDARD = 80` is the same 80 the streak gate, the roster, and "days on standard (≥80)" use.
Never re-inline these numbers; call `tierFor(score)`, `scoreBand(score)`, `tierColor(score)`.

## Hard bans

- **No gradient text.** No `background-clip: text` over a gradient, on prose or on a number. A
  gradient-filled hero metric is the anti-reference by name. Emphasis comes from size, weight, and
  one solid colour.
- **No side-stripe accents.** `border-left` / `border-right` over 1px as a colour accent.
- **No glassmorphism by default.** Blur is platform chrome (the tab bar over live content), with a
  documented `@supports` fallback. It is not a card treatment.
- **No identical card grids.** Repeated icon + heading + text tiles.
- **No animating layout properties.** See Motion.
- **No modal as the first idea.** Exhaust inline and progressive alternatives.
- **One overlay at a time.** The tour, the lock stamp, the image viewer, the members sheet and
  tapback all guard on each other's DOM markers. A new overlay joins that guard list.
- **No em dashes in new copy.** Commas, colons, semicolons, periods, parentheses.
