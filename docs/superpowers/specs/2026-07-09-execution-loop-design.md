# Execution Loop — Design (Home · Action Hub · State-Driven Notifications)

**Date:** 2026-07-09
**Status:** Implemented 2026-07-09 (plan docs/superpowers/plans/2026-07-09-execution-loop.md); notification learning deferred.
**Surface:** `proto/redesign-2026-07/` (the live WebView app) + native bridge/notification additions in `src/`
**Sub-project 2 of the 2026-07-09 product feedback dump.** Predecessor: onboarding overhaul (merged, `91eb861`). Remaining later: AI meal logging experience, Plan page.

## 1. Goals

Make daily execution feel like a personal AI accountability coach, not a checklist:

1. Home leads with the single most important action (NOW card with live countdown), organized Now → Next → Later → Done, with status-driven color.
2. The center-camera Action Hub becomes a context-aware execution dashboard that always answers "what is the single most important thing right now?"
3. Notifications become fully state-driven: only for incomplete tasks, auto-cancelled the moment a task completes, promoting the next task, in the coach voice — never redundant.
4. Completing a task promotes the next one live (no refresh); finishing the day flips Home into a celebration state.
5. Every state also reads through text + icon (never color alone).

## 2. Decisions (locked with founder, 2026-07-09)

| Question | Decision |
|---|---|
| Notification scope | **Mechanics now, learning later.** Full state-driven scheduling/cancelling this cycle; per-athlete behavior-learning (adaptive timing) is a future spec once real completion data exists. |
| Home hero | **Execution-first + celebration flip.** Compact score strip on top; dominant NOW card owns the screen; when the day completes, the full animated ring returns as celebration hero. |
| Status color | **4-state mapping** on execution surfaces: gold = active/actionable, green = completed, gray/dim = upcoming/locked, red = overdue. Category identity lives in icon glyphs and labels only. Red now also means overdue (rhymes with the Off Standard tier). |
| Architecture | **New pure exec engine module** (`exec.js`) producing one `ExecState` consumed by Home, Action Hub, FAB badge, and the notification sync — surfaces can never disagree; fully unit-testable with a fake clock. |

## 3. The execution engine (`proto/redesign-2026-07/js/exec.js`)

Pure module (imports only `requirements.js` catalog helpers; no DOM, no state, no Date calls — the clock is an argument).

**Inputs** (one call, e.g. `deriveExec(input)`):
- `catalog` rows (from `CATALOG`) + coach-assigned runtime tasks
- completion resolver data: per-slot done/late/loggedAt, recovery submitted, weight logged, hydration oz, weekly submitted
- `nowMin` (minutes from midnight), `dow` (0–6), `dateISO`
- `pressure`: `'gentle' | 'accountable' | 'max'` — the caller maps the onboarding knob's stored display strings ("Remind me gently" → gentle, "Hold me accountable" → accountable, "Max pressure" → max; anything else → accountable)

**Per-requirement state machine** (`state` on each derived item):
`locked` (window.open in the future) → `ready` (open, > 90 min to due) → `due_soon` (≤ 90 min to due) → `overdue` (past due, not done — still loggable; late counts half per the existing engine) → `done` / `done_late`.
Each item carries: `state`, `color` (`gold` for ready/due_soon, `red` for overdue, `green` for done/done_late, `gray` for locked), `minsLeft` (null when no due ahead), `dueLabel`, `countdown` (formatted `H:MM` / `47 min`), `why` (impact label + coach note), `route`, `required`.

**Groups**: `now` (exactly one or null), `next` (one or null), `later[]`, `done[]`, `overdue[]` (required, past-due, incomplete — rendered above NOW). NOW selection priority: (1) earliest overdue required item, (2) nearest due_soon, (3) earliest ready required item, (4) earliest ready optional item. Hydration (optional) never becomes NOW while any required item is open. When nothing required remains, `now = null`.

**Day progress**: `met`, `total` (required items running today + assigned), `score`, `possible` (from the existing projections — read-only), `celebration` = every required item done.

