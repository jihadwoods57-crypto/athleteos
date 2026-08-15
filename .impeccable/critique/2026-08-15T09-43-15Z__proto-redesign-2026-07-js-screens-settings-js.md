---
target: the settings page for all roles
total_score: 27
p0_count: 0
p1_count: 3
timestamp: 2026-08-15T09-43-15Z
slug: proto-redesign-2026-07-js-screens-settings-js
---
# Critique: the settings page, all roles

Target: proto/redesign-2026-07/js/screens/settings.js (plus entry hubs in profile.js, roles.js, coach.js parent hub). Assessed 2026-08-15 via independent LLM design review (20 headless screenshots, all four roles, dark + light) and deterministic detection (CLI + injected browser detector + mechanical grep).

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Coach notif On/Off segs (settings.js:710-720) and athlete Haptics seg (:598-603) save the pref but never repaint; preset chips show no selected state |
| 2 | Match System / Real World | 3 | Coach billing free-state shows consumer copy ("membership adds the written coaching") above an operator CTA (settings.js:402) |
| 3 | User Control and Freedom | 3 | Escape hatches everywhere, but no post-delete undo and every parent exit lands on the athlete Profile |
| 4 | Consistency and Standards | 2 | One screen, two names ("Units & appearance" vs "Appearance & preferences"); delete icon is trash in privacy, x elsewhere; coach avatar wears warning-amber (roles.js:1101) |
| 5 | Error Prevention | 2 | Delete confirm is a second tap on the same pixel; no subscription check or mention before delete; sign-out is one unconfirmed tap |
| 6 | Recognition Rather Than Recall | 3 | Delete screen references the export feature two screens away as untappable prose |
| 7 | Flexibility and Efficiency | 2 | Coach presets are a real accelerator, but chips are non-focusable spans; several data-go rows unreachable by keyboard |
| 8 | Aesthetic and Minimalist Design | 3 | Calm and disciplined; trainer hub is a ~1,900px wall; wrapped "9:00 PM" chip collides with the Overdue digest card at 390px |
| 9 | Error Recovery | 4 | Best dimension: billing errorState + retry; delete failure copy is exactly honest; export failure inline |
| 10 | Help and Documentation | 3 | Replay tour in settings, sidebox explainers, plain-language terms summary, feedback + support present |
| **Total** | | **27/40** | **Acceptable: strong athlete path, role-parity and feedback debt** |

## Anti-Patterns Verdict

Not AI slop. The row grammar (lrow/lic/lt/ls) is one disciplined anatomy across all roles, grouping is real IA, and the microcopy is unmistakably human ("Permanent. We mean it.", "Idle seats are free"). The honesty engineering (billing renders "Couldn't check your plan" instead of lying "Free") exceeds most best-in-class apps. The trust cracks are interactional, not visual: toggles that visibly do nothing, wrong-persona copy at the delete moment, read-only facts dressed as controls.

Deterministic scan: CLI clean on all three target files (exit 0). Injected browser detector on 4 rendered settings screens found 6 distinct rules; after filtering the ignore list and false positives, what stands: text-occlusion on the "High" status pill (notif-settings, 50% covered), all-caps eyebrow labels running 40-51 chars, monotonous 4px spacing on privacy (75% of gaps). Confirmed false positives: page-level gradient-text (detector matches CSS comments documenting removed gradients; zero elements compute it), layout-transition (documented keyboard mechanic), blue glows (documented CTA/selected-chip lift), green FAB glow (shell chrome, not settings). Grep supplement: 15 raw-px inline font-sizes in settings.js + 4 in profile.js (roles.js fully tokenized), ~25 user-facing em-dash lines in settings.js against the DESIGN.md ban, 4 role="button" elements without tabindex.

## Priority Issues

**[P1] The parent role is locked out of the entire settings cluster**
The parent hub (coach.js:3202-3234) links Link/Fund/Funded/Sign out only: no appearance, notifications, privacy, terms, data export, or delete-account entry, even though roleNav() admits parents to those screens (state.js:352-359). roleProfileRoute() (state.js:379-381) has no parent branch, so every Done/back/Keep-my-account exits a parent onto the athlete Profile. A paying persona cannot reach terms or account deletion; Apple's in-app-deletion rule is satisfied on existence, not reachability. Fix: an Account card on the parent hub + a 'parent' branch in roleProfileRoute().

**[P1] Delete Account is role-blind and silent about money**
deleteAccount.render() (settings.js:788-799) shows every role athlete copy ("every meal photo... your spot on your team's Squad board"). Nothing checks isPaid/BILL: deleting does not cancel IAP or the Stripe team plan and the screen never says so; that is a refund-dispute generator. Fix: branch the consequences body on RT.authRole (trainer variant must state what happens to funded clients), and when paid, add one line + link to the store/portal above the delete button (storeSubUrl()/openBillingPortal are already in this file).

