# Design — Monthly Report honest locked state
Prototype: https://claude.ai/code/artifact/db75a3cb-7d84-49ea-9bf8-e5c46f3b7fa1
Target file: proto/redesign-2026-07/js/screens/monthly-report.js (upgradeCard, lines 114-121)
Register: product (app UI paywall). Existing OnStandard proto design system honored — tokens.css, no new tokens.

## Problem (from audit)
upgradeCard() renders a dead-end: lock icon + "Premium report" + "Upgrade to unlock your monthly report." with
NO button/link/route. Every free athlete reaches it via the ungated Progress row (progress.js:138), waits through
"Building your report…", and hits a wall. Real month stats computed in load() are discarded.

## Design principle
Honesty over pressure (settled in memory). Hand over what the athlete earned; lock only what is genuinely premium.
The signature element is the FROSTED "Coach's take" — a section that shows real skeleton content under a purposeful
blur (blur = gated content, not decoration) with a lock chip. Everything else stays quiet.

## Screen composition (locked state), top -> bottom
1. backHead('Monthly report', monthLabel(period), 'progress')  — unchanged.
2. Hero card (.card.pad): reuse .bigstat — REAL avgScore in blue->teal (signature), "Average daily score" label,
   herometa "June 2026 · 21 days logged" (byte-identical to reportBody line 132), plus a small green "Your month,
   already counted" honesty cue (green = status only, per signature memory).
3. .base-stats grid — the EXACT block reportBody uses (lines 136-141): Best day / Worst day / Weight change /
   Best streak, from the client-side buildMonthPayload(days, period) already computed in load().
4. eyebrow "Coach's take" + locked card: skeleton bars (NOT fabricated prose — honest placeholder) under a frosted
   veil; blue lock chip "Premium"; heading "A written read on your <Month>"; one honest line describing the value
   ("Your three biggest wins, one focus for next month, and a coach's-voice summary"). This is the ONE honest lock.
5. eyebrow "Unlock the full report" + card:
   - PRIMARY green .btn "Start free trial" (mirrors ob2 "Start free"); fine print "Individual — free for 7 days,
     then $10.50/mo billed annually. No card today." Price is display-only from ob2 PLANS.individual[0].annualPer.
   - "or unlock now" divider.
   - Blue-tinted tappable coderow "Have a sponsor code? / Redeem it to unlock premium instantly" -> data-go
     "redeem-code" (already registered, index.js:145). The one in-app path that unlocks premium today.
6. Honest footnote: "Your stats are always yours. Premium adds the written coaching, not the numbers."

## Funnel events (existing vocabulary, analytics.js)
- track(EVENTS.PAYWALL_VIEWED, { variant:'monthly_locked', cadence:'annual' }) in mount() when the locked state is
  shown (exposure — fire on view or conversion math undercounts).
- track(EVENTS.TRIAL_STARTED, { plan:'individual', cadence:'annual' }) on the Start-free-trial CTA (intent only;
  billing go-live gated — same pattern ob2-athlete.js:501 uses).
- Both event names/props already validated by the redactProps enum firewall.

## Progress teaser row (progress.js:138)
Add a small blue Premium pill (lock glyph + "Premium") into the .tt of the monthly-report sidebox so the row is
honest before the tap. Blue-surface tint (premium/score identity), never green (green stays status-only).

## States
- loading: existing bolt spinner "Building your report…" (unchanged).
- locked (primary): real stats + frosted narrative + two unlock paths.
- unlocked: existing reportBody() — frost lifts to full take/wins/focus. Unchanged.
- empty (0 logged days): stats render "—"; veil copy explains nothing to summarize yet.
- error: stats still render from local payload; take shows retry, never a dead wall.

## Build notes / guardrails
- Presentation + routing only. No schema, billing keys, RLS, or test weakening.
- Reuse .bigstat / .base-stats / .card / .eyebrow / .sidebox / .btn.green / .req-icon exactly (no new tokens).
- New CSS is scoped: .mr-locked veil + .mr-coderow + a .pill for the teaser badge. Verify selector specificity
  against existing .card / .sidebox (screens.css) so paddings don't cancel.
- The frosted skeleton uses backdrop-filter; provide a solid-gradient fallback (already gradient-backed) so it
  degrades to an opaque veil where backdrop-filter is unsupported. Respect prefers-reduced-motion (no animated skel).
- Router self-wire: the trial button + code row are injected by render(); wire their clicks in mount() (settled
  router rule — mount()-injected elements self-wire).
- a11y: lock chip + coderow get aria-labels; coderow is a real focusable control (role/button semantics), 44px+.
