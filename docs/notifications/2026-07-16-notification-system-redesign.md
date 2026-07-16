# Notification System Audit + Redesign — 2026-07-16

## 1. How the current system works (as found in code)

The shipped app is the proto WebView (`app/index.tsx` → `src/proto/ProtoApp.tsx`).
Everything notification-related that actually runs in production:

### 1a. Athlete local reminders (the surface users complain about)
- `proto/redesign-2026-07/js/exec.js` — `deriveExec()` is the single pure engine for
  Home / Action Hub / FAB / notifications. It builds a `plan` of local reminders from the
  requirement catalog (`requirements.js` CATALOG or a coach-published standard), the day's
  completion status, and a `pressure` knob (`gentle | accountable | max`, set in onboarding
  step 6 and Settings).
- Plan slots (old design): gentle → one `soon` at due−30; accountable → `soon` at due−45 +
  `due` at the deadline for EVERY required item; max → additionally a `window open` ping.
  Copy came from a static `HOOK` map — the literal string `"Photo proof keeps the 50%."`
  for breakfast, lunch, AND dinner, `"20 seconds locks your Recovery 25%."` for recovery.
- `state.js act.syncNotifications()` posts the plan over the bridge (`NOTIFY_SYNC`) —
  idempotent per (date, plan). Triggered on Home mount, every completion (meal / weight /
  water / recovery / assigned), settings pressure change, `hydrateDay`, `startDay0`.
- `src/lib/notify/execSync.ts` — native seam: `cancelAllScheduledNotificationsAsync()` then
  schedule each future item as a one-shot date trigger. Exec is the ONLY scheduler.
- Deep links: each plan item carries `route`; taps land the WebView on the exact screen
  (`camera/dinner`, `weight`, `recovery`) via `ProtoApp`'s notification-response listener.

### 1b. In-app bell feed
`S.notifications` (state.js) is derived live from exec state: overdue rows, next-up,
unfinished coach assignments, injury adaptation, hydration-hit, celebration, streak-at-risk.
Coarse all-read model (`RT.notifsRead`).

### 1c. Server push (stakeholder → athlete)
- `send-push` edge function: coach/trainer nudge → `can_view` authz → insert a row into the
  `notifications` table → honor `profiles.notifications_opt_out` (0067) → Expo push to
  `device_tokens` (0028).
- `weekly-digest` edge function: cron; roster digest to coaches/trainers, honors opt-out.

### 1d. Dormant legacy (does NOT run in the shipped app)
`src/core/reminders.ts` + `src/store/useStore.ts syncReminders` + `src/lib/notify/index.ts
refreshReminderSchedule` — the old React-Native-screens reminder system. `src/screens` is a
logic donor only; nothing mounts it. `src/core/overseerAlerts.ts` is preference UI with no
delivery pipeline. Both kept for reference; neither schedules anything in production.

## 2. Problems found (product + technical root causes)

| # | Problem | Root cause |
|---|---------|-----------|
| P1 | Up to 10 pushes/day on default pressure (13 on max); separate "closes in 45" + "due now" for every meal | Accountable pressure scheduled TWO stages per required item, unconditionally; catalog `reminder` urgency (low/medium/high) was rendered in Settings but NEVER read by the engine |
| P2 | Literal duplicate weigh-in reminders | `copyFor()` ignored the stage for weight — the `soon` and `due` slots produced byte-identical title+body 45 minutes apart |
| P3 | Robotic repeated copy, "Photo proof keeps the 50%." three times a day | One static HOOK string per requirement id; no variation, no stage awareness, no type awareness (a coach-standard `meal-5` slot got empty copy) |
| P4 | Internal scoring formulas in copy ("the 50%", "Recovery 25%") | Copy exposed component weights instead of useful, accurate impact language |
| P5 | Notification clustering (Mon/Wed/Fri morning: weight-soon 8:15, breakfast-soon 8:45, weight-due 9:00, breakfast-due 9:30 = 4 pushes in 75 min) | No coalescing, no per-day cap, no minimum spacing |
| P6 | Stale reminders after sign-out / account switch / account deletion | `_wipeUserScopedState()` wiped local state but never posted an empty plan, so the previous user's scheduled device reminders kept firing |
| P7 | Quiet hours UI was a dead preview ("don't save yet"); recovery pings could land at 10:45 PM + 11:30 PM | No prefs model; nothing persisted; engine had no quiet-hours input |
| P8 | Recurring requirements go silent if the app isn't opened (all triggers are one-shot for today) | Plan was derived for today only; no tomorrow pre-schedule |
| P9 | Coach-assigned tasks with a real `due_at` never got a reminder | The plan loop iterated catalog items only; `assignedFromRow` dropped `due_at` |
| P10 | Coach nudge pushes go nowhere | The shipped app never registers a push token (`getPushToken` lives only in the dormant legacy store); `device_tokens` stays empty |
| P11 | Server `notifications` rows (nudges) never appear in the athlete's bell | The bell feed is locally derived; nothing reads the table (documented, not fixed here — needs a feed-merge design) |

