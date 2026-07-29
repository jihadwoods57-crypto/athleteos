# Design System — inventory and direction

Source of truth: `proto/redesign-2026-07/css/tokens.css`, consumed by `app.css`, `screens.css`,
`flows.css`, `coach.css`, `ob2.css` and `focus.css`.

## State as found

The token file is the strongest artifact in the repository: 36 colour tokens and 5 shadow tokens
with deliberate, contrast-reasoned light/dark pairs, and comments explaining the WCAG arithmetic
behind specific values. **Nothing else respected it.**

| Measure | As found |
|---|---|
| Colour literals outside `tokens.css` | **249** (91 hex, 158 rgba) |
| Light-theme override rules in component CSS | **8** |
| Brand hues re-expressed as raw rgba, frozen at dark values | 101 (30 distinct green alphas alone) |
| Distinct font sizes | **45** across 809 declarations |
| Font-size tokens | **0** |
| Spacing declarations using a token | 33 of 770 (**4.3%**) |
| Card-like container rules | **130** |
| `1px solid` borders | **165** |
| Card class names doing one job | **46** |
| Stat-tile implementations | 11 |
| Progress-bar primitives | 15 |
| `:focus-visible` rules | **4** (against 82 interactive affordances) |
| `outline: none` rules | 9 |

**The causal chain matters more than any single number.** With 15 font sizes packed into a 7px
band, adjacent levels differ by less than a device pixel — so typography cannot separate anything.
Every new level of meaning therefore gets a new border and a new background tint. *165 hairlines
and 130 card rules are the cost of a type scale that cannot signal hierarchy.* Fixing the boxes
without fixing the type would just re-grow them.

## Changed in this pass

### Colour — closed the gaps that broke light mode

| Token | Dark | Light | Retires |
|---|---|---|---|
| `--red-bright` | `#F87171` (red-400) | `#B91C1C` (red-700) | 27 uses of invented `#FF9B9B` / `#f87171` |
| `--cyan-bright` | `#38BDF8` | `#0369A1` (sky-700) | `--cyan` used as text at 4.1:1 |
| `--cyan-border` | `rgba(56,189,248,.30)` | `rgba(2,132,199,.28)` | a hardcoded rgba of the same hue |
| `--ink-on-accent` | `#06120C` | `#FFFFFF` | the 7-way "text on a filled accent" split |

Both new `-bright` values follow the family pattern exactly — 400-level in dark, 700-level in
light, as green/amber/purple already do. Measured on `--bg`: 6.2:1 and 5.4:1.

`--ink-on-accent` is the one genuinely new idea: ink on a filled accent **must** flip with the
theme, because dark-theme accents are bright (ink goes near-black) and light-theme accents are
deep (ink goes white). A single fixed value cannot serve both — which is why the pre-existing
`--text-on-accent` (`#FFFFFF` in both themes) had **zero** uses and seven ad-hoc inks grew around
it.

### Type — the scale exists now

Ten steps, each far enough apart to read as a deliberate level:

```
--t-eyebrow 10     uppercase section labels, stat keys
--t-xs      11     meta, timestamps, captions
--t-sm      12.5   secondary body, list subtitles
--t-base    14     body
--t-md      15.5   emphasised body, list titles
--t-lg      17     card titles
--t-xl      20     section headings
--t-2xl     24     screen titles
--t-3xl     34     stat numerals
--t-hero    52     the score
```

**Adoption is deliberately incremental.** A mechanical sweep of all 618 body-range declarations
would shift every screen at once and be unreviewable. New and refactored rules use the tokens;
legacy literals migrate per screen so each step is visible in the QC contact sheet.

### Focus — a real layer

`css/focus.css`, loaded **last** on purpose so it wins the cascade against 9 `outline: none`
rules without `!important`. A broad `:where()` list at zero specificity covers links, buttons,
chips, tiles, tabs, rows and cards; explicit per-class rules cover the fields that actively
suppress outlines. `:focus-visible` throughout, so pointer users see no change.

Verified in a real browser: all 9 previously-suppressed fields now compute a 2px ring.

## Direction — what should happen next, in order

1. **Migrate the type scale per screen**, starting with athlete Home. Expect card rules and
   hairlines to fall out naturally as type starts carrying hierarchy — that is the test of whether
   the scale is right.
2. **Replace the 101 raw brand `rgba()`** with the existing `-surface` / `-border` tokens plus
   3–4 defined alpha steps. There is currently no alpha scale: 18 distinct green alphas, 15 amber,
   13 blue is a continuum, not a system.
3. **Consolidate the duplicates** — 11 stat tiles → 1, 15 progress bars → 2 (bar and segmented),
   21 pill classes → 1 with semantic modifiers, 6 empty-state systems → 1, 4 button systems → 1.
4. **Pick one skeleton system.** There are three (`.sk-card` family, `.sk`, `.mr-skel`), two with
   identical gradients and different keyframe names. The `.sk` collision already shipped a live
   bug — AI analysis labels rendering with an infinite loading shimmer.
5. **Delete `.reqcard`** (app.css:216–241) — 26 lines, zero usages.
6. **Add a z-index scale.** 12 raw values, no tokens.
7. **Define error and toast patterns.** There is no toast, no snackbar, no inline validation
   success, and no shared retry pattern — three different error treatments across three files.

## Rules to hold going forward

- No colour literal outside `tokens.css`. If a hue is needed and no token fits, add the token.
- No font size outside the scale.
- `-bright` is the **text-weight** variant: lighter in dark, deeper in light. Never the reverse.
- Ink on a filled accent is `--ink-on-accent`, never a hardcoded hex.
- Anything that opts out of the focus layer must supply its own visible focus state.
- Hierarchy comes from type, spacing and grouping. A new border is the last resort, not the first.
