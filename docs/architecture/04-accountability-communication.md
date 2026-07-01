# 04 — Accountability Engine, Escalation, Communication, Notes, Achievements, Recovery Mode

> Target 10-year architecture for the **execution spine** of OnStandard — the layer that turns a
> coach's plan into daily execution, escalates honestly when it slips, lets the coach respond in
> structured one-tap moves, rewards real habits, and adjusts the plan when an athlete is hurt.
> Plus a non-destructive migration path from today's pure-`src/core` engines (which already
> exist and are tested) to a server-backed, event-sourced model. **Design only** — no app/TS
> code, no SQL migrations are shipped here. Authored 2026-06-29.
>
> Depends on doc `01` (org hierarchy, `org_memberships`, `can_view`) and doc `02`
> (`allowed(viewer, athlete, scope, action)`, `activity_log`, group scope). This doc owns the
> **accountability event stream** that the AI Copilot (doc `05`) consumes.

---

## 1. Summary

The accountability spine is the Constitution's #1 pillar ("the mission *is* execution"). Today
it lives almost entirely as **pure, deterministic, well-tested `src/core` engines** —
`adherence.ts` (meal windows + a 6-level `escalation()` + plan adherence), `attention.ts`
(needs-attention ranking), `reminders.ts` (conditional local reminders), `weeklyReport.ts`,
`nudge.ts` (overseer nudge + honest movement read), `overseerAlerts.ts` (per-event alert
prefs), `messaging.ts` (structured composer + minor gate), and `recovery.ts` (wearable signal
fold — **not** injury Recovery Mode). They run entirely on-device, inert behind
`isEnginesEnabled`/`isBackendLive`. The 10-year target keeps every one of these pure engines as
the **deterministic decision core** and adds the three things they cannot be alone: (1) a
**durable, append-only `accountability_events` ledger** so escalation has memory across days,
devices, and the coach's view; (2) an **escalation state machine** that is rate-limited,
deduped, quiet-hours-aware, and severity-gated so it never fatigues a user; and (3) a
**server delivery + structured-communication** layer that honors the minor-messaging gate
(migration `0006`). Notes, achievements, and Recovery Mode are net-new but each reduces to the
same pattern: athlete-owned data + a permission-scoped read + an event on the ledger. **The
single cross-cutting contract this doc exports: every behavioral signal worth acting on is one
immutable `accountability_event` row** — and that stream is the substrate the AI Copilot reads,
the escalation machine transitions on, and the weekly report aggregates. The AI **phrases and
prioritizes** over this stream; it never invents a signal or fires a notification the
deterministic core didn't authorize.

---

## 2. Reconciliation with today

