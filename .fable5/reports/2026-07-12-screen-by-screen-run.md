# Fable 5 Run Report — Screen-by-Screen Frontend Improvement Engine (full coverage)

**Dates:** 2026-07-11 → 2026-07-12
**Branch:** `fable5/2026-07-11-screen-by-screen-frontend-improvement` · **master untouched**
**Batch tags:** `fable5/2026-07-11-systematic-screen-by-screen-frontend-imp` (cycle 1) · `fable5/2026-07-12-home-secured-pill` · `fable5/2026-07-12-home-streak-route-fix` · `fable5/2026-07-12-screens-batch1..5` · final batch on HEAD
**Calibration gate:** PASSED 2026-07-12 (founder approved streak-at-risk direction + green secured pill)

## Outcome (one line)
All 30 ledger rows covered — every proto screen torn down (ADD/UPGRADE/REARRANGE/DELETE) and its accepted top improvements shipped one per cycle: **40+ improvements across 24 screens**, every one browser-verified at 390px, verify gate GREEN (143/143 suites · 1745/1745 tests) after every batch.

## What shipped, by theme

### Honesty (the app's own doctrine, enforced)
- **Streak system** (home/progress/notifications): passive 🔥 pill → grace-calibrated tiers (amber AT RISK only when grace is spent · blue COVERED · green SECURED), ribbon with routed CTA, notification mirror; locked-window fallback never promises an unavailable log.
- **Offline never reads as empty/negative:** trainer book ("No clients yet" during outage → "Can't reach your clients"), coach stat tiles (fabricated green-0/red-0 → em-dashes), connect ("code didn't match" while offline → honest connection message). Root cause: supabase-js resolves network failures into `{error}` without throwing — fixed with the settled `{error:true}` sentinel in fetchMyTeams/fetchMyPractices.
- **Frozen copy → derived state:** weight "(late)" claim (was unconditional, now exec-window-derived), trust "Next check: day 5" (now day-band derived), trust decay chart YOU dot (was an invisible r="0" circle).
- **Deceptive interactivity killed:** weekly check-in preview chips (lit up + discarded taps → honestly inert), coachVoice On/Off toggle (persisted nothing, defaulted On → Preview pill), "Phrases it learned from you · In use" (fabricated → "will reinforce · Example"), quiet-hours "set your preference here now" (→ "preview, doesn't save yet").

### Failure paths (the moments that break trust)
- meal analyzing: real error state — scanline stops, honest copy, 48px Retake button (was a 13px gray text tap under a still-animating scan); fixed a race where fast failures were overwritten by the phase timer.
- camera capture failure: recovery link routed to the Action Hub loop AND was a dead tap (router wires data-go at render only) — now routes to food-search with its own wiring.
- profile avatar: corrupt file was a silent no-op, success was a full app reboot — now inline error + in-place repaint + busy guard.
- requirement unknown-id: bare "Nothing here" → full empty state with Plan CTA.
- reset password: post-send button was permanently disabled while Enter silently re-fired — now "Send again" + guard.
- guardian pending: couldn't remind the same parent — now prefilled email + "Send reminder" + inline confirmation.
- parent root: total dead end (no tabs, no exit) → sign-out row.
- foodsearch: dead "Clear" link wired (3rd instance of the render-time-wiring bug class).

### Accessibility floor (44px + names)
- 44px: recovery chips (42), plan sub-tabs (~39), foodsearch steppers (~21, unstyled), .ob-back (34), ob text-links (~18–32, new shared .ob-textlink), .seg buttons (38), pw-eye (~16), profile camera badge (22) + Edit (40).
- Semantics: recovery chips role=radiogroup/radio + live aria-checked; 6 auth inputs gain accessible names; connect + notifications error/alert regions; pw-eye keyboard-operable with aria-pressed; notification pills say URGENT/REMINDER/NICE WORK instead of raw enums (colour-independent).

### Meaning & flow
- breakdown hero ring gains the tier chip; progress leads with the live grace-aware streak; Action Hub gains the sync/consent honesty row (mirror of Home's syncBanner); notification rows show chevrons.

## Bug classes discovered (now documented for future passes)
1. **Render-time wiring:** router wires [data-go]/[data-act] once per render — anything injected during mount() is a dead tap unless self-wired (found 3×: camera note, foodsearch Clear, + prevented in new builds).
2. **supabase-js never throws on network failure** — catch-based offline detection is dead code; use the `{error:true}` sentinel.
3. **CSS scoping traps:** `.wb2` needs `.water-btns`, `.chp` needs `.chip-row` — bare classes silently get nothing.
4. **Frozen copy** asserting state ("late", "day 5", "streak reset") — always derive.
5. **Deceptive toggles:** data-toggle-group + wireToggles animates but persists nothing — never wire a control that leads nowhere.

## Not shipped (founder-gated / out of scope)
- `practice_identity()` RPC proposal (carried; needs migration — author-only).
- joinByCode conflates network-error vs wrong-code at the logic layer (presentation mitigated; root fix touches join logic).
- bio-optin enable swallows keychain failures then navigates as success (logic-touch — flag for design).
- Athlete-side practice-link persistence (connect success state is one-shot for practice joins — data layer).
- `S.weightLine` "streak reset" copy is boolean-driven not time-aware (breakdown sidebox; getter change).
- Full pass-2 backlog in `.fable5/coverage.md` (hierarchy/dedup/copy refinements per screen).

## Founder actions
- **Integrate:** `git merge fable5/2026-07-11-screen-by-screen-frontend-improvement` from master (or cherry-pick batches by tag).
- **Discard:** delete the branch; master never moved.
- Evidence: `.fable5/shots/` (before/after at 390px), per-change QA notes in `.fable5/coverage.md`.
