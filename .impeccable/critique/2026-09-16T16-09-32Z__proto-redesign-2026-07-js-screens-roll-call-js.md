---
target: roll call alarm feature
total_score: 25
p0_count: 4
p1_count: 4
timestamp: 2026-09-16T16-09-32Z
slug: proto-redesign-2026-07-js-screens-roll-call-js
---
# Roll-call alarm critique (2026-09-16)

Target: the Wake-Up Roll Call alarm, athlete and coach sides (proto roll-call.js, wake-alarms.js, wakeup-handoff.js, wakeup-squad.js, coach-wakeup.js, coach-commitments.js wakeupBoard; RollCallAlarm.swift, RollCallWidget.swift, RollCallAlarmActivity.kt; commitment-reminders and commitment-escalation).

## Design Health Score (before fixes)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Alarm armed/denied state unreachable for athletes; Home slot did not flip at 6:00 while open |
| 2 | Match System / Real World | 3 | Live Activity button hardcoded "I'M UP" instead of the coach's words; "iPhone 26.1" |
| 3 | User Control and Freedom | 2 | Android snooze silently costs points; iOS stop counts as up |
| 4 | Consistency and Standards | 1 | Late = red on Home, amber on detail; CTA green on detail, blue elsewhere; four verdict nouns |
| 5 | Error Prevention | 2 | Snooze past grace; skipped/cancelled instance could stay armed; two dated mornings collapsed |
| 6 | Recognition Rather Than Recall | 3 | Window drawn as three cells; live phone preview |
| 7 | Flexibility and Efficiency | 3 | One tap from the lock screen; stopIntent catches the obvious button |
| 8 | Aesthetic and Minimalist Design | 3 | Morning appeared twice on Home; "coach can see this" four times |
| 9 | Error Recovery | 3 | Save-failed note, offline card with retry; offline ack showed as settled |
| 10 | Help and Documentation | 3 | "How roll call works" is right; the alarm's explanation lived on an unreachable screen |
| **Total** | | **25/40** | **Acceptable, with two P0s** |

## Anti-Patterns Verdict

Not AI slop. Detector: 0 findings across the five roll-call screens. LLM review: the coach's words own the card, the verdict leads, the composer shows instead of narrates. Slips: teal wash on the squad hero (score-only sweep), Archivo on non-score numerals, blue-to-teal sweep on the Android alarm button.

## Priority Issues

- [P0] Athlete never told the phone will ring, never asked in-app, never told when it will not. FIXED: alarm line on the detail screen.
- [P0] Lock-screen card never reaches missed. FIXED: 0239 close sweep + escalation end push; initial card counts down.
- [P0] Already on the phone at 6:00: nothing happened in-app. FIXED: js/wake-face.js in-app alarm face.
- [P0] Two dated mornings collapsed into one alarm; only tomorrow ever armed. FIXED: fixed-date schedule + 7-day horizon (native build owed).
- [P1] Late-but-answerable red on Home, amber on detail. FIXED: amber card, blue CTA.
- [P1] One vocabulary: Live Activity button wears the coach's label. FIXED (build owed).
- [P1] Android snooze cost hidden. FIXED: label says counts as late.
- [P1] Triple alert at 6:00 where a real alarm is armed. FIXED: silent opening push.
- [P2] Offline answer rendered settled. FIXED: Sending row.
- [P2] Morning appeared twice on Home. FIXED: receipt is the door, card yields.
- [P2] Coach nudge told a late athlete they missed. FIXED.

## Persona Red Flags

Athlete at 5:58 (half asleep): three surfaces said I'M UP at once; the alarm's hidden costs (snooze = late, stop = up). Coach at 6:10: "accounted for" needs decoding; nudge copy wrong for late rows. Parent: consent asymmetry, the alarm permission asked by a random Home paint.

## Open founder calls

Apple's slide-to-stop counts as up. The 10-minute claim_missed window. Android has no close push.
