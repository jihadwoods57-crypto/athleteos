---
target: coach/trainer ui/ux experience
total_score: 27
p0_count: 0
p1_count: 3
timestamp: 2026-08-09T01-36-09Z
slug: proto-redesign-2026-07-js-screens-coach-home-js
---
# Critique: coach/trainer experience (proto/redesign-2026-07)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | coach-home offline says "reopen to retry" with no retry button (coach-home.js:415) while roster gets a real retryId |
| 2 | Match System / Real World | 3 | Dev jargon leaks into UI: "athlete_profiles.targets via the coach_set_goals RPC" (coach.js:582) |
| 3 | User Control and Freedom | 2 | One-tap irreversible deletes: rooms, groups, notes; no undo on nudge; only the Stripe refund confirms |
| 4 | Consistency and Standards | 2 | coach.js:32 re-inlines a private scoreColor (80/60, no 90 tier) against the score-band ban; window.confirm/alert only in trainer-grow.js; three offline-state shapes |
| 5 | Error Prevention | 2 | Strong write-gating, but destructive actions have zero guardrails and nudge fires unseen copy instantly |
| 6 | Recognition Rather Than Recall | 3 | Blind 4-state sort cycler (coach-roster.js:294); S/G/I pill explained only by hover title on touch |
| 7 | Flexibility and Efficiency | 3 | Real bulk ops, but bulk Assign silently discards the selection (coach-roster.js:333) |
| 8 | Aesthetic and Minimalist Design | 3 | coach-athlete: 8 section chips + 4 action buttons; "Score today" tile repeats in 3 of 8 sections |
| 9 | Error Recovery | 3 | Coach side is honest and preserves work; trainer side fabricates emptiness on failure |
| 10 | Help and Documentation | 3 | Tour, teaching sideboxes, setup checklist; no searchable help but strong contextual coverage |
| **Total** | | **27/40** | **Acceptable: solid foundation, real gaps before "seamless"** |

## Anti-Patterns Verdict

Does this look AI-generated? **No.** The coach hub actively polices its own anti-patterns (gradient-text stripped from the pulse hero with the anti-reference cited by name; side-stripes banned in a coach.css comment; amber alarm-boxes replaced with numbered blue steps). A Linear/Stripe-fluent user would trust coach-home. Trust erodes in the trainer wing: trainer-grow.js ships an inline style block, window.confirm/alert dialogs, and a seven-section mega-scroll that reads like an older product bolted onto a polished one.

