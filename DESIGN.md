# AthleteOS — Design System

The established, committed visual language. Documented so design work **refines within it**.
Source of truth: `../athleteos-design-ref/design_handoff_athleteos/` (README + `.dc.html`).
Tokens live in code at `src/ui/tokens.ts` — use them; never hardcode stray hex/spacing.

## Color
Tinted-slate neutrals + Athlete Blue as the single carrying accent (Restrained strategy).
- Canvas `#F8FAFC` · secondary `#F1F5F9` · card `#FFFFFF`
- Text `#0F172A` · secondary `#64748B` · tertiary `#94A3B8`
- **Athlete Blue `#2563EB`** (primary) · light `#3B82F6` · surface `#EFF6FF` · borders `#DBEAFE`/`#BFDBFE`
- Success `#22C55E` (deep `#16A34A`, surface `#DCFCE7`) · Warning `#F59E0B` (deep `#D97706`)
- Alert `#EF4444` (deep `#DC2626`, surface `#FEF2F2`) · Hydration `#38BDF8` · Trainer purple `#7C3AED`
- Grade chips: A green / B blue / C amber / D orange / F red.
- Hairlines/tracks: `#EAEEF3` / `#EEF2F6` / `#EFF2F6`.
(The app ships these exact hexes via `tokens.ts`. Do not convert to OKLCH — keep parity.)

## Typography
- **Plus Jakarta Sans**, weights 400–800 (loaded via @expo-google-fonts). System fallback `system-ui`.
- Screen titles 28px/800; section titles 15–16px/800; card values 22–48px/800 (score hero 48px);
  body 14–15px/600–700; labels/meta 11–13px/600–700; micro-labels 10–12px/800 UPPERCASE with
  positive letter-spacing 0.04–0.16em.
- Big headings: negative tracking −0.02 to −0.04em. Numerals are heavy (800) and tight (−0.03em).

## Elevation (shadows, via tokens.shadow)
- Standard card: `0 1px 2px rgba(15,23,42,.04), 0 6px 18px rgba(15,23,42,.05)`
- Elevated: `0 10px 30px rgba(15,23,42,.06)`
- Blue CTA glow: `0 8px 22px rgba(37,99,235,.28)`

## Shape & spacing
- Radii: cards 18–24 · pills/buttons 11–18 · chips 9–13 · inner tiles 13–16 · full for avatars/toggles.
- Screen padding 20 (mobile). Card padding 18–24. Stack gaps 8–16. Vary spacing for rhythm.
- Primary button: 58px tall, radius 18, Athlete Blue, white 700 text, blue glow.

## Components (src/ui)
`Txt` (weighted), `Card`/`Row`, `Btn` (primary/secondary), `Chip`, `Toggle`, `ProgressBar`
(animated), `Ring` (animated SVG score/macro ring), `Slider`, `Pill`, `Avatar`, `Input`,
`Screen`/`Body`. Icons: inline SVG, 2px stroke, round caps, currentColor (`src/icons`).
Improve primitives so polish propagates; avoid per-screen one-offs.

## Motion (the handoff's named animations — extend where missing)
ring draw `aos-ring` (1.5s ease-out cubic) · bar grow · overlay slide-up `aos-up` (.3–.4s) ·
meal scan-line `aos-scan` · spinner `aos-spin` · subtle `aos-pulse`. Ease out only; no bounce.
`expo-haptics` is installed — use light haptics on key actions (log meal, complete task, submit).

## Iconography
Inline SVG, 2px stroke, round caps/joins, currentColor-driven. No emoji. The logo mark
(score-ring → rising check) doubles as the brand glyph.
