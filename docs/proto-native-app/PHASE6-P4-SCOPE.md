# Phase 6 — Priority 4 scope: wire the coach / trainer / parent roles to real data

**Status:** scoping only (no code changed for P4). Produced by reading the RN app's real
Supabase layer (`src/lib/supabase/queries.ts` = the `db.*` seam, `src/screens/roles/*`,
`src/store/*`) and the migrations/RLS. Priorities 1–3 (the athlete surface) are already honest;
this document is the plan for the remaining role wiring behind the "all four roles real before
App Store" gate.

**Governing principle (unchanged):** the proto runs `supabase-js` **inside the WebView**; RLS is
the real authz. So P4 = **sign in as the coach/trainer/parent user and call the exact same tables
and RPCs the RN `db.*` layer calls** — mirror them, invent no new endpoints. The proto already has
the client (`window.sb`) and session (auth in `state.js`).

---

## 0. PRIME GATE — confirm which migrations are actually applied (do this first)

Every coach/trainer/parent feature depends on tables/RPCs that are **authored-but-not-applied** in
the repo (each carries a "GUARDRAIL: authored only … founder applies at go-live" banner):
`0004+`, `0011–0014`, `0022–0025`, `0032`, `0033`, `0034`, `0036`, `0038`, `0039`, `0040`, `0043`,
`0046`. If the live project only has `0001–0003, 0005–0007, 0010, 0015–0021, 0026–0031, 0037`,
then `team_roster`, `meal_comments`, `trust_passes`, `meal_plans`, `coach_views`, `org_memberships`
and the membership-sync triggers **do not exist yet** and nothing below can be wired.

**Action:** before any P4 code, confirm the applied set against the live DB (a founder task — we
must not apply migrations from the cloud). Also verify `0036_fix_table_grants.sql` is applied —
without it `meal_plans`/`plan_assignments` writes fail with `42501` even though the RLS looks right.
Everything below assumes the coach/roster/comment/trust-pass migrations are live.

---

## 1. Two prerequisite gaps that block role wiring

### 1a. The athlete side never writes the `meals` table (blocks coach review + comments)
The proto's meal loop writes macros into `days.checkin.slotMacros` (via `pushDay` → `days` upsert)
and uploads the photo to storage, but **never inserts rows into the `meals` table**. The RN coach
review reads `meals` (`fetchRecentMeals` → `meals.select('*').eq('athlete_id',…)`) and
`meal_comments.meal_id` FKs `meals(id)`. So **coach meal-review and coach↔athlete comments cannot be
wired until the athlete's `logMeal` also inserts a real `meals` row** (mirror RN
`insertMeal`/`mapMealToRow`, `src/store/mealSync.ts:91-120`; columns: `id, athlete_id, day_date,
type, photo_path, name, protein, kcal, carbs, fat, quality, detected, note, logged_at`). Storage
path is already `{userId}/{date}/{key}.jpg`; store it as `meals.photo_path`.
→ **This is a P3.5 athlete-side slice that must land before coach comments.**

