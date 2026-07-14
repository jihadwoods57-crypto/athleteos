# OnStandard — Logo & Brand Mark

The **"Performance Dial"**: a score gauge reading at the very top of its scale (i.e. *on
standard*) whose silhouette also reads as the letter "O". Source of truth for the app is
[`src/brand/Logo.tsx`](../../src/brand/Logo.tsx); vector sources live in
[`assets/brand/`](../../assets/brand/). Transcribed from the founder's brand handoff (hi-fi).

## Geometry (viewBox `0 0 100 100`, `fill="none"`)

Dial center `(50,52)`, radius `34`, stroke width `12` (bump to 13–15 at favicon sizes).

| Element | Definition |
|---|---|
| Track arc (unfilled remainder, gap at bottom) | `<path d="M33 81.4 A34 34 0 1 1 67 81.4" .../>` |
| Progress arc (filled sweep to the top marker) | `<path d="M33 81.4 A34 34 0 0 1 50 18" .../>` |
| Marker outer disc | `<circle cx=50 cy=18 r=10.5 />` |
| Marker inner disc | `<circle cx=50 cy=18 r=6 />` (r 6.5 on tiles) |

## Variants (element → color)

| Variant | Track | Progress | Marker outer | Marker inner |
|---|---|---|---|---|
| Primary (on light) | `#DCE7FB` | signature sweep\* | `#FFFFFF` | `#2563EB` |
| App icon (white on gradient tile) | `rgba(255,255,255,0.34)` | `#FFFFFF` | `#2563EB` | `#FFFFFF` |
| On dark | `rgba(255,255,255,0.16)` | signature sweep\* | `#0F172A` | `#FFFFFF` |
| Monochrome | `#E2E8F0` | `#0F172A` | `#FFFFFF` | `#0F172A` |

\* **Signature sweep** (founder-ratified 2026-07-14): the progress arc carries the score-ring
gradient `#34D399 → #22D3EE → #60A5FA` (green → teal → blue), directional
`x1=26 y1=82 x2=58 y2=18` (userSpaceOnUse) — green at the arc's base, blue at the marker.
On light surfaces end the sweep at `#3B82F6` instead of `#60A5FA` for contrast. The app-icon
tile keeps its white arc on the blue gradient tile (legibility at small sizes); monochrome
unchanged. This supersedes the earlier blue-only gradient `#3B82F6 → #2563EB`.

## Wordmark

Two-tone, **Plus Jakarta Sans 800**: **On** in `#0F172A`, **Standard** in `#2563EB`, one
string `OnStandard`, `letter-spacing: -0.04em`. Horizontal lockup: mark + wordmark, gap ≈ 0.32×
mark height, mark ≈ 1.6× the wordmark cap height.

## Tokens

Primary `#2563EB` · gradient start `#3B82F6` · light track `#DCE7FB` · on-dark accent `#60A5FA`
· ink `#0F172A` · slate `#64748B` · hairline `#E2E8F0`. App-icon tile radius ≈ 24% of side.

## Rendered assets (regenerate from `assets/brand/*.svg` if the mark changes)

`assets/icon.png` (1024, opaque tile) · `assets/favicon.png` (64) · `assets/android-icon-{foreground,background,monochrome}.png` (1024; foreground/monochrome transparent, safe-zone padded).
