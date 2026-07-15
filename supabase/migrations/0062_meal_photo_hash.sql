-- OnStandard — gallery integrity + richer meal analysis (founder direction 2026-07-15).
--
-- The "won't count toward your score — live captures only" policy is reversed: gallery photos
-- now SCORE, protected by a duplicate-photo integrity wall instead of a blanket exclusion.
--
-- Adds five columns to `meals`, all nullable so every existing row and every old client stays
-- valid with no backfill:
--   * photo_hash     — sha256 hex of the downscaled JPEG the client analyzed/uploaded. The
--                      unique partial index below is the server wall against logging the same
--                      photo twice (the cheating vector once gallery counts).
--   * source         — how the photo/plate was produced: 'live' | 'gallery' | 'manual' | 'label'.
--                      Transparency for the coach; never used to exclude from scoring.
--   * analysis       — the AI's detailed athlete-facing paragraph (analyze-meal `analysis`
--                      field). Persisted so the coach side + reloads render the same message.
--   * minutes_late   — minutes past the slot deadline at log time, written by the CLIENT
--                      (the athlete's local clock is the only honest source; the coach's device
--                      can't compare another athlete's UTC row to their local deadline). 0 = on
--                      time; null = unknown (pre-migration rows / old clients).
--   * photo_taken_at — EXIF DateTimeOriginal of a gallery pick, when present. Drives the
--                      "taken 2 days ago" staleness transparency badge; null when EXIF absent.
--
-- Forward-only, idempotent. RLS unchanged: meals_read / meals_write (0002) already gate these
-- columns by row.
--
-- GUARDRAIL: authored here; apply with `supabase db push` alongside 0001-0061.

alter table public.meals add column if not exists photo_hash text;
alter table public.meals add column if not exists source text;
alter table public.meals add column if not exists analysis text;
alter table public.meals add column if not exists minutes_late integer;
alter table public.meals add column if not exists photo_taken_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meals_source_chk') then
    alter table public.meals add constraint meals_source_chk
      check (source is null or source in ('live', 'gallery', 'manual', 'label'));
  end if;
  -- sha256 hex is exactly 64 lowercase hex chars; reject anything else so the unique index
  -- can't be dodged with garbage variants of the same hash.
  if not exists (select 1 from pg_constraint where conname = 'meals_photo_hash_chk') then
    alter table public.meals add constraint meals_photo_hash_chk
      check (photo_hash is null or photo_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meals_minutes_late_chk') then
    alter table public.meals add constraint meals_minutes_late_chk
      check (minutes_late is null or (minutes_late >= 0 and minutes_late <= 1440));
  end if;
end $$;

-- THE SERVER WALL: one photo, one log, per athlete. Insert of a reused hash fails with 23505;
-- the client pre-checks (check_photo_reuse below) so a legit athlete never hits this, and the
-- app treats a slipped-through 23505 as "log but flag, don't count".
create unique index if not exists meals_photo_hash_unique
  on public.meals (athlete_id, photo_hash) where photo_hash is not null;

-- Pre-analysis reuse check, auth.uid()-scoped: "has *I* already logged this exact photo?"
-- Security definer so it works regardless of select-policy shape, but it only ever reads the
-- CALLER's own rows — no cross-athlete leak surface.
create or replace function public.check_photo_reuse(p_hash text)
returns table (day_date date, meal_type text, logged_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select m.day_date, m.type as meal_type, m.logged_at
  from public.meals m
  where m.athlete_id = auth.uid()
    and m.photo_hash = p_hash
    and p_hash ~ '^[0-9a-f]{64}$'
  order by m.logged_at desc
  limit 5;
$$;

revoke all on function public.check_photo_reuse(text) from public;
grant execute on function public.check_photo_reuse(text) to authenticated;
