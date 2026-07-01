# OnStandard — Phase 2: Multi-Tenant Backend (data model + RLS)

Status: spec / not yet built. Target stack: **Supabase** (Postgres + Auth + Storage +
Realtime + Row-Level Security). This replaces the current local-only Zustand+AsyncStorage
model with a real multi-user backend. The pure scoring engine in `src/core` stays the
source of truth for *computing* the score — it just reads/writes Supabase instead of
device storage.

## Goal & guiding principle
**One athlete = one source of truth, many viewers.** Each athlete has one account, one
daily log, one Athlete Score. Coaches, parents, and trainers are *linked viewers* — they
read the athlete's already-computed data; they never hold a copy and (with one exception)
never write it. This is the whole product thesis — *"is this athlete doing what they're
supposed to?"* — made multi-user, and it's also why oversight seats are cheap: the
expensive unit is the athlete (per-meal AI cost); a coach watching 50 athletes just reads
scores that were already computed.

## Roles & the core relationship
Many-to-many. One athlete can have a coach **and** a parent **and** a trainer at once; one
coach has many athletes; one trainer has many clients.

- **Coach = team-scoped.** Owns a team inside one org. Sees everyone on the team. Sets
  team-wide rules. Leaderboard scoped by competition mode.
- **Trainer = cross-org client book.** Owns a practice. Collects individual clients from
  *any* org (org-tagged). A client can also be on a school coach's roster — same underlying data.
- **Parent = single-athlete.** Linked to one (or few) athletes; read-only reports.

## Tables

### Identity
- **`profiles`** (1:1 with `auth.users`): `id` (uuid = auth uid, PK), `full_name`, `email`,
  `primary_role` (`athlete|parent|coach|trainer`), `created_at`. Every user has one.

### Orgs / teams / practices
- **`orgs`**: `id`, `name`, `type` (`school|club|independent`), `created_by`.
- **`teams`**: `id`, `org_id` → orgs, `name`, `sport`, `join_code` (unique, rotatable),
  `competition_mode` (`position|team|off`), `settings` (jsonb: `{tracked:{nutrition,recovery,
  hydration,weight,tasks}, checkin_questions:{energy,recovery,sleep,confidence,soreness,
  motivation}}` — drives which check-in sliders the athlete sees, already wired in the app),
  `created_by`.
- **`practices`**: `id`, `owner_id` → profiles (the trainer), `name`, `join_code` (unique,
  rotatable), `plan`.

### Link tables (the many-to-many spine — these are what RLS keys off)
- **`team_members`**: `team_id`, `athlete_id` → profiles, `position`, `status`
  (`active|invited|removed`), `joined_at`. *(athlete ↔ team)*
- **`team_staff`**: `team_id`, `staff_id` → profiles, `role` (`head_coach|assistant`),
  `status`. *(coach ↔ team)*
- **`practice_clients`**: `practice_id`, `client_id` → profiles, `org_label`, `status`,
  `last_active_at`. *(athlete ↔ practice / trainer)*
- **`guardianships`**: `athlete_id` → profiles, `guardian_id` → profiles, `relationship`,
  `status`. *(athlete ↔ parent)*

### Athlete data (the source of truth — written ONLY by the athlete)
- **`athlete_profiles`**: `athlete_id` (PK → profiles), `level`, `sport`, `position`,
  `base_height/weight/age`, `base_goal`, `targets` (jsonb: protein/cal/weight — coach-editable),
  `season_goal` (jsonb: start/target/deadline).
