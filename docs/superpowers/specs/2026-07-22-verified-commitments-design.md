# Verified Commitments — design

**Date:** 2026-07-22
**Status:** approved (founder), building all three slices
**Branch:** `feat/founder-command-center` (current working branch)

Verified Commitments lets a coach verify that athletes **acknowledge**, **arrive for**, and
**complete** scheduled responsibilities — without counting replies in a group chat and without
tracking anyone's movements.

v1 delivers two capabilities on one shared primitive: **Morning Roll Call** and
**Location-Verified Arrival**.

---

## 1. Founder decisions (settled before design)

| Question | Decision |
|---|---|
| Sequencing | One spec, built in slices. Roll Call ships OTA; location rides the next native build. |
| Scoring | **Its own Accountability score.** The daily 0–100 (nutrition 50 / recovery 25 / commitment 15 / check-in 10) is untouched. |
| Calendar depth | **Commitments are the schedule.** No separate calendar screen; the table is shaped so one can be built later without a migration. |
| Location depth | **Auto-detect with a tap fallback.** Background geofence when granted, one-shot foreground fix when not. |
| Minor consent | **Guardian consent with an institutional override**, recorded in the admin audit log. |
| Naming | **Split by audience.** "Verified Commitments" is coach/internal vocabulary; athletes see the concrete thing plus "Morning Readiness" / "Accountability". Nothing existing is renamed. |
| Copy | **Every athlete-visible string is coach-authored.** No product-written message ships. |

### Why the daily score is not touched

`PROFILE_WEIGHTS` in [`proto/redesign-2026-07/js/day.js`](../../../proto/redesign-2026-07/js/day.js)
is a byte-exact port of `src/core/scoring.ts`, proven equal by `scripts/score-parity`, and
further guarded by a server-side evidence-ceiling trigger. Multi-domain completions (0112) and
training logs (0135) both shipped **tracked-not-scored** for the same reason. Verified
Commitments follows that precedent and produces a parallel score instead.

---

## 2. Vocabulary

- **Commitment** — a recurring scheduled responsibility (coach-facing noun).
- **Instance** — one dated occurrence of a commitment.
- **Response** — one athlete's record against one instance.
- **Morning Readiness** — the rollup an athlete and coach read (`92%`).
- **Accountability score** — the weighted trailing score derived from responses.

Commitment types in v1 (`commitment_type` check constraint):
`morning_roll_call`, `practice`, `strength`, `speed`, `team_meeting`, `study_hall`,
`tutoring`, `class`, `rehab`, `nutrition`.

Adding a type later is a one-line `alter ... drop constraint / add constraint` — no schema
reshaping, no client branching (the client renders from `type_label`, defaulting per type).

---

## 3. Data model

**`0138_verified_commitments.sql`** creates **all five tables** plus the slice-1 RPCs. The
arrival and consent *columns* land here too — they are inert until slice 2 writes to them, and
shipping the full shape once avoids a second structural migration.
**`0139_commitment_verification.sql`** (slice 2) adds only *behavior*: the arrival/completion
RPCs and consent enforcement.

Every table follows the established repo conventions:

- **Dual owner** — `team_id uuid null references teams(id)` + `practice_id uuid null references
  practices(id)` with `check (num_nonnulls(team_id, practice_id) = 1)`, per 0136. Trainers get
  this feature, not just coaches.
- **RLS on, writes through `security definer` RPCs**, matching 0055/0071.
- **Explicit `grant`s to `authenticated`** — 0013 revoked defaults; see
  `docs/` note on the table-grants gotcha. A table without grants silently fails writes and the
  RLS suite does not catch it.
- Staff authorization delegates to the existing `is_team_staff(team_id)` /
  `is_practice_staff(practice_id)` predicates; athlete authorization to `can_view()` semantics.

### 3.1 `commitment_locations`

Named, reusable places. A coach enters an address once.