| Tag | Element | Reality |
|---|---|---|
| **[ALREADY BUILT]** | Meal-window state machine (`upcoming→open→logged→missed`) + 6-level `escalation()` (clear→reminder→support→score→coach→report) | `src/core/adherence.ts`. This **is** the Escalation Engine's deterministic core. KEEP verbatim; it becomes the transition function over the new event ledger. |
| **[ALREADY BUILT]** | `planAdherence()` execution % (meals 50 / protein 30 / hydration 20), `planMealNote()` goal-aware coaching | `adherence.ts`. The "execution over perfection" math. Feeds the Development Score; unchanged. |
| **[ALREADY BUILT]** | Needs-attention ranking + `atRiskReason()` + `scoreLanguage()` bands | `src/core/attention.ts`. The coach-alert severity + reason engine. KEEP. |
| **[ALREADY BUILT]** | Conditional reminder model + athlete-first copy + `reminderNotifySpecs()` | `src/core/reminders.ts`. The "Reminder" leg of the escalation chain. The device seam (`src/lib/notify`) is the only missing piece. |
| **[ALREADY BUILT]** | Per-athlete + team weekly report generators | `src/core/weeklyReport.ts`. The "Weekly Report" leg. Generation is done; **delivery** is the gap. |
| **[ALREADY BUILT]** | Overseer nudge record + honest movement read (`nudgeOutcome`) | `src/core/nudge.ts`. The "Coach Follow-up" leg, day-scoped. EVOLVE to durable. |
| **[ALREADY BUILT]** | Per-event overseer alert preferences (`below_line / missed_logging / checkin_ready / weekly_digest`) | `src/core/overseerAlerts.ts`. The notification-fatigue **preference** layer. EVOLVE: add rate-limit/quiet-hours/severity to the *delivery* side. |
| **[ALREADY BUILT]** | Structured/compose messaging model + `MAX_MESSAGE_LEN` + delivery-honesty note | `src/core/messaging.ts`. The composer half of Communication. |
| **[ALREADY BUILT]** | Minor-messaging governance — pure `messagingAllowed()` + server RLS | `src/core/messaging.ts` + migration `0006_messaging_minor_gate.sql` (`messaging_authorized`, `is_minor` fail-closed). The legal spine of Communication. PRESERVE untouched. |
| **[ALREADY BUILT]** | `threads` / `messages` tables (athlete ⇄ counterpart, one thread per pair) | `0001_schema.sql`. The free-text vessel. EVOLVE: add structured-preset typing on top. |
| **[ALREADY BUILT]** | Wearable recovery fold (`blendRecovery`, sleep/HRV/RHR maps) | `src/core/recovery.ts`. NOTE: this is *recovery-signal-into-score*, **NOT** injury Recovery Mode. Keep; Recovery Mode is a different, net-new feature (§3.7). |
| **[ALREADY BUILT]** | `checkins` table (energy/recovery/sleep/soreness/...) | `0001`. Soreness is the seed signal Recovery Mode reads. |
| **[ALREADY BUILT]** | Engines master switch + backend gate | `src/lib/features.ts` (`isEnginesEnabled`, `isBackendLive`). The deferral mechanism for everything below. |
| **[EVOLVE]** | `escalation()` (stateless, today-only) → a stateful machine driven by the durable event ledger (multi-day memory, dedupe, cooldown) | The pure function stays the transition rule; persistence + rate-limiting wrap it. |
| **[EVOLVE]** | `nudge.ts` day-scoped record → durable `interventions` rows with a status lifecycle | "Suggested Intervention → Coach Follow-up" needs to survive rollover. |
| **[EVOLVE]** | `messages.text` free-text → `messages` carrying an optional `preset_key` + `payload` (structured-first, free-text later) | Structured presets are first-class; unrestricted chat is flag-gated v2. |
| **[NEW]** | `accountability_events` (append-only behavioral ledger) — the cross-cutting contract | The substrate for escalation memory, weekly aggregation, achievements, and the AI Copilot. |
| **[NEW]** | `notification_dispatch` (rate-limit / dedupe / quiet-hours / severity ledger) | The anti-fatigue layer; the one place that decides a signal becomes a *delivered* notification. |
| **[NEW]** | `notes` (coach / nutrition / **medical** / strength / journal) with per-category permission keys | Private Notes; medical is the most-restricted category. |
| **[NEW]** | `achievements` + `achievement_grants` (habit-grounded, derived from the event ledger) | Reward execution/consistency, never login badges. |
| **[NEW]** | `recovery_episodes` (injury workflow: plan-override + RTP stages + coach alert) | Recovery Mode. |
| **[NEW]** | `message_presets` catalog (Great Job / Protein Low / Hydrate / Complete Dinner / Needs Attention / Coach Recognition) | The structured-communication vocabulary; pure constant in `src/core`. |
| **[DON'T BUILD YET]** | Unrestricted real-time chat, typing indicators, read receipts, attachments, group threads | Constitution §8 explicitly defers messaging; ship structured presets + AI-draft only. The schema reserves `kind='free_text'` so v2 is a flag, not a migration. |
| **[DON'T BUILD YET]** | ML/behavioral-learning escalation thresholds, per-athlete adaptive quiet hours, predictive "about-to-miss" alerts | Correct 10-year target. Ship **deterministic** thresholds + fixed quiet hours first; the event ledger is exactly the training substrate for v3, so building it now is the right seam. |
| **[DON'T BUILD YET]** | Full clinical Recovery Mode (RTP protocols per injury type, PT integration, AT clinical notes workflow) | Ship a single generic injury episode (reduce calories/protein floor, hydrate, "cleared by" gate, coach alert). Per-injury protocols are a flagged expansion once a real AT customer exists. |
| **[DON'T BUILD YET]** | Cross-channel delivery (SMS/email/push fan-out with per-channel prefs) | Ship **push only** behind the existing notify seam; the `notification_dispatch` row already models channel so adding email later is data. |

---

## 3. The design

### 3.0 The organizing principle: one ledger, many readers

Everything in this slice is a **producer or consumer of one append-only stream**. Logging a
meal, missing a window, a coach tapping "Great Job," a score dropping a band, an injury being
logged, an achievement unlocking — each is an `accountability_event`. The deterministic
`src/core` engines decide *whether* an event matters and *what level* it is; the server decides
*whether it becomes a notification* (anti-fatigue); the AI Copilot (doc `05`) decides *how to
phrase and prioritize* it. **No reader invents a signal the ledger doesn't carry** — this is the
"never fake AI / fail honest" rule (Constitution Rule #8) expressed as an architecture.

```
                 PURE src/core (deterministic, tested, no RN/Supabase)
   meal log ─┐   adherence.escalation() · attention.needsAttention() · reminders ·
   checkin  ─┤→  weeklyReport · achievements.evaluate() · recovery.episode()
   injury   ─┘            │ emits typed signals
                          ▼
              ┌───────────────────────────┐
              │   accountability_events    │  (append-only, immutable, athlete-owned read)
              └───────────────────────────┘
                 │            │              │
        escalation SM   notification_     weekly aggregate / achievements / AI Copilot (doc 05)
        (transitions)   dispatch (gate)    (read-only consumers)
```

### 3.1 `accountability_events` — the cross-cutting contract

The one table every other reader keys off. Append-only and immutable (a `BEFORE UPDATE OR
DELETE` trigger raises, mirroring the scoring-history and `activity_log` immutability invariant
in doc `02 §3.5`). **Athlete-owned** (`athlete_id`, self-produced via RPC or sync), readable by
overseers only through `can_view(athlete)` (doc `01`/`02`).

```sql
event_type :=
  -- execution
  'meal_logged' | 'meal_window_missed' | 'protein_target_hit' | 'protein_target_missed'
  | 'hydration_hit' | 'hydration_missed' | 'day_completed' | 'checkin_submitted'
  -- score / accountability
  | 'score_band_changed' | 'escalation_raised' | 'streak_extended' | 'streak_broken'
  -- relationship
  | 'reminder_sent' | 'coach_message_sent' | 'recognition_sent'
  | 'intervention_suggested' | 'intervention_actioned'
  -- achievements / recovery
  | 'achievement_unlocked' | 'recovery_started' | 'recovery_plan_adjusted' | 'recovery_cleared'

create table accountability_events (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references profiles(id) on delete cascade,  -- WHOSE behavior
  organization_id uuid references organizations(id) on delete set null,   -- context (doc 01); null = solo
  actor_id      uuid references profiles(id) on delete set null,          -- who caused it (athlete, coach, system)
  event_type    text not null,
  severity      smallint not null default 0,        -- 0..5, mirrors AccountabilityLevel (adherence.ts)
  -- the deterministic detail the engines produced; never free-form prose, always typed facts
  payload       jsonb not null default '{}',        -- {meal:'dinner', proteinGap:18, level:3, ...}
  day_stamp     date not null,                       -- the athlete's local day (rollover-aligned)
  occurred_at   timestamptz not null default now(),
  -- idempotency: one event per (athlete, type, day, dedupe_key) — re-running the engine is safe
  dedupe_key    text,
  unique (athlete_id, event_type, day_stamp, dedupe_key)
);
create index ae_athlete_day on accountability_events(athlete_id, day_stamp desc);
create index ae_org_severity on accountability_events(organization_id, severity desc, occurred_at desc);
create index ae_type on accountability_events(athlete_id, event_type, occurred_at desc);
```

**RLS** (inherits doc `02`):
```
SELECT using ( can_view(athlete_id) )            -- athlete + scoped overseers, consent pre-filtered
INSERT via RPC only ( record_event() ) — never a raw client insert; the RPC asserts is_self
                                          OR (system actor for derived events) and dedupes
no UPDATE / no DELETE (append-only trigger)
```

> **The contract for doc `05` (AI Copilot):** the Copilot reads `accountability_events` (+ the
> athlete's plan/score context) and **only** these. It may rank, cluster, and phrase; it may
> *propose* an `intervention_suggested` event; it may NOT write any other event type and may NOT
> set `severity` (severity is owned by the deterministic `src/core` engines). This keeps the AI
> "recommends, never dictates" (Rule #13) at the data layer.

> **INFERRED — founder confirm:** events are written **server-side at sync time** by
> `record_event()`, derived from the same pure engine output the client already computes, so the
> ledger is the single source of truth even across devices. Alternative: client emits events
> directly. Recommend server-derived (un-spoofable, consistent). With `isBackendLive=false` the
> events live only in local state (today's behavior) — nothing fabricated.

### 3.2 The Escalation Engine — state machine over the ledger

The founder's chain — **Reminder → Missed Meal → Score Impact → Coach Alert → Weekly Report →
Suggested Intervention → Coach Follow-up** — maps exactly onto the **already-built 6 levels** in
`adherence.escalation()`. We keep that pure function as the **transition rule** and add the
*memory* (multi-day streak), the *dedupe/cooldown*, and the *delivery gate* it lacks.

**State (per athlete, per day, persisted):**

```sql
create table escalation_state (
  athlete_id   uuid not null references profiles(id) on delete cascade,
  day_stamp    date not null,
  level        smallint not null default 0,         -- current AccountabilityLevel 0..5
  consecutive_days_missed smallint not null default 0,  -- the cross-day memory adherence.ts needs as input
  last_transition_at timestamptz,
  primary key (athlete_id, day_stamp)
);
```

**Transitions** (the signals that drive them — all already computed by the pure core):

| From → To | Trigger signal (source engine) | Chain leg |
|---|---|---|
| 0 clear → 1 reminder | open meal window ≤45m to deadline (`mealWindowStatuses`) | **Reminder** |
| 1 → 2 support | a required window flips to `missed` (`missedToday≥1`) | **Missed Meal** |
| 2 → 3 score | `missedToday≥2` → Development Score reflects it (scoring engine) | **Score Impact** |
| 3 → 4 coach | `consecutiveDaysMissed≥3` (read from `escalation_state`) | **Coach Alert** |
| 4 → (weekly) | Sunday rollover aggregates the week (`weeklyReport`) | **Weekly Report** |
| weekly → 5 report/intervention | `weeklyFlag` non-null → `intervention_suggested` event | **Suggested Intervention** |
| 5 → resolved | coach actions it (nudge/message) → `intervention_actioned` | **Coach Follow-up** |

Each transition emits an `escalation_raised` event (severity = new level). The cross-day input
`consecutiveDaysMissed` — the one thing today's stateless `escalation()` cannot know — is read
from `escalation_state` and passed in, so **the pure function stays pure** and the state lives in
the DB. This is the EVOLVE: same math, new memory.

**Severity thresholds (deterministic, founder-tunable, NOT ML):** levels 0–2 are
**athlete-only** (self-correction; the coach is never pinged for a single missed snack). A coach
is alerted **only at level ≥4** (3 consecutive days) or a weekly flag — matching
`overseerAlerts` defaults (`below_line`, `missed_logging`). This is the primary fatigue control:
*most accountability never reaches the coach.* **[DON'T BUILD YET]:** per-athlete adaptive
thresholds — ship one global table.

### 3.3 Anti-fatigue: `notification_dispatch` (the delivery gate)

A signal becoming a *delivered* notification is a **separate decision** from the signal
existing. This is the one place rate-limiting, dedupe, quiet hours, and severity gating live —
so no engine has to re-implement it.

```sql
create table notification_dispatch (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references profiles(id) on delete cascade,
  athlete_id    uuid references profiles(id),        -- subject (for overseer alerts)
  source_event  uuid references accountability_events(id),
  channel       text not null default 'push' check (channel in ('push','in_app','email')),
  category      text not null,                        -- maps to OverseerAlertKey / ReminderKind
  severity      smallint not null,
  status        text not null default 'queued'
                  check (status in ('queued','suppressed','sent','failed')),
  suppressed_reason text,    -- 'quiet_hours' | 'rate_limited' | 'duplicate' | 'pref_off' | 'permission'
  scheduled_for timestamptz,                          -- supports "Schedule" (Communication §3.4)
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index nd_recipient_recent on notification_dispatch(recipient_id, created_at desc);
```

**The gate (pure, in `src/core/dispatch.ts` — NEW, no RN/Supabase) returns send | suppress(reason):**

1. **Permission** — recipient holds `alert.receive` for this athlete (doc `02`); else `permission`.
2. **Preference** — recipient's `overseerAlerts`/`reminderSettings` enables this category; else `pref_off`.
3. **Quiet hours** — within the recipient's quiet window (default 21:00–07:00 local, founder-tunable) AND severity < critical → defer to window edge, mark `quiet_hours`. Critical (≥4) may override quiet hours. **INFERRED — founder confirm** the override-on-critical rule.
4. **Dedupe** — an equivalent `(recipient, athlete, category, day)` already `sent` → `duplicate`.
5. **Rate limit** — token bucket per recipient (default: **athlete** ≤4 reminders/day; **overseer** ≤1 per-athlete alert/day + ≤1 roster digest/day). Exceed → `rate_limited`, coalesced into the next digest.

Only a `send` verdict reaches the device seam (`src/lib/notify`, gated by `isNotifyAvailable`).
**With the backend/notify seam off, nothing fires** — today's exact behavior. The pure gate is
unit-testable offline, matching the `consent.ts`/`subscription.ts` inert-seam discipline.

> The fatigue thresholds (`MAX_DAILY_REMINDERS`, quiet-hours window, severity-override cutoff)
> are pure constants in `src/core/dispatch.ts` — the same place the defaults can be tuned without
> a migration, and the substrate a future adaptive model reads. **[DON'T BUILD YET]:** the
> adaptive model; ship the fixed buckets.

### 3.4 Communication — structured-first, expansion-ready

**No unrestricted chat at launch** (Constitution §8). Communication is a **typed preset** with
four actions: **One-Tap Send · AI Draft · Edit · Schedule.**

**`message_presets`** — a pure catalog constant in `src/core/messaging.ts` (EVOLVE), so the UI
and server share one vocabulary:

```ts
type PresetKey =
  | 'great_job' | 'protein_low' | 'hydrate' | 'complete_dinner'
  | 'needs_attention' | 'coach_recognition';
interface MessagePreset {
  key: PresetKey;
  label: string;                 // button text
  direction: 'to_athlete' | 'to_coach';
  defaultBody: string;           // the one-tap text (athlete-first, no em dash, no shaming)
  aiDraftable: boolean;          // can the Copilot personalize it over the event context?
  triggerEvent?: EventType;      // e.g. 'protein_low' is suggested off a protein_target_missed event
}
```

**`messages` (EVOLVE of `0001`):** add structured typing while preserving the free-text column
for the deferred v2.

```sql
alter table messages add column kind text not null default 'free_text'
   check (kind in ('preset','ai_draft','free_text'));   -- free_text reserved, flag-gated v2
alter table messages add column preset_key text;        -- nullable; set for preset/ai_draft
alter table messages add column scheduled_for timestamptz;  -- "Schedule" action
alter table messages add column delivered_at timestamptz;
```

**Flow:** coach taps a preset → optional **AI Draft** (Copilot personalizes `defaultBody` over
the athlete's event context — "Great job hitting 180g three days running") → optional **Edit** →
**Send now** or **Schedule** (writes `notification_dispatch` with `scheduled_for`). Sending
emits a `coach_message_sent` / `recognition_sent` event (so recognition feeds achievements and
the relationship graph). A `needs_attention` preset *from a coach to themselves/AD* doubles as a
manual escalation.

**Minor gate — PRESERVED EXACTLY.** Every send re-checks `messagingAllowed()`
(`src/core/messaging.ts`) in the UI and `messaging_authorized()` (RLS, `0006`) on the server.
**Presets do not bypass the gate** — a preset to a minor is still blocked unless the sender is an
authorized coach/trainer/guardian. The structured layer sits *on top of* `0006`, never around
it. **INFERRED — founder confirm:** preset sends to a minor are governed by the same
`messaging_authorized` predicate (recommend yes — no special-casing).

> **Expansion seam:** when free-text chat is approved, it is `kind='free_text'` behind a flag —
> no schema change, and `messaging_authorized` already governs it. The deferral is a feature
> flag, not a rebuild.

### 3.5 Private Notes — category-scoped, medical-restricted

Notes are **org-context, overseer-authored** (except the athlete's own journal). Each category
maps to a distinct permission so **medical notes are visible only to clinical roles**, never the
position coach.

```sql
note_category := 'coach' | 'nutrition' | 'strength' | 'medical' | 'journal'

create table notes (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references profiles(id) on delete cascade,  -- WHOM (subject)
  author_id     uuid not null references profiles(id) on delete cascade,  -- WHO wrote it
  organization_id uuid references organizations(id) on delete set null,
  category      note_category not null,
  body          text not null,
  is_private    boolean not null default true,   -- private to author+role vs shared with athlete
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index notes_athlete_cat on notes(athlete_id, category, created_at desc);
```

**Per-category read permission (the key design call):**

| Category | Read permission (doc `02`) | Author | Visible to athlete? |
|---|---|---|---|
| `coach` | `notes.coach.view` (head/position/assistant coach) | coach | only if `is_private=false` |
| `nutrition` | `notes.nutrition.view` (nutritionist) | nutritionist | only if shared |
| `strength` | `notes.strength.view` (strength coach) | strength coach | only if shared |
| **`medical`** | **`notes.medical.view` — clinical roles ONLY (athletic trainer, org owner by policy)** | athletic trainer | **never by default; HIPAA-sensitive** |
| `journal` | the athlete only (`is_self`) | the athlete | always (it's theirs) |

`medical` is **deny-by-default to all coaching roles** — a head coach with full `report.view`
still cannot read medical notes; it requires the explicit `notes.medical.view` key held only by
clinical roles. This is the Private-Notes analog of the scoring-formula lockout: a structural
restriction, not a preference. Every note read/write writes an `activity_log` row (doc `02 §3.5`)
because medical access is auditable by law.

> **INFERRED — founder/legal confirm:** medical notes may need a **separate retention + export
> policy** (and exclusion from the athlete's standard data export, `src/core/dataExport.ts`)
> because they are authored *about* the athlete by a clinician, not *by* the athlete. Flag for
> the Consent/Legal doc. Recommend: athlete can see *that* a medical note exists and request it
> through the AT, but clinical notes aren't auto-exported.

### 3.6 Achievements — habit-grounded, derived from the ledger

Achievements **reward execution, never logins or vanity** (Rule #4, §5 matrix). Every
achievement is a **pure predicate over `accountability_events`** — so it can never be gamed by a
client and is recomputable/auditable.

```ts
// src/core/achievements.ts (NEW, pure)
type AchievementKey =
  | 'perfect_week'           // 7/7 days plan-complete (day_completed events)
  | 'protein_streak_7'       // 7 consecutive protein_target_hit
  | 'hydration_week'         // 7/7 hydration_hit
  | 'execution_climb'        // weekly avg score up ≥ MOVE_THRESHOLD two weeks running
  | 'consistency_30'         // 30-day logging streak (no streak_broken)
  | 'coach_recognized'       // received a recognition_sent event
  | 'comeback'               // returned to ≥85 band after a needs-intervention week (behavior improvement)
  | 'recovery_complete';     // recovery_cleared after a recovery_episode
interface AchievementDef {
  key: AchievementKey; label: string; description: string;
  evaluate(events: AccountabilityEvent[], window: DayStamp[]): boolean;  // pure, deterministic
}
```

```sql
create table achievement_grants (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references profiles(id) on delete cascade,
  key           text not null,
  granted_at    timestamptz not null default now(),
  source_window daterange,             -- the days that earned it (auditable)
  unique (athlete_id, key, source_window)   -- earn "perfect_week" once per week, repeatable
);
```

Granting emits an `achievement_unlocked` event (so the Copilot can celebrate it and recognition
compounds). **No badge exists without a behavioral predicate behind it** — the anti-vanity rule
as architecture. Achievements are athlete-owned and always visible to the athlete; an overseer
sees them through `can_view`. **[DON'T BUILD YET]:** points/levels/leaderboard gamification —
ship the meaningful-habit set; the leaderboard is §5-flagged as a distraction risk.

### 3.7 Recovery Mode — injury workflow (distinct from `recovery.ts`)

> **Disambiguation:** `src/core/recovery.ts` folds *wearable recovery signals* into the score.
> **Recovery Mode** here is the *injury* workflow. Different concept; net-new.

An injury episode **temporarily overrides the plan** (lower calories/protein floor to match
reduced load, raise hydration, surface education) and **alerts the coach/clinical staff**, with a
**return-to-play gate**.

```sql
recovery_stage := 'acute' | 'rehab' | 'return_to_play' | 'cleared'

create table recovery_episodes (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references profiles(id) on delete cascade,
  started_by    uuid references profiles(id),       -- athlete, coach, or AT
  injury_type   text,                                -- generic at launch; per-type protocols deferred
  stage         recovery_stage not null default 'acute',
  -- the plan OVERRIDE while active (additive layer over CoachPlan; never edits the base plan)
  calorie_adjust_pct smallint,    -- e.g. -15 (reduced training load)
  protein_floor_g    smallint,    -- protein stays HIGH for tissue repair even as calories drop
  hydration_target_l numeric,
  cleared_by    uuid references profiles(id),        -- the return-to-play gate (who signed off)
  started_at    timestamptz not null default now(),
  cleared_at    timestamptz
);
```

**The override is an additive layer**, computed in a pure `src/core/recoveryMode.ts` (NEW) that
takes the active `CoachPlan` and the episode and returns an adjusted plan — **the base plan is
never mutated**, so clearing the episode restores the original exactly (history-immutability
preserved). The deterministic adjustment (protein floor up, calories down with load,
hydration up) is **safety-bounded math, never an AI number** (Rule #8, especially for minors).
Education content is rotated from `src/core/content.ts`.

**Lifecycle + events:** `recovery_started` (alerts coach + AT via dispatch, severity high) →
`recovery_plan_adjusted` (the override takes effect) → stage transitions → `recovery_cleared`
(requires `cleared_by` a clinical role; emits the event that can unlock the `recovery_complete`
achievement). **Return-to-play is permission-gated:** only a role holding `recovery.clear`
(athletic trainer / org owner) can set `cleared_at` — an athlete cannot self-clear. **INFERRED —
founder confirm:** athlete-initiated injury logging is allowed (they report it), but
**clearance** requires a clinical role. Recommend yes.

> **[DON'T BUILD YET]:** per-injury-type RTP protocols, PT/clinical integrations, graded
> exertion stages. Ship one generic episode (the override + alert + clearance gate). The
> `injury_type` + `stage` columns reserve the expansion.

### 3.8 Text ER sketch (this slice)

```
profiles(athlete) 1──N accountability_events ── (the cross-cutting ledger; append-only)
        │                    │  org context → organizations (doc 01)
        │                    └─ read by: escalation_state, notification_dispatch,
        │                                weeklyReport, achievements, AI Copilot (doc 05)
        │
        ├──N escalation_state        (per athlete/day: level + consecutive_days_missed memory)
        ├──N notification_dispatch   (the anti-fatigue delivery gate; channel/severity/scheduled)
        ├──N notes (coach|nutrition|strength|MEDICAL|journal)  — per-category permission, medical locked
        ├──N achievement_grants ── achievements.ts predicates over the ledger
        ├──N recovery_episodes ── recoveryMode.ts additive plan override + RTP clearance gate
        └──N messages (EVOLVE: kind∈preset|ai_draft|free_text, preset_key, scheduled_for)
                 │ in threads(athlete ⇄ counterpart, 0001) gated by messaging_authorized (0006)
                 └─ presets: message_presets catalog (pure, src/core/messaging.ts)
```

---

## 4. RPC / Edge-Function surface (target signatures)

All `SECURITY DEFINER`, `search_path=public`, routed through `allowed(viewer, athlete, scope,
action)` (doc `02`), consent-pre-filtered, and each writes its `activity_log` row in-transaction.

- `record_event(athlete, event_type, severity, payload, day_stamp, dedupe_key) → event_id` —
  the **only** writer of `accountability_events`; asserts `is_self` OR a system/derived context;
  idempotent on `dedupe_key`. Severity is engine-supplied; the AI may not call this with a
  severity it didn't get from the core.
- `advance_escalation(athlete, day) → level` — recomputes `escalation_state` from the day's
  events via the pure `escalation()`; emits `escalation_raised` on a transition.
- `dispatch_notification(recipient, source_event, category, severity) → status` — runs the pure
  `src/core/dispatch.ts` gate; only a `send` verdict hits the notify seam.
- `send_structured_message(thread, preset_key, body, scheduled_for?) → message_id` — asserts
  `message.send` + `messaging_authorized` (`0006`); emits `coach_message_sent`/`recognition_sent`.
- `write_note(athlete, category, body, is_private) → note_id` / `read_notes(athlete, category)` —
  category→permission mapping (medical = `notes.medical.view`); both audited.
- `start_recovery(athlete, injury_type) → episode_id` / `adjust_recovery_plan(episode, ...)` /
  `clear_recovery(episode)` — clearance asserts `recovery.clear` (clinical role only).
- `evaluate_achievements(athlete, window)` — Edge cron; pure predicates over the ledger; inserts
  `achievement_grants` + emits `achievement_unlocked`. Idempotent (the unique constraint).

---

## 5. Migration path (non-destructive, staged)

The point: **the pure engines already work; we add durability and delivery without breaking the
~970 tests or `src/core` purity.**

1. **Phase 0 (now / pre-backend):** everything stays pure + on-device behind `isEnginesEnabled`.
   Add the NEW pure modules — `dispatch.ts`, `achievements.ts`, `recoveryMode.ts`, the
   `message_presets` catalog — as inert, fully unit-tested `src/core` files (no RN/Supabase),
   matching the `consent.ts`/`subscription.ts` seam pattern. `adherence.escalation()`,
   `attention.ts`, `weeklyReport.ts`, `reminders.ts` are **untouched**. Author (do not push, per
   the D1 guardrail) the `accountability_events` / `escalation_state` / `notification_dispatch` /
   `notes` / `achievement_grants` / `recovery_episodes` migrations + the `messages` ALTER.
2. **Phase 1 (event ledger live):** when `isBackendLive` flips, `record_event()` writes the
   ledger server-side from the same engine output the client already computes. The local-only
   path keeps working; the ledger becomes the source of truth when synced. No `src/core` change.
3. **Phase 2 (delivery on):** wire `src/lib/notify` to the `dispatch_notification` gate. Reminders
   and overseer alerts now actually fire — the single biggest user-visible unlock in this slice
   (§5 matrix: "Notifications — wired in-app; off on device"). Quiet-hours + rate-limit ship on.
4. **Phase 3 (structured comms):** ship the preset composer + AI-Draft over the existing
   `threads`/`messages` (EVOLVE), `messaging_authorized` enforced throughout. Free-text stays
   `[DON'T BUILD YET]` behind a flag.
5. **Phase 4 (notes + achievements + Recovery Mode):** ship as the org-backed surfaces land
   (they depend on `org_memberships` + permissions from docs `01`/`02`). Recovery Mode ships the
   generic episode only.

`src/core` purity holds throughout: every new engine is pure and offline-testable; the only
impure additions are the SECURITY DEFINER RPCs and the `src/lib/notify` seam.

---

## 6. Open decisions for the founder

1. **Server-derived vs client-emitted events** (§3.1) — recommend server-derived via
   `record_event()` so the ledger is un-spoofable and cross-device consistent.
2. **Quiet-hours override on critical severity** (§3.3) — may a level-≥4 coach alert pierce quiet
   hours? Recommend yes for critical only; everything else defers.
3. **Rate-limit defaults** (§3.3) — confirm athlete ≤4 reminders/day, overseer ≤1 alert/athlete/day
   + ≤1 digest/day. These are the primary fatigue knobs.
4. **Coach-alert floor** (§3.2) — confirm coaches are alerted **only at level ≥4 (3 consecutive
   missed days) or a weekly flag**, never for a single missed meal. This is the "amplify, don't
   nag" call.
5. **Medical-note restriction + export** (§3.5) — confirm medical notes are deny-by-default to all
   coaching roles (clinical-only) AND excluded from the athlete's standard data export pending
   legal review.
6. **Preset sends to minors** (§3.4) — confirm one-tap presets are governed by the same
   `messaging_authorized` gate as free-text (no preset bypass). Recommend yes.
7. **Recovery clearance authority** (§3.7) — confirm athletes may *log* an injury but only a
   clinical role (`recovery.clear`) may *clear* return-to-play.
8. **Achievement repeatability** (§3.6) — confirm habit achievements (perfect week, protein
   streak) re-grant each window rather than once-ever (recommend repeatable; it's the habit, not
   a trophy).

---

## 7. Cross-cutting contract (what other docs MUST honor)

1. **Every actionable behavioral signal is one immutable `accountability_events` row** keyed on
   `athlete_id`. No doc invents a parallel signal store. The ledger is append-only (immutability
   trigger), athlete-owned, overseer-readable only through `can_view` (doc `01`/`02`).
2. **Severity is owned by the deterministic `src/core` engines.** The AI Copilot (doc `05`) reads
   the ledger and may rank/phrase/propose, but may not set severity or emit any event type other
   than `intervention_suggested`. "AI recommends, never dictates" at the data layer.
3. **`notification_dispatch` is the single delivery gate.** No surface fires a notification
   directly; everything routes through the rate-limit/quiet-hours/dedupe/permission gate. Doc
   `05`'s nudges and doc-level reminders all dispatch through it.
4. **The minor-messaging gate (`messaging_authorized`, `0006`) is supreme over all
   communication**, including structured presets and AI-drafted messages. No channel — preset or
   free-text — bypasses it.
5. **Recovery Mode never mutates the base `CoachPlan`** — it is an additive, restorable override,
   so clearing an injury restores the original plan exactly (history-immutability).
6. **Medical notes are deny-by-default to coaching roles** (clinical-only `notes.medical.view`),
   a structural restriction like the scoring-formula lockout, and are fully audited.