Non-problems verified: no duplicate *scheduling* jobs (cancel-all-then-reschedule with unique
identifiers `exec-<id>-<atISO>`); completions cancel correctly in-app (every completion path
re-syncs); timezone is device-local at schedule time and self-heals on next app open;
notification permission denial makes scheduling a graceful no-op.

## 3. Redesigned hierarchy + behavior

New pure module **`proto/redesign-2026-07/js/notify-plan.js`** — a reusable framework that
generates the plan from structured context (requirement, window, state, stage, urgency,
pressure, prefs, coach name, score/streak, deep-link route). `exec.js` delegates plan
building to it; scheduling/cancelling seams are unchanged.

### Stages (only ones justified by product logic)
- **`open`** — window opened. Max pressure only, meals only. (Kept from old design.)
- **`soon`** — deadline approaching. The workhorse: one per required incomplete item
  (gentle due−30, otherwise due−45).
- **`due`** — at the deadline. Gentle: never. Accountable: only `reminder: 'high'`
  requirements (weight, recovery — the coach-set urgency finally does something).
  Max: all required items.
- **`celebrate`** — completion acknowledgment when every requirement is in (existing;
  once per day, skipped on gentle).
- **Stakeholder escalation** stays server-side (`send-push` one-nudge-a-day + weekly digest)
  — no new client stage.
- Deliberately NOT added: daily summary, overdue-recap pushes (overdue already leads the
  in-app feed + Home; more push volume is the disease, not the cure).

### Volume rules (the fixes for P1/P2/P5)
1. **Short-window collapse**: if an item earns both `soon` and `due` less than 60 min apart,
   keep only `due` — weight gets exactly ONE sharp 9:00 reminder, not two near-identical ones.
2. **Coalescing**: entries within 25 min merge into one combined notification
   ("Weigh-in + breakfast — both land by 9:30") at the earliest time, routed to the
   earliest-due item.
3. **Daily cap** after coalescing (a safety valve for stacked custom standards, not the
   shaper of a normal day): gentle/accountable 6, max 10; `due` outranks `soon` outranks
   `open`, earliest-due first within a rank. A standard 5-requirement day fits under every
   cap; gentle's low volume comes from being single-stage.

### Copy engine (P3/P4)
- Type-aware templates keyed on inferred requirement kind (photo→meal, scale→weigh,
  form+recovery→recovery, form+checkin→checkin, anything else→task) — new requirement types
  and coach-standard slots automatically get sane copy.
- 2–3 variants per (kind, stage), rotated deterministically by date+id hash — no identical
  sentence twice in a day, wording shifts day to day.
- Tone escalates with the stage (calm at `soon`, direct at `due`); never guilt.
- No internal formulas. Score impact stated only where accurate: nutrition/recovery items say
  the log "counts toward today's score"; weight stays trend-only; hydration (unscored focus)
  never claims points; coach presence used when a real coach is linked.

### Preferences (P7) — `RT.notifPrefs`
`{ enabled, quietFrom (min), quietTo (min), allowDeadline }`, default on / 10 PM–7 AM /
deadline-override on. Quiet hours shift `soon`/`open` entries to the quiet-window end (or drop
them if the deadline passes first); `due` entries survive quiet hours only while
"Deadline warnings" is on — exactly what the settings screen already promised. The
Notification Settings screen now persists all of it (no more "preview, doesn't save").
`enabled: false` → empty plan → cancel-all, and the client best-effort writes
`profiles.notifications_opt_out` so server pushes (digest/nudge) respect the same choice.

### Lifecycle correctness (P6/P8/P9/P10)
- Sign-out / account switch / delete now post an empty plan (cancel-all) before the wipe.
- Tomorrow pre-schedule: the sync derives tomorrow's plan (fresh status, tomorrow's dow) and
  schedules it alongside today's, so a day without an app-open still gets its reminders;
  next open replaces everything (bounded staleness: one day).
- Assigned tasks with a real same-day `due_at` get one `soon` reminder (due−60) deep-linking
  to `requirement/<id>`; completing the task re-syncs and cancels it.
- The bridge gains `PUSH_TOKEN`; after sign-in the proto registers the device token via the
  existing `register_device_token` RPC, so coach nudges actually deliver.

## 4. Assumptions needing founder validation
1. Default quiet hours 10 PM–7 AM with deadline-override ON (recovery's 11:30 PM `due` still
   fires). Adjustable in Settings, but the default is a product call.
2. Accountable-pressure caps at 6 notifications/day; typical day is ~4. If retention data
   says more pressure converts, raise via one constant.
3. Tomorrow-only pre-schedule (not N days): silence after 48h of not opening the app is
   treated as intentional (don't nag ghosts), and it bounds staleness after plan edits.
4. Weekly Check-In remains outside the reminder engine (its completion is untracked in v1 —
   same exclusion as before).
5. Server nudge rows still don't render in the athlete bell feed (P11) — needs a feed-merge
   design; deliberately out of scope here.
6. Legacy `src/core/reminders.ts` path left dormant (still referenced by dormant screens);
   recommend deleting with the src/screens retirement, not piecemeal.