### 1b. The coach view assumes the logged-in user is the athlete
`coach.js` renders "J. Woods" as the reviewed athlete and derives the roster "you" row from
`S.score`/`S.metCount` (the *athlete's* live state). For a **real signed-in coach**, the logged-in
identity is the coach (not an athlete), and the roster is their real team. The boot gate already
routes a coach to `#coach` (`routeForRole`), so the fix is to make the coach screens read a
**coach-scoped roster** (below), and drop the "you = J. Woods" special-casing entirely.

---

## 2. Real backend map (what each proto surface wires to)

Everything athlete-name-bearing is a **`SECURITY DEFINER` RPC**, not a table/view (there are **no
SQL views** in the schema). Call via `sb.rpc('name', {...})`. Reads are plain `.select()` gated by
RLS `can_view(athlete_id)`; the proto adds **no** explicit coach-id filters.

| Proto surface (now, fake) | Real source | Kind | RLS / gate |
|---|---|---|---|
| `S.roster` (hardcoded 6) | `team_roster({team})` + `days.select('athlete_id,date,score,grade,tasks').in(athlete_id)` | RPC + table | `is_team_staff(team)`; `days` read `can_view` |
| coach's teams | `fetchMyTeams` → `teams.select('id,name')` | table | RLS = own teams |
| pending join requests | `pending_team_requests({team})` | RPC | `is_team_staff` |
| approve / decline athlete | `team_members.update({status:'active'})` / `.delete()` | table | `is_team_staff(team_id)` |
| coach→athlete day review | `days` row + `fetchRecentMeals(athleteId, since)` → `meals` | table | `can_view(athlete_id)` |
| "coach saw your day" | `coach_views.upsert({athlete_id,viewer_id,date,viewer_name,seen_at})` | table | `viewer_id=self AND can_view` (0043) |
| **coach comment** (`RT.coachComments`) | `meal_comments.insert({meal_id,athlete_id,author_id,role:'coach',text})` + `send-push` | table + edge | insert: self-author + meal∈athlete + `can_view`; needs 1a |
| meal photo in review | `storage.from('meal-photos').createSignedUrl(path,3600)` | storage | `can_view((foldername)[1]::uuid)` |
| **plan / targets** (`publishPlanUpdate`) | `coach_set_goals({athlete,new_targets,new_season_goal})` — writes `athlete_profiles.targets` `{protein,calories,weight,profile}` | RPC | `is_team_coach_of OR is_trainer_of` |
| trust pass grant / end | `grant_trust_pass({p_athlete,p_length})` / `end_trust_pass({p_athlete})` | RPC | `is_team_coach_of`; eligibility = photo-log days ≥7 (0039) |
| **nudge / notify** (`trainerNote`, comment ping) | `send-push` edge fn `{athlete_id,title,body}` | edge | server `can_view` |
| trainer client roster | `practice_roster({practice})` + `fetchMyPractices` + `days` | RPC + table | `owns_practice` |
| trainer pending clients | `pending_practice_requests({practice})`, approve/decline `practice_clients` | RPC + table | `owns_practice` |

**No realtime** — the RN app refetches on mount/after-action (`useEffect`). Mirror that; add
`sb.channel(...)` only if we want live, which RN does not.

Row shapes to bind (from `database.types.ts`): `RosterDayRow = {athlete_id,date,score,grade,tasks}`,
`TeamRosterMember = {athlete_id,athlete_name,position,joined_at}`, `MealRow` (photo_path/macros/
quality/detected/note/logged_at), `MealCommentRow = {id,meal_id,athlete_id,author_id,role,text,
created_at}`, `AthleteProfileRow.targets = {protein,calories,weight,profile}`, `TrustPassRow =
{granted_date,length_days,ended_at}`.

---

## 3. Features the proto shows that have NO backend → cut or honest coming-soon

Do **not** fabricate a wiring for these; make them honest (the athlete surface already sets this bar):

- **"Assign a requirement" templates** (`assignReq`/`assignCustom`, `RT.assigned`: post-workout
  meal, supplements, body photo, sleep, custom). The RN app has no requirement-assignment feature;
  the real coach levers are **targets (`coach_set_goals`)**, **meal comments**, and **nudges**.
  `meal_plans`/`plan_assignments` tables exist (0032) but the RN app doesn't use them **and their
  RLS keys on `assigned_by=self` with no coach↔athlete link check** — wiring them would let any user
  assign to any athlete. → **Cut the assignment templates to an honest "coming soon," or re-point
  the coach's influence to targets + comments.**
- **Coach-controlled leaderboard scope** (`setSquadScope` → `comp_mode`). The enum exists but
  nothing reads/writes it; the leaderboard is athlete-only client math over roster scores. →
  **Honest "coming soon"; remove the coach Team/Room/Off control until a real mutation exists.**
- **Free-text "plan update" notes** (the composer in `coachPlan`) — no table. Real plan changes =
  `coach_set_goals`. → Keep the editor for **numeric targets** (wire to `coach_set_goals`); drop the
  free-text note or mark it non-persistent.
- **Parent view** — parent has **zero backend data path** in the RN app (a real guardian only gets a
  pending-link state; consent verification needs a service_role endpoint that doesn't exist). The
  whole digest / "5 of 7" / coach-note is showcase-only. → **Parent view becomes an honest "link
  pending / no shared data yet" state** until guardianship + consent are wired server-side. This is
  the least-wirable role.
- **Trainer** — the RN "All Clients / YOUR BOOK" list and the compliance-trend chart are seeded even
  in RN; only the live-client card + brief are real. → Wire the **real client roster + each client's
  day**, and make the hardcoded "recovery pattern" panels honest (they're not stored per-client).
- **Copilot / morning-brief narration** — deterministic reads over the roster, optionally rephrased
  by an AI edge call. Wire the deterministic part over the real roster; the AI narration is optional
  and must allowlist null origin (below).

---

## 4. Proto data-layer to add (mirror `db.*`)

Add one module, e.g. `proto/redesign-2026-07/js/roles.js`, that reuses `window.sb` and exposes the
same query/RPC signatures the RN `db.*` uses — thin wrappers, no new endpoints:

```
fetchMyTeams()                 → sb.from('teams').select('id,name')
fetchTeamRoster(teamId)        → sb.rpc('team_roster', { team: teamId })
fetchLinkedDaysSince(sinceISO) → sb.from('days').select('athlete_id,date,score,grade,tasks').gte('date', sinceISO)
pendingTeamRequests(teamId)    → sb.rpc('pending_team_requests', { team: teamId })
approveMember/declineMember    → sb.from('team_members').update({status:'active'})/.delete()
fetchRecentMeals(aid, since)   → sb.from('meals').select('*').eq('athlete_id',aid).gte('day_date',since)…
fetchMealComments(mealId)      → sb.from('meal_comments').select('*').eq('meal_id',mealId).order('created_at')
postMealComment(mealId,aid,author,role,text) → sb.from('meal_comments').insert({...})
signedMealPhotoUrl(path)       → sb.storage.from('meal-photos').createSignedUrl(path, 3600)
markDayViewed(aid,date,vid,vname) → sb.from('coach_views').upsert({...},{onConflict:'athlete_id,viewer_id,date'})
coachSetGoals(aid,targets)     → sb.rpc('coach_set_goals', { athlete:aid, new_targets:targets, new_season_goal:null })
grantTrustPass/endTrustPass    → sb.rpc('grant_trust_pass'|'end_trust_pass', {...})
nudgePush(aid,title,body)      → sb.functions.invoke('send-push', { body:{athlete_id:aid,title,body} })
fetchMyPractices/practiceRoster/pendingPracticeRequests/approveClient/declineClient  (trainer mirror)
```

Each returns `[]`/`null` on error and is best-effort (like `day.js`), so the UI degrades to an
honest empty state, never a fabricated one. Role screens (`coach.js`, `trainer` view, `parent`
view) then bind to these instead of `S.roster`/hardcoded arrays, and **refetch on mount / after each
mutation** (no realtime).

---

## 5. Edge-function CORS (from PLAN.md — must not be forgotten)

The WebView loads `file://` → requests present `Origin: null`. `supabase-js` REST/Auth/Storage work
(Supabase returns `*`), but the **custom edge functions must allowlist the null origin**:
- **`send-push`** (nudges + coach-comment pings) — used all over the coach/trainer path.
- **`analyze-meal`** — already used by the athlete loop.
JWT is the real authz; name this honestly in the review notes. Confirm the null-origin allowlist
before relying on nudges from the device.

---

## 6. Ordered implementation slices (each small, green, committable)

0. **(founder)** Confirm applied migrations + `send-push` null-origin allowlist. *(gate)*
1. **Athlete `meals` write** — `logMeal` also inserts a real `meals` row (+ `photo_path`). Mirrors
   RN `insertMeal`. *Prereq for coach review/comments.* Parity test stays green (scoring unchanged).
2. **Proto `roles.js` data layer** — the wrappers in §4, no UI change yet; unit-check importable.
3. **Coach roster (read)** — restructure `coach.js`: logged-in user is the coach; render the real
   roster from `team_roster` + linked `days` (score/grade/tasks); honest "not logged today" for
   members without a day row. Remove the "you = J. Woods" logic and `S.roster` demo.
4. **Coach → athlete review** — real per-athlete `days` + `fetchRecentMeals` proof; `markDayViewed`
   receipt on open; honest empties.
5. **Coach comments** — wire the meal-thread composer to `postMealComment(role:'coach')` + `send-push`;
   the athlete's meal-detail thread (already escaped in P2) reads `fetchMealComments`. Retire
   `RT.coachComments` local fake.
6. **Coach targets** — the plan editor writes `coach_set_goals`; athlete plan reflects real
   `athlete_profiles.targets`. Drop the free-text plan note (no backend) or mark non-persistent.
7. **Trust pass** — grant/end via RPC from the athlete-review screen (coach-only); the athlete Trust
   screen (currently honest-inactive) reads `fetchActiveTrustPass`.
8. **Join requests** — pending inbox (`pending_team_requests`) + approve/decline (`team_members`).
9. **Trainer** — mirror 3–5 via `practice_roster`/`practice_clients`; trainer "note" = `send-push`
   nudge; make the seeded pattern panels honest.
10. **Cut the no-backend fakes** — assignment templates, coach leaderboard scope, parent digest →
    honest coming-soon/pending states.
11. **Parent** — honest "link pending / no shared data" until guardianship + consent land server-side.

Slices 1–2 unblock everything; 3–6 are the core coach value; 7–8 round out coach; 9 is trainer;
10–11 are honesty cleanup for the unwirable parts.

## 7. Safety rules carried over
- **RLS is the authz** — never add service-role or bypass; a coach only sees `can_view` athletes.
- **Numbers never fabricated** — a member with no `days` row is "not logged," not a made-up score
  (note: `days.score` is client-computed, so it's the athlete's own number, not server-recomputed).
- **Category-2 escaping is now load-bearing** — coach/athlete text renders through `esc()` (done in
  P2); keep every new cross-user string escaped.
- **No migrations applied from the cloud; no EAS/ship** — code + the founder's go-live apply only.

## 8. Decisions needed from the founder
1. Which migrations are live right now? (gates the whole plan — §0.)
2. Assignment templates: **cut to coming-soon**, or invest in wiring `meal_plans`/`plan_assignments`
   (and add the missing coach-link RLS check)? Recommend cut for v1 — targets + comments + nudges
   are the real levers.
3. Parent role for v1: ship the **honest pending/empty** state (recommended, since there's no data
   path), or defer the parent role from the "all four roles" gate until guardianship is wired?
4. Is `send-push` deployed with the null-origin allowlist? (gates nudges from the device.)