**Notification plan**: `plan: [{ id, fireAtMin, title, body }]` — only incomplete items, only `fireAtMin > nowMin`, scaled by pressure:
- `gentle`: one nudge per item at due − 30
- `accountable` (default): due − 45 and at due
- `max`: at window open, due − 45, and at due
Copy is coach-voice, specific, never guilt-trip ("Dinner closes in 45. Photo proof keeps the 50%."). Weight reminders keep the trend-only, no-shame rule. When `celebration` is true the plan is empty plus one immediate celebration note (`fireAtMin: nowMin`, i.e. fires right away) — "Day locked at ⟨score⟩ — day ⟨N⟩ of your streak" — skipped on `gentle`.

**Tick**: a 30-second interval while Home or the Action Hub is mounted re-derives ExecState and re-renders only when the derived output changed (minute boundary/state transition). This produces live countdowns, automatic Ready → Due Soon → Overdue transitions, and live promotion of the next task after a completion (actions already re-render via the router; the tick covers pure time passage).

**Scoring is untouched** (DECISION-MEMO D3): exec reads day-state, never writes or reimplements score math; `possible` comes from the existing projection helpers.

## 4. Home redesign (`js/screens/home.js`)

Layout (top → bottom), per the approved mockup:
1. `appHead()` (unchanged).
2. **Score strip** — compact: small ring (static, no big animation), score, tier chip, streak flame, and the day's met/total segments (absorbed from the old Finish Today card). Taps to `score-breakdown`.
3. **Overdue pins** (when any): slim red rows above NOW — "Was due 2:00 PM · still counts, log it late".
4. **NOW card** — dominant: icon, title, `why` line, live countdown + deadline ("⏱ 47:12 · due 8:00 PM"), one large CTA (verb from `PROOF`), gold accent. Expandable (progressive disclosure) for the full coach note and per-item history. Day-0 variant: NOW = "Log First Meal".
5. **NEXT** — one slim row (title, window, gray→gold as it opens).
6. **LATER** — collapsed group (count + expand); optional items live here.
7. **DONE** — collapsed green group with logged-time stamps ("Breakfast · 8:14 AM ✓").
8. Trust Pass banner, injury banner, Recent Activity rail — kept as today.