```sql
create table if not exists commitment_locations (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid references teams(id) on delete cascade,
  practice_id  uuid references practices(id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 60),
  address      text check (address is null or char_length(address) <= 200),
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  radius_m     integer not null default 120 check (radius_m between 50 and 1000),
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz,
  constraint commitment_locations_one_owner check (num_nonnulls(team_id, practice_id) = 1)
);
```

`radius_m` floors at 50 m because consumer GPS is not more accurate than that; anything
tighter manufactures false negatives.

### 3.2 `commitments`

The recurring schedule row. **This is the calendar.**

```sql
create table if not exists commitments (
  id                    uuid primary key default gen_random_uuid(),
  team_id               uuid references teams(id) on delete cascade,
  practice_id           uuid references practices(id) on delete cascade,
  type                  text not null check (type in (
                          'morning_roll_call','practice','strength','speed','team_meeting',
                          'study_hall','tutoring','class','rehab','nutrition')),

  -- coach-authored presentation (NO product copy ships)
  title                 text not null check (char_length(trim(title)) between 1 and 60),
  message               text check (message is null or char_length(message) <= 200),
  action_label          text check (action_label is null or char_length(action_label) <= 24),

  -- audience
  audience_kind         text not null check (audience_kind in ('team','room','group','athlete')),
  audience_value        uuid,           -- room_id | group_id | athlete_id; null when 'team'

  -- recurrence
  repeat_days           smallint[] not null default '{}'     -- JS getDay(): 0=Sun..6=Sat
                          check (repeat_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  starts_on             date not null default (now() at time zone 'utc')::date,
  ends_on               date,
  timezone              text not null default 'America/New_York',

  -- times, minute-of-day (matches every existing requirement window)
  starts_min            smallint not null check (starts_min between 0 and 1439),
  ends_min              smallint check (ends_min between 0 and 1439),
  respond_by_min        smallint check (respond_by_min between 0 and 1439),
  opens_min             smallint check (opens_min between 0 and 1439),

  -- arrival verification (all nullable — a meeting can skip location entirely)
  location_id           uuid references commitment_locations(id) on delete set null,
  arrive_by_min         smallint check (arrive_by_min between 0 and 1439),
  arrival_grace_min     smallint not null default 10 check (arrival_grace_min between 0 and 120),
  min_dwell_min         smallint check (min_dwell_min between 0 and 480),

  linked_commitment_id  uuid references commitments(id) on delete set null,
  reminder_offsets_min  smallint[] not null default '{15,5}',

  active                boolean not null default true,
  created_by            uuid not null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint commitments_one_owner check (num_nonnulls(team_id, practice_id) = 1),
  constraint commitments_window   check (ends_min is null or ends_min >= starts_min),
  constraint commitments_no_self_link check (linked_commitment_id is distinct from id)
);
```

Notes that matter:

- **`title` / `message` / `action_label` are the coach's words.** The composer offers tappable
  *starters* that load into the field for editing; it never silently persists product copy.
  A program that calls it "5 AM Club" sees "5 AM Club" on the athlete's phone. `action_label`
  defaults to `I'm Up` **in the client render only** when null, so the column stays honest about
  whether the coach chose it.