Deterministic scan: 14 CLI findings, ALL matched the ignore list (documented brand font, --sh-blue glow, canvas halo, typing-dot pulse, semantic hatching, src-less hydrated images). The grep sweep surfaced the real coach/trainer items: window.confirm + alert in trainer-grow.js:338-341; an emoji button label "AI draft a reply" in coach.js:2632; 0 uses of permissionState across all 11 coach/trainer screens; 4 screens (coach-commitments, coach-connected, trainer-grow, my-trainer-offers) referencing none of the four state primitives; raw font-size debt heaviest in coach.js (61), screens.css (232), coach.css (54); hardcoded hues in inline gradients (coach-home.js:67,231,242 pairing var(--blue-bright) with raw #2563eb, the exact pairing DESIGN.md warns inverts on light theme).

Browser overlay: skipped; the proto needs a served, role-seeded session and this run was code-first.

## Overall Impression

The coach experience is genuinely good where the product's promise lives: pulse then ranked priority queue, honest tier labels, an operator vocabulary layer that makes trainer parity real. The single biggest opportunity is that everything trainer-ONLY (Grow, offers, payments) lives outside the design system, with browser dialogs and fabricated-empty error handling, on the screens showing the trainer's actual income.

## What's Working

1. **The priority queue** (priority.js, coach-home.js:372-399): ranked, honestly labeled ("Needs review" not a contradictory "Below standard"), primary action swaps per tier, nudge bodies match the tier so the message never accuses a current athlete.
2. **The operator vocabulary layer** (coach-home.js:22-35): every noun resolves through VOCAB so a trainer never reads "team"; first-paint race handled via RT.authRole.
3. **State discipline on the coach side**: offline checked before loading so a cold offline coach never sees a permanent skeleton (coach-roster.js:225-227); empty states carry direct actions.

## Priority Issues

1. **[P1] Trainer money surfaces fabricate emptiness on network failure.** roles.js:1328-1401 `catch { return [] }`; an offline trainer sees "No payments yet.", an offline athlete "Your trainer hasn't published any paid packages" (my-trainer-offers.js:53, trainer-grow.js:185). Violates DESIGN.md's own law ("never fabricated data") on the screens with dollars on them. Detector corroborates: these screens use zero state primitives. Fix: return a distinguishable failure (the {error:true} pattern already exists at roles.js:1308) and render errorState with retry. Command: harden.
2. **[P1] Bulk Assign silently discards the selection** (coach-roster.js:333, comment admits multi-target isn't built). Fix: disable with a "one at a time for now" hint or pre-fill first selected athlete. Command: harden or clarify.
3. **[P1] One-tap destructive deletes, no confirm, no undo**: room delete (coach-rooms.js:71), group delete (coach-roster.js:118), note delete (coach.js:2313). Room delete also strands its scoped standard. The scariest coach action has the least friction in the app. Fix: two-tap inline confirm (existing inline-status pattern, no modal) + undo window. Command: harden.
4. **[P2] The nudge message is invisible and unowned.** Fixed copy sent under the coach's name to a teenager, no preview/edit/undo (coach-home.js:613-616); detail-screen nudge can hit an on-standard athlete. Fix: show the body before send, editable one-liner; disable nudge when on standard. Command: clarify + harden.
5. **[P2] Consistency debt in the shared layer**: private scoreColor re-inline (coach.js:32); three offline-state shapes; hardcoded #2563eb / #22D3EE / #7e22ce in inline gradients (coach-home.js, coach-directory.js:77, coach.js:2659); text glyphs (✓ ＋ › ▾, plus the ✍️ emoji at coach.js:2632) where the system mandates icons.js SVG; trainer-grow.js per-screen style block and bare "Loading…" instead of skeletonRows. Command: polish.
6. **[P2] coach-athlete section sprawl**: 12 visible options at the top decision point; "Score today" tile rendered in three sections (coach.js:1803,1866,1901). Fix: merge Score into Overview, fold Today's open slots in; chip row drops to 5. Command: distill.

## Cognitive Load

3 of 8 checklist failures (moderate): minimal-choices (12 options atop coach-athlete; 10+ roster filter chips), one-thing-at-a-time (up to 30 tap targets across the priority queue's 6 cards x 5 actions), single-focus (two async board slots + setup collapse render above the priority queue on the screen whose job is "who needs attention").

## Persona Red Flags

**Alex (power user)**: bulk Assign is a decoy; blind sort cycler forces cycling all four modes; no per-row quick-nudge on the roster.

**Sam (screen reader)**: roster rows are genuinely good (role/tabindex/aria-labels with score), but assign-flow chips, room chips, and scope chips are bare spans with click handlers, no tabindex, no role (coach.js:62, coach-rooms.js:100): the core workflows are click-only. Pulse standing bar has no role="img"/label despite segBar existing for exactly this (components.js:67). Sparklines have no text equivalent.

**Coach Dale, 55, phone between drills (project persona)**: the priority reasons he came for are 12.5px/11px text, the size he can least read in sunlight; "Handled" is system vocabulary (its meaning explained only in the empty-queue copy); the sort cycler and S/G/I pill are recall traps. What saves him: the numbered setup checklist, QR invite card, plain-sentence priority reasons.

## Minor Observations

- Raw font-size ratchet debt is heaviest exactly here: coach.js 61 declarations, the largest file under the ratchet.
- coach-insights.js:254 "Computed from your roster's real logs, nothing here is generated" is an excellent trust line; borrow it elsewhere.
- coach-home wires empty-state Copy/Share handlers on every render even when the populated board shows.
- permissionState: zero references across all 11 coach/trainer files; role-denial states are either absent or bespoke.
- Microcopy is consistently strong ("Get it in.", "Only you hand it out"); "command center" (coach-home.js:294) is the closest thing to hype.

## Questions to Consider

1. If the priority queue is the answer to "who needs attention," why do two board slots and a setup checklist render above it?
2. Would a trainer paying for this product trust the Grow screens, with browser dialogs and fabricated-empty errors, with their Stripe account?
3. Nudges are the coach's primary lever and ship words the coach never sees. Should Coach Voice v2 (already capturing the coach's voice for meal analysis) write the nudge?
