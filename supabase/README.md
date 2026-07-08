# OnStandard — Supabase (phase 2)

Multi-tenant backend for OnStandard. Design: [`docs/specs/phase2-multitenant-backend.md`](../docs/specs/phase2-multitenant-backend.md).

## Migrations (run in order)
- `migrations/0001_schema.sql` — enums, tables, indexes, profile auto-create trigger.
- `migrations/0002_rls.sql` — RLS helpers (`can_view`, `is_team_coach_of`, …), policies, and
  secure RPCs (`join_team`, `join_practice`, `coach_set_goals`).
- `migrations/0003_storage.sql` — `meal-photos` bucket + access policies.

## Apply
```bash
# local stack
supabase start
supabase db reset            # applies all migrations from scratch

# or push to a linked project
supabase link --project-ref <ref>
supabase db push
```

## Model in one line
One athlete owns their `days`/`meals`/`checkins` (only writer). Coaches/trainers/parents are
linked via `team_members` / `practice_clients` / `guardianships` and get **read-only** access
through the `can_view()` RLS gate. Coaches adjust goals + team settings (the only overseer
writes), via `coach_set_goals()` and the `teams.settings` policy.

## Wiring the app — scaffolded (keys later)

The integration layer is in place but **inert until keys exist**. With no
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` set, `isSupabaseConfigured`
is false, the client is null, and every data/auth call falls back to local mock data, so
the app runs exactly as it does today.

Scaffolded modules:
- `src/lib/supabase/client.ts` — env-driven client + `isSupabaseConfigured` flag + `requireSupabase()`.
- `src/lib/supabase/database.types.ts` — typed schema mirroring these migrations (swap for
  `supabase gen types typescript` output once the schema settles).
- `src/lib/supabase/auth.ts` — `signIn` / `signUp` / `signOut` / `currentUserId` (return
  `notConfigured` instead of throwing, so the mock flow can adopt them incrementally).
- `src/lib/supabase/queries.ts` — typed reads/writes + the `join_team` / `join_practice` /
  `coach_set_goals` RPCs; RLS does authorization, so a plain roster select is already scoped.
- `src/store/sync.ts` — `mapStateToDayRow` / `dayRowToState` / `pushDay` / `hydrateDay`.
  `src/core` stays the only scoring authority; `pushDay` writes the score `computeDerived` made.

### Go live (~15 min, when you're ready)
1. Create a Supabase project; run the three migrations (`supabase db push` or paste into the SQL editor).
2. Copy `.env.example` to `.env` and fill in the project URL + anon key (`.env` is gitignored).
3. Restart Metro so Expo picks up the new `EXPO_PUBLIC_*` vars.
4. Flip on the two hooks marked `TODO (go-live)` in `src/store/sync.ts`:
   hydrate the signed-in athlete after auth, and `pushDay` (debounced) after each mutating action.
5. Point the sign-in/create-account screens at `auth.signIn` / `auth.signUp`, and the role
   views at `db.fetchLinkedDays` (RLS-filtered) instead of the seeded `ROSTER` / `TRAINER_CLIENTS`.
6. Optional: `days`-table Realtime subscription for live roster updates.

## Edge-function CORS (web builds)

Every edge function (`analyze-meal`, `assist`, `food-lookup`, `plan-generate`) allowlists
browser origins via the `ALLOWED_ORIGINS` function secret (comma-separated). Native apps
send no `Origin` header and are unaffected. **A web build (including `expo start --web`)
is blocked with a CORS preflight failure unless its origin is listed.**

```bash
# example: local web dev + future production web origin
supabase secrets set ALLOWED_ORIGINS="http://localhost:8081,http://localhost:8082,https://app.onstandard.app"
```

Symptom when missing: the browser console shows "blocked by CORS policy … functions/v1/food-lookup",
and food search / copilot silently degrade (search shows the connection-error note; copilot falls
back to locally computed answers).