**Removed as duplication**: the standalone next-action button block and the entire Finish Today card (score bridge → score strip; "next biggest move" → NOW card; "highest risk" → the notification plan's job).

**Celebration flip** (`celebration === true`): the score strip and NOW stack are replaced by the full animated ring hero ("You're OnStandard", streak line, +delta), a green "Today's record" list of everything logged, and optional actions (add water, tomorrow preview when tomorrow's catalog differs, e.g. weigh-in day). Entrance animation + success haptic via the bridge; `prefers-reduced-motion` degrades to a fade.

**Accessibility**: every state communicates via pill text + icon + position, not color alone; countdowns have `aria-live="off"` (no screen-reader spam) with the deadline in plain text.

## 5. Action Hub redesign (`js/screens/log.js`)

Still the center-FAB bottom sheet (`#log`), rebuilt as an execution dashboard reading the same ExecState:
1. **Progress header**: met/total segments, "3 of 5 in", score → possible.
2. **NOW hero row**: large gold row for the engine's NOW (countdown, score impact, CTA). Overdue variant in red.
3. **Quick Logs** group: Water (inline +8/+16 oz, count toward 120; collapses to a green "standard hit" line at goal) and Weight (trend-only copy; late logging framed as "still counts for your trend", never a penalty).
4. **Forms & Check-Ins** group: Recovery Check-In (purple icon identity, status-colored pill); **Weekly Check-In appears only on days it runs** (Sundays) instead of occupying space all week.
5. **Done collapse**: completed items fold into one green line ("3 in ✓ — view on Home") instead of individual rows.
6. **All-done state**: celebration panel — score, streak, "prepare for tomorrow", optional water — replacing the action list.

**Intelligent FAB** (in `router.js` tabbar): a small status dot rendered on the camera FAB — gold when anything is actionable, red when anything is overdue, absent when the day is complete. The camera glyph itself never changes. Driven by the same ExecState at render time.

## 6. State-driven notifications

**Bridge**: new message `{ type: 'NOTIFY_SYNC', plan: [{ id, atISO, title, body }] }` (fire-and-forget, like HAPTIC). The proto converts `fireAtMin` → absolute `atISO` for today. Native side (`src/lib/notify/execSync.ts` + a `bridge.ts` case): cancel all previously scheduled OnStandard-exec notifications (tracked by an identifier prefix), then schedule the new plan via `expo-notifications` date triggers. Permission is requested once via the existing notify module.

**Sync triggers**: app boot (after session restore), every completion action (`logMeal`, `submitRecovery`, `logWeight`, `addWater` reaching goal, weekly submit, assigned-task complete), pressure-setting change, and day rollover detected by the tick. Because completing a task rebuilds the plan without that task, **its pending reminders are cancelled in the same action** — the auto-cancel guarantee. No task complete = plan unchanged = no redundant churn (sync is skipped when the plan is deep-equal to the last posted plan).

**Retire the static path**: `initReminders()` (the legacy Zustand-driven daily schedule) stops scheduling for athlete sessions so the two systems can never double-fire; the notification-permission plumbing is reused.

**In-app feed**: `S.notifications` re-reads ExecState (overdue/now/next + celebration) so the bell, the Home surface, and OS notifications always agree.

**Deferred (future spec)**: behavior learning — shifting reminder times toward each athlete's observed completion habits; push (server-sent) reminders for coach-assigned tasks.

## 7. Edge cases

- **Day rollover while open**: engine output is keyed on `dateISO`; the tick detects date change → reload day state, full re-derive, NOTIFY_SYNC.
- **Offline**: local notifications need no network; day.js already queues server writes; ExecState derives from local state.
- **Late submissions**: `overdue → done_late`, "Logged late · still counts" (half-credit already in the scoring engine — presented, not re-implemented).
- **Duplicate submissions**: existing slot guards (`DAY.meals[slot]`) unchanged.
- **Coach modifications**: assigned tasks merge into groups via the existing `deriveAssigned`; new assignments enter the plan on next sync.
- **Weekly/weight day gating**: `runsToday` with the real `dow` (the frozen `NOW_MIN`/`TODAY_DOW` defaults in requirements.js remain only as defaults; every exec call passes real clock values).
- **Timezone**: device clock everywhere; no server time math.
- **WebView backgrounding**: scheduled notifications fire natively while the app is closed; on foreground the boot/tick resync corrects any drift.

## 8. Out of scope (explicit)

- Behavior-learning reminder adaptation; server push for coach-assigned tasks.
- Meal logging flow changes (sub-project C) and Plan page (sub-project D).
- Coach-side surfaces; scoring formula or day.js write-path changes.
- Skeleton loading states (proto renders synchronously from local state; the AI meal flow owns its own loading states in sub-project C).

## 9. Testing

- **exec.js unit suite** (fake clock, same pattern as `obHelpers.test.ts`): state boundaries (window open, due − 90, due, past due), NOW selection priority incl. optional-never-NOW and overdue-first, group membership, celebration flag, notification plan per pressure level (counts, times, only-future, only-incomplete), day-of-week gating (weekly Sunday, weight M/W/F), day-0 behavior, countdown formatting.
- **bridge.test.ts**: NOTIFY_SYNC case (schedules via the seam, cancel-then-schedule order, empty plan cancels all).
- **Parity**: the scoring parity suite must remain green and untouched.
- **Flow QA script**: countdown ticks on Home; logging promotes NEXT → NOW without refresh; overdue pin appears at the boundary; Action Hub reflects within the same render; FAB dot transitions; celebration flip + celebration notification; weekly hidden on non-Sundays; static reminders no longer scheduled for athletes.
