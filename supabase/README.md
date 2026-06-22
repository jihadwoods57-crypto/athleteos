# AthleteOS — Supabase (phase 2)

Multi-tenant backend for AthleteOS. Design: [`docs/specs/phase2-multitenant-backend.md`](../docs/specs/phase2-multitenant-backend.md).

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

## Wiring the app (next task, not done here)
- `src/store/useStore` gains a sync layer: hydrate the signed-in athlete from `days`/`meals`,
  write mutations through to Postgres, keep AsyncStorage as an offline cache.
- `src/core` is unchanged — it stays the pure scoring engine; the score it computes is written
  to `days.score`.
- Role views swap seeded `ROSTER` / `TRAINER_CLIENTS` for RLS-filtered queries.
- Onboarding code-entry steps call `join_team` / `join_practice`.
- Realtime: dashboards subscribe to `days` (RLS-filtered) for live roster updates.