- **`audience_kind = 'room'`** reuses `team_rooms` (position groups — "Linebackers", already
  auto-assigned from an athlete's position by 0101). `'group'` reuses `coach_groups`.
  Nothing new is invented for audience.
- **`linked_commitment_id`** is what renders *"Practice at 6:00 AM"* under a roll call.
- `opens_min` is when the card appears. When null it resolves to
  `coalesce(respond_by_min, starts_min) - 60`, floored at 0 (no wrap to the previous day).

### 3.3 `commitment_instances`

One row per commitment per date, created **on demand** by an RPC — no nightly cron. This is
where "practice moved to 6:30 today" and "cancelled Thursday" live, without editing the
standing rule.

```sql
create table if not exists commitment_instances (
  id                uuid primary key default gen_random_uuid(),
  commitment_id     uuid not null references commitments(id) on delete cascade,
  occurs_on         date not null,
  starts_at         timestamptz not null,   -- resolved from date + starts_min + timezone
  ends_at           timestamptz,
  respond_by_at     timestamptz,
  arrive_by_at      timestamptz,
  status            text not null default 'scheduled'
                      check (status in ('scheduled','cancelled')),
  message_override  text check (message_override is null or char_length(message_override) <= 200),
  note              text check (note is null or char_length(note) <= 200),
  created_at        timestamptz not null default now(),
  unique (commitment_id, occurs_on)
);
```

`message_override` lets a coach change *just today's* message — game day reads differently
from a Tuesday — without disturbing the standing schedule.

### 3.4 `commitment_responses`

One row per athlete per instance. The heart of the feature.

```sql
create table if not exists commitment_responses (
  id               uuid primary key default gen_random_uuid(),
  instance_id      uuid not null references commitment_instances(id) on delete cascade,
  athlete_id       uuid not null references profiles(id) on delete cascade,

  acknowledged_at  timestamptz,
  arrived_at       timestamptz,
  completed_at     timestamptz,
  departed_at      timestamptz,

  arrival_source   text check (arrival_source in ('geofence','manual','staff')),
  status           text not null default 'pending' check (status in (
                     'pending','acknowledged','arrived','completed',
                     'missed','excused','unverified')),
  unverified_reason text check (unverified_reason is null or char_length(unverified_reason) <= 60),

  excused_by       uuid references profiles(id),
  excused_reason   text check (excused_reason is null or char_length(excused_reason) <= 120),
  corrected_by     uuid references profiles(id),
  corrected_at     timestamptz,
  disputed_at      timestamptz,
  dispute_note     text check (dispute_note is null or char_length(dispute_note) <= 200),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (instance_id, athlete_id)
);
```

**There is no coordinate column and no movement table anywhere in this design.** Latitude and
longitude are compared on the device; what persists is a verdict and a timestamp.

### 3.5 `verification_consent`

```sql
create table if not exists verification_consent (
  id           uuid primary key default gen_random_uuid(),
  athlete_id   uuid not null references profiles(id) on delete cascade,
  kind         text not null check (kind in ('guardian','institutional')),
  granted_by   uuid not null references profiles(id),
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  scope_team   uuid references teams(id) on delete cascade,
  note         text check (note is null or char_length(note) <= 200)
);
```

An institutional grant writes an `admin_audit_log` row naming the asserting staff member.

Slice 1 also adds one column to an existing table:

```sql
alter table profiles add column if not exists
  share_verified_discipline boolean not null default false;
```

Athlete-controlled, off by default — the switch behind the recruit profile (§9).

### 3.6 RPCs (all `security definer`)

| RPC | Caller | Purpose |
|---|---|---|
| `upsert_commitment(jsonb)` | staff w/ `schedule` cap | create/edit a standing commitment |
| `ensure_commitment_instances(p_owner uuid, p_from date, p_to date)` | staff + athlete | lazily materialize instances + pending responses for the window |
| `commitment_board(p_owner uuid, p_on date)` | staff | the live dashboard payload: per-instance counts + per-athlete rows |
| `my_commitments(p_from date, p_to date)` | athlete | the athlete's own instances + responses |
| `ack_commitment(p_instance uuid)` | athlete | stamp `acknowledged_at` (server clock) |
| `verify_arrival(p_instance uuid, p_source text, p_within boolean)` | athlete | stamp `arrived_at` or `unverified` |
| `complete_commitment(p_instance uuid, p_source text)` | athlete | stamp `completed_at` |
| `dispute_response(p_instance uuid, p_note text)` | athlete | raise "I was there" |
| `staff_set_response(p_response uuid, p_status text, p_reason text)` | staff | excuse / manually correct |
| `remind_missing(p_instance uuid)` | staff | push only to non-responders |
| `athlete_accountability(p_athlete uuid, p_from date, p_to date)` | athlete + staff | the Morning Readiness / Accountability rollup |
| `verified_discipline(p_athlete uuid, p_from date, p_to date)` | athlete + shared | recruit-profile aggregate |

**All timestamps come from the server clock (`now()`), never the client.** A client-supplied
"I woke at 4:48" is not a verification.

---

## 4. Client architecture

The shipped UI is the proto WebView (`proto/redesign-2026-07`), so that is where the athlete
and coach surfaces live. New files, each with one job:

| File | Responsibility |
|---|---|
| `js/commitments.js` | **pure engine** — recurrence expansion, instance/response status derivation, accountability weighting. No DOM, no Supabase, no clock (everything is an argument), in the style of `requirements.js` and `notify-plan.js`. Node-testable. |
| `js/commitment-data.js` | Supabase I/O + runtime cache, mirroring `coach-data.js` |
| `js/screens/roll-call.js` | athlete full-screen detail (stages, dispute, history) |
| `js/screens/coach-commitments.js` | coach board: live counts, roster breakdown, remind/excuse/correct |
| `js/screens/coach-commit-edit.js` | the composer (type, audience, days, times, location, message) |
| `js/screens/accountability.js` | Morning Readiness + Accountability rollup |

Integration points into existing files, kept minimal:

- `js/screens/home.js` — render the live commitment card in the existing card stack.
- `js/screens/coach-home.js` — render the live board card beside today's priorities.
- `js/notify-plan.js` — a `commitment` entry type feeding the existing planner.
- `js/screens/coach-create.js` — a "Schedule a commitment" entry behind the existing
  `schedule` capability key in `staff-access.js`.
- `js/router.js` — four new routes.

Native (slice 2), following the existing `HEALTH_*` bridge idiom in `src/proto/bridge.ts`:

| File | Responsibility |
|---|---|
| `src/lib/location/geofence.ts` | register/unregister geofences for a window; one-shot fix |
| `src/lib/location/index.ts` | permission state machine + capability probe |
| `src/proto/bridge.ts` | `LOCATION_AVAILABLE` / `LOCATION_PERMISSION` / `LOCATION_ARM` / `LOCATION_EVENT` / `LOCATION_FIX` |

---

## 5. Athlete experience

One tap. The card is the only thing that changes on Home.

**Card appears** at `opens_min` inside the existing Home card stack, using today's requirement
card visual language (no new design system):

```
Morning Roll Call                     ← coach-authored title
"Everyone up? Ready to rise and conquer?"   ← coach-authored message
Practice at 6:00 AM · Respond by 5:15 AM    ← from linked_commitment_id
[ I'm Up ]                            ← coach-authored action_label
```

**On tap:** server stamps the time, the coach's count moves immediately, and the card collapses
to one line — *"Checked in at 4:48 AM."* No group-chat message is required.

**At the arrival window** the same card becomes the arrival card. With background location
granted it self-resolves and the athlete touches nothing; otherwise there is an **I'm here**
button that takes a single fix.

**Completion** stamps automatically once `min_dwell_min` is satisfied, or by tap.

A three-stage strip fills in across the card: **Acknowledged → Arrived → Completed**. A quiet
*"Something wrong?"* link files a dispute.

**Quiet hours.** `DEFAULT_NOTIF_PREFS` is 22:00–07:00, so a 4:45 AM roll call would otherwise be
silently swallowed. A coach-scheduled commitment reminder is therefore classed like the existing
`due` stage: it **overrides quiet hours**. The athlete is told this at enrollment, and the
phone's own Do Not Disturb still wins. Commitment reminders are exempt from the daily
notification cap — they are scheduled events, not nudges.

**Solo athletes** (no coach, no trainer) never see any of this. Verified Commitments is
operator-driven by definition.

---

## 6. Coach experience

**Creating** lives in the existing Create screen behind the `schedule` capability already in
`CREATE_CAPS`: head coach, coordinator, S&C, team admin. Position coaches and view-only cannot
schedule; position coaches still *see* their room's board.

**The live board card** on coach Home:

```
Morning Roll Call · Linebackers · Practice at 6:00 AM
9 of 11 Up          2 awaiting response
```

Tapping opens the roster: every athlete, status, exact response time, missing athletes pulled
to the top. Actions: **Remind Missing Athletes** (reaches only non-responders),
**Excuse** (writes `athlete_exceptions`, the existing primitive), **Mark manually**
(`staff_set_response`, recorded as `arrival_source = 'staff'` with `corrected_by`).

Every correction is attributed. Nothing in the coach UI can silently rewrite an athlete's record.

**No public list.** Individual status is visible only to staff scoped to that athlete
(`can_view()` / room scope). Athletes see their own record and no one else's. There is no
team-wide leaderboard of who missed roll call.

---

## 7. Location-verified arrival (slice 2)

**Temporary geofencing only.** An instance is **armed** from `starts_at - 2h` until
`coalesce(ends_at, starts_at + 3h) + 30m`. While armed, the app asks the OS to monitor that one
circle. The OS wakes the app on the boundary crossing; the app calls `verify_arrival`; the
geofence is torn down when the window closes. Between events nothing is registered and nothing
is watched.

**Constraints, recorded now because they shape the code:**

- iOS monitors at most **20 regions per app**. `geofence.ts` arms at most **16** instances
  (ordered by `starts_at`, leaving headroom) and re-arms as they roll off. Instances beyond the
  cap fall back to tap-to-verify, and `commitments.js` reports which ones so the athlete is told
  rather than silently unverified.
- iOS delivers crossings on its own schedule; `arrived_at` records the OS-reported crossing,
  and the RPC clamps it into `[arrive_by_at - 4h, ends_at + 1h]` so a delayed delivery cannot
  write a nonsense timestamp.
- `expo-location` is not currently a dependency and there is no location code in the repo.
  This adds the dependency, background location entitlement, and `NSLocationWhenInUseUsageDescription`
  / `NSLocationAlwaysAndWhenInUseUsageDescription` / `ACCESS_BACKGROUND_LOCATION`.
  **Slice 2 requires a new native build and cannot ship over the air.**

**Honesty rule, enforced in the strings.** Copy reads *"Phone arrived at the facility, 5:43 AM."*
Nothing claims location proves a workout happened. Completion is a separate signal, and the
detail screen states plainly that location verifies presence, not effort.

**Failure lands on `unverified`, never `missed`.** Dead battery, revoked permission, weak GPS
indoors, a session moved — all read *"Couldn't verify"* with a one-tap **I was there** that puts
it in the coach's queue.

**Consent gate.** For an athlete under 18, `verify_arrival` refuses a `geofence` or `manual`
source until an unrevoked `verification_consent` row exists. Guardian grants ride the existing
`guardian_consent_requests` / `guardian-verify` flow; institutional grants are made by a team
admin and audited. Revocation drops the athlete to tap-only, then to nothing, without deleting
their history.

---

## 8. Accountability score

Separate from the daily 0–100, which is untouched.

| Signal | Points |
|---|---|
| Responded to roll call | **10** |
| Arrived on time | **30** |
| Completed the commitment | **60** |

Rules:

- **A missed wake-up does not cascade.** Sleeping through roll call but standing on the field at
  5:50 loses the 10 and keeps the 90. The miss surfaces on its own Morning Readiness line.
- **`unverified` and `excused` leave the denominator entirely.** Neither can be scored honestly
  in either direction.
- Only signals the commitment actually asks for are counted: a team meeting with no location
  contributes acknowledgement and completion, and its denominator omits arrival.
- Score = `earned / possible` over a trailing window (7 and 30 day views).

Rollup, on the athlete's progress screen and the coach's athlete profile:

```
Morning Readiness · 92%
Wake responses     18/20
On-time arrivals   19/20
Completed sessions 20/20
```

Plus a current streak, computed like the existing logging streak.

---

## 9. Recruit profile hook

A read-only aggregate — `verified_discipline(athlete, from, to)` — returning **only** percentages
and counts: on-time arrival rate, commitments completed, morning response consistency, workout
attendance, academic commitment consistency, current streak.

- **Off by default, controlled solely by the athlete** (`profiles.share_verified_discipline`).
- Structurally incapable of returning an individual event, a location, a class name, a time of
  day, or a schedule. A recruiter learns *"94% on-time across 62 commitments"* and cannot learn
  where the athlete is at 6 AM.
- The recruiter-facing surface itself is slice 3; the aggregate exists from slice 1 so no
  rewrite is needed.

---

## 10. Privacy and safety requirements → where each is met

| Requirement | Met by |
|---|---|
| Never continuously track | Geofence armed only inside an instance window, torn down after (§7) |
| Activate only around scheduled commitments | `geofence.ts` arms from `commitment_instances` only |
| Store result + timestamp, not movement history | No coordinate column exists in any table (§3.4) |
| Only authorized staff see individual status | RLS via `is_team_staff` / `is_practice_staff` + room scope (§6) |
| No public list that embarrasses athletes | No leaderboard; athletes see only their own record |
| Parental / institutional consent for minors | `verification_consent` + guardian flow + audited institutional grant (§3.5, §7) |
| Clear permission explanations | Pre-prompt explainer screen before any OS dialog |
| Athletes can report incorrect verification | `dispute_response` + "Something wrong?" link |
| Dead phones, permissions, weak GPS, moved sessions | All resolve to `unverified` with a reason, never `missed` |

---

## 11. Build order

**Slice 1 — ships over the air.**
Migration 0138; `commitments.js` engine; composer; athlete Home card + roll-call screen; coach
board card + roster breakdown; remind / excuse / correct; notification planner integration;
Accountability score + Morning Readiness; `verified_discipline` aggregate.
Useful alone: a coach gets verified wake-ups the day it lands.

**Slice 2 — rides the next native build.**
Migration 0139 (arrival/completion RPCs + consent enforcement); `expo-location`; bridge
messages; permission explainer + consent gate; geofenced arrival; tap fallback; dwell
completion; disputes.

**Slice 3 — surfaces on top.**
iOS interactive Home / Lock Screen widgets (`9/11 UP`, `I'm Up`) via a WidgetKit app extension
and Expo config plugin; the recruiter-facing Verified Discipline profile.

---

## 12. Verification

- `npm run test:rls` — new probes: an athlete cannot read another athlete's responses; a
  position coach cannot read outside their room; a revoked consent blocks `verify_arrival`;
  a direct table write fails while the RPC succeeds (the grants gotcha).
- `npm run test:proto` — Node tests for `commitments.js`: recurrence expansion across a DST
  boundary, status derivation at every stage, accountability weighting incl. the
  missed-wake-up-but-arrived case and the excused/unverified exclusions.
- `npm run verify` — xss lint, typecheck, jest, proto tests, bundle. Must stay green.

## 13. Known risks

- **iOS 20-region cap** limits how many future instances can be armed; mitigated by arming the
  nearest N and re-arming, but a team with many same-day commitments will lean on the tap
  fallback.
- **Background location review.** Apple requires justification for `Always`; the app must
  function without it, which the tap fallback guarantees.
- **Slice 3 widgets need Swift/WidgetKit in a config plugin** and cannot be built or verified on
  a Windows dev machine — the extension target and plugin can be authored, but compilation and
  device testing require macOS/Xcode.