- **`days`**: `id`, `athlete_id`, `date`, `meals` (jsonb), `hydration_l`, `tasks` (jsonb),
  `quick_added`, `current_weight`, `checkin` (jsonb), **`score` (int), `grade`**, `computed_at`.
  One row per athlete per day — this is today's persisted `aos_day` slice plus the computed
  score. `score_history` (the cloud crew's feature) is just `select date, score from days`.
- **`meals`**: `id`, `athlete_id`, `day_date`, `type`, `photo_path` (Storage), `name`,
  `protein`, `kcal`, `carbs`, `fat`, `quality`, `detected` (jsonb), `note`, `logged_at`.
- **`checkins`**: `id`, `athlete_id`, `week`, `weight`, per-question scores, `notes`,
  `submitted_at`, `ai_summary`.

### Messaging
- **`threads`**: `id`, `athlete_id`, `counterpart_id` → profiles (coach/parent/trainer).
- **`messages`**: `thread_id`, `sender_id`, `text`, `sent_at`.

## Join-code flow (how the graph gets built)
Mirrors the onboarding the app already has:
1. **Coach** creates a team → gets `join_code` (e.g. `EAGLES24`). Shares it.
2. **Athlete** enters the code in the onboarding **Connect** step → `team_members` row
   (`status` = `active`, or `invited` if the team requires coach approval). Athlete's invite
   toggles (coach/parent/trainer/nutritionist) seed the relationships they opt into.
3. **Trainer** creates a practice → code (`APEX01`) → client enters it → `practice_clients` row.
4. **Parent** enters the athlete/coach invite code → resolves to the athlete card ("Jihad
   Carter · Found" in the app) → `guardianships` row.
Codes are rotatable (rotate = new code, old links stay) and revocable per-link.

## Row-Level Security (the security spine)
Every athlete-data read is gated by an **active link**. Implement with `SECURITY DEFINER`
helper functions, then reference them in policies:

```sql
-- helpers (security definer, search_path locked)
is_self(athlete uuid)        := auth.uid() = athlete
is_team_coach_of(athlete)    := exists (select 1 from team_members m
                                  join team_staff s on s.team_id = m.team_id
                                  where m.athlete_id = athlete and m.status='active'
                                    and s.staff_id = auth.uid() and s.status='active')
is_trainer_of(athlete)       := exists (select 1 from practice_clients pc
                                  join practices p on p.id = pc.practice_id
                                  where pc.client_id = athlete and pc.status='active'
                                    and p.owner_id = auth.uid())
is_guardian_of(athlete)      := exists (select 1 from guardianships g
                                  where g.athlete_id = athlete and g.guardian_id = auth.uid()
                                    and g.status='active')
can_view(athlete)            := is_self(a) or is_team_coach_of(a)
                                  or is_trainer_of(a) or is_guardian_of(a)
```

Policy intent per table:
- **`days`, `meals`, `checkins`** — `SELECT`: `can_view(athlete_id)`. `INSERT/UPDATE/DELETE`:
  `is_self(athlete_id)` ONLY. Overseers are strictly read-only on logs (accountability:
  athletes can't hide, overseers can't fake).
- **`athlete_profiles`** — `SELECT`: `can_view`. `UPDATE`: `is_self` for most fields;
  **coach may update `targets`/`season_goal`** (the "Adjust goals" action) via a column-scoped
  policy or an RPC.
- **`teams.settings`** — `SELECT`: team members + staff. `UPDATE`: `team_staff` only (coach
  configures tracked metrics + check-in questions; athletes read them).
- **`team_members` / `practice_clients` / `guardianships`** — manageable by the owning staff
  (`team_staff` / practice owner) and visible to the athlete for their own links.
- **`profiles`** — self full access; linked users read basic fields (name/role) only.
- **`messages`** — readable/writable by the two thread participants.

The athlete's score is computed client-side by `src/core` and stored on `days.score`;
everyone authorized reads it. (Optional hardening: a Postgres/edge function recomputes from
the raw day slice on write so a tampered client can't post a fake score — keep the pure TS
engine as the canonical formula either way.)

## Realtime
Coach/trainer dashboards subscribe to `days` (RLS-filtered to their roster) → roster scores,
compliance, and the Needs-Attention panel update live as athletes log. Athlete screens
subscribe to their own `days`/`meals` row for cross-device sync.

## Storage
Bucket **`meal-photos`**, path `{athlete_id}/{date}/{meal_id}.jpg`. Storage RLS: write =
`is_self`; read = `can_view`. Downsample client-side before upload (cost + bandwidth — see
the meal-AI cost note in the model-choice discussion).

## Scaling the oversight UX (already designed for this)
- Coach with 50+ athletes: the **Needs-Attention** panel is the triage surface (at-risk
  float to top); roster sorts/filters by score / compliance / position; leaderboard segments
  by position group.
- Trainer across orgs: org-tagged client list + **Needs-Follow-Up** (churn risk) + nudge
  actions; KPIs aggregate the book.
- Both reuse the SAME athlete/client detail screen (`PersonDetail`) + the SAME scoring engine
  — only the framing differs (team standings vs client retention).

## Migration from the current local-only app
- `src/store/useStore` gains a **sync layer**: hydrate from Supabase for the signed-in
  athlete, write day/meal/checkin mutations through to Postgres, keep AsyncStorage as an
  offline cache. The `aos_day` slice maps 1:1 to a `days` row.
- `src/core` is **unchanged** — it stays the pure scoring engine; the store feeds it DB data
  instead of seed data.
- Role views (Coach/Parent/Trainer) swap their seeded `ROSTER`/`TRAINER_CLIENTS` constants
  for RLS-filtered queries; the components don't change.
- Onboarding's code-entry steps become real `join_code` lookups + link-row inserts.

## Out of scope for this spec (separate phase-2 items)
- Real Claude meal-photo analysis (tiered model choice — Haiku/Sonnet on the hot path).
- Billing / subscription tiers (the Parent Plan $24.99 etc.).
- The 3 desktop dashboards (they reuse this exact backend + `src/core`).
- Auth UI polish, invite emails (drafting is fine; sending is its own integration).
