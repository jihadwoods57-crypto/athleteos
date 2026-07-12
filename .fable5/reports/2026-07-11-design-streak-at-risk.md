# Design — Home "streak at risk" state (grace-calibrated loss aversion)

Prototype: https://claude.ai/code/artifact/833de75b-053b-4c6f-bbbf-f254eeab611d
Phase: Design (Fable 5, Opus). Presentation-only, revertible, no backend, no new data.

## Problem (from audit)
The most retention-critical moment — athlete returns with an unfinished day and a streak on the
line — renders as a passive `🔥 N day streak` pill (home.js:85) plus a task-level countdown. The
stakes of the streak itself are never shown, and the fragile-streak signal (`graceUsedRecently`,
state.js:962) is computed but invisible, so a graced streak can lapse at midnight unseen.

## Source of truth (existing, verified — nothing new)
- `S.streak` (state.js:957-968) → `{ days, todayCounted, graceDate, graceUsedRecently, label }`.
- `streakInfo()` (day.js:170-199): `todayCounted = dayScore() >= THRESH` where `THRESH = 80`.
- Route target: `(e.now && e.now.route) || (e.overdue[0] && e.overdue[0].route) || 'home'` and the
  action label from `e.now.title` (exec.js) — the SAME next action the day already surfaces.

## Trigger
Fires only when `streak.days >= 2 && !streak.todayCounted`. Below 2 days there is no streak worth
protecting → strip stays quiet (no manufactured stakes). Once `todayCounted` flips true → pill goes
green/secured, prompt retires for the day.

## Two calibrated tiers (the signature idea: the icon encodes the stakes)
1. STRONG — `graceUsedRecently === true` (streak genuinely dies at midnight):
   - In-strip tier row: passive fire pill replaced by amber `stk-pill risk`: `🔥 N-DAY · AT RISK`.
   - Ribbon below strip (amber, `--amber-border`, flame icon): title "Your N-day streak ends at
     midnight", body "Your one covered miss this week is already spent. Hit 80 today to keep it.",
     right-side action pill "Log {now.title}" → routes to exec now/overdue. Strip border→amber.
2. MILD — grace intact (a miss tonight would be graced):
   - Tier row: quiet blue `stk-pill safe`: `🛡 N-DAY · COVERED` (shield = protected).
   - Ribbon (calm, surface-2 + `--blue-border`, shield icon): "One miss is covered this week /
     You're safe tonight. Finish today to extend your N-day run to N+1." Same route, quieter action.

Calibration is the honesty guarantee: amber/flame ("burning down") ONLY when the loss is real;
blue/shield ("protected") when there's still a safety net. Never alarm without cause.

## Notifications mirror (state.js notifications getter, ~1360-1383)
One row prepended alongside the existing overdue/next/hydration/celebration rows, same tier logic:
- strong → `level:'high'` (amber), "Your N-day streak ends tonight …"
- mild → `level:'medium'` (blue), "Finish today to extend your N-day run …"
- (secured is already covered by the existing celebration positive row — do not double up.)
Reuse `.notif`, `.ntag`, existing level classes. Icon: flame (high) / shield (medium).

## Tokens reused (no new CSS system)
`xstrip`, `status-pill`, `xpill`, `xsegs`, `--amber*`/`--blue*`/`--green*`, `.notif`, `.ntag`.
New classes if needed are thin: `stk-pill` (variant of existing pill) and a `ribbon` block built
from surface-1/surface-2 + existing border tokens. All amber = real loss, blue = safe, green =
secured. AA contrast holds (amber-bright/blue-bright/green-bright on dark are the app's live pairs).

## States covered
strong at-risk · mild at-risk · secured (green pill, prompt gone) · no-streak (<2 days, quiet) ·
offline (strip + prompt derive from local DAY/score; CTA route is local-first, so it still works).

## Wiring notes for Build
- The ribbon is tappable and needs `data-go` to the now/overdue route; it sits OUTSIDE the strip's
  `data-go="score-breakdown"` so its tap is not swallowed (render it as a sibling after `strip(e)`,
  or stop propagation). Cleanest: render `streakPrompt(e)` right after `${strip(e)}` in home.js.
- Keep the passive pill for `todayCounted || days < 2` exactly as today.
- Copy must always say 80 (THRESH) and "midnight" (matches celebration "locks at midnight").