**[P1] Controls that save but never repaint**
seg2() in coachNotifSettings (settings.js:710-720) and the athlete Haptics seg (:598-603) write the pref without toggling the on class; the correct seg() helper sits two screens over (:605-614). Preset chips (:643-647) never paint a selected state. The detector independently caught the "High" urgency pill 50% occluded by overlapping text at 390px. Taps that visibly do nothing read as broken, the strongest trust-killer in the cluster. Fix: toggle classes in seg2 (or re-render), paint the matching preset chip, fix the pill overlap.

**[P2] Keyboard and screen-reader reachability**
#bill-manage and both #bill-restore rows (settings.js:476, 481, 496) and the role-card template (roles.js:92) are role="button" without tabindex (the router's Space/Enter activator cannot reach them). Chips are non-focusable spans; segs are real buttons but carry no aria-pressed; the theme picker and preset groups miss the data-toggle-group wiring that grants role=radio elsewhere. Fix: tabindex="0" on the four rows, focusability + aria on chips/segs.

**[P2] Split identity and copy debt**
The same screen is "Units & appearance" to athletes and "Appearance & preferences" to operators, whose entry subtitle promises "reminders" that deliberately live elsewhere (roles.js:1234, 1605 vs settings.js:110-112). Read-only facts ("lb", "12-hour") wear actionable blue status-pill b styling instead of the muted provenance pill DESIGN.md prescribes, inviting dead taps. ~25 user-facing em-dash lines violate the DESIGN.md ban (settings.js:265, 488, 551, 590 among them). Delete iconography differs per screen. Fix: one name, honest subtitle, muted pills, an em-dash sweep, one delete icon.

## Cognitive Load

3 of 8 failed (moderate): chunking (athlete Accountability group = 6 rows directly above a comment bragging about <=4 chunking; trainer Practice settings = 6 + Account = 5 unbroken; coach Manage = 7), working memory (export referenced two screens away, per-role vocabulary re-mapping), progressive disclosure for the trainer only (the coach got the T-19 sectioned menu; the trainer still has the wall the coach refactor's own comment calls a defect, roles.js:1312 vs 1577-1624).

## Persona Red Flags

**Sam (screen reader / keyboard-only)**: Cannot reach Manage billing or Restore purchases at all (role="button", no tabindex). Chip radiogroups (theme, quiet hours, presets) are spans: invisible to Tab. Seg state changes are announced nowhere (no aria-pressed), and on the coach screen they do not even change visually. Verdict: cannot complete billing or notification setup without touch.

**Riley (stress tester)**: Taps Coach notifications Off, UI says On; the pref saved, so the UI and the truth now disagree, the exact "appears to work but silently fails" flag. Finds the promised "reminders" absent on the operator appearance screen. Taps the blue "lb" pill expecting a unit switcher; nothing. Wraps quiet-hours to 9:00 PM at 390px and watches the chip collide with the digest card.

**Devon (funding parent, from PRODUCT.md)**: Moves real money through Fund plan, then goes looking for the terms they agreed to, a data export, or account deletion: none reachable from their hub. Deep-linked into terms during onboarding, exits onto an athlete Profile screen that is not theirs. Served as a wallet with a scoreboard.

## What's Working

1. Honesty engineering as UX: BILL.failed renders "Couldn't check your plan" + retry instead of a fabricated "Free"; sponsored premium says "Nothing to pay here" instead of an upsell; the trainer invite card has four real states.
2. Delete Account's emotional arc is structurally right: consequences, reassurance + export prompt, friction, prominent escape. The shape is correct; the details (role copy, subscription) need the fixes above.
3. One row anatomy across every role, so learning transfers; coach quick-setup presets are a genuine expert accelerator.

## Minor Observations

- Delete button label drift: starts "Delete my account", resets to "Delete account" after a failure (settings.js:801 vs :820).
- Privacy's "No one is connected" card is hand-rolled, skips the emptyState primitive, and carries no direct Connect action.
- Sign out is a single unconfirmed tap one row above Delete account.
- Deep-linking #settings can leave the Home tab lit under a Profile-tab screen (router.js:278-280).
- Urgency rows are a hardcoded literal (settings.js:583) presented as "set by {coach}".
- Coach identity avatar wears amber, the hue reserved for warnings; the athlete-side view of a coach was already fixed for exactly this (profile.js:61-64) but cpIdCard (roles.js:1101) was not.
- Light theme mirrors cleanly on every shot taken; no hue freezes in this cluster.
- 19 raw-px inline font-sizes (settings.js + profile.js) are type-scale ratchet debt; roles.js is fully tokenized.

## Questions to Consider

1. The coach's settings wall was refactored into sections with a comment calling the wall a defect; the trainer still lives in it. Second-tier persona by intent, or a missing sibling ticket?
2. Delete-account is guarded by tapping the same pixel twice. Should the arm-state at least relocate the confirm away from the original hit point?
3. If Apple review walks the parent role, does in-app account deletion pass on reachability?
