-- OnStandard — per-meal comment thread (Assistant Nutritionist build 2026-07-04).
--
-- The feedback loop that makes logging worth it: a coach/trainer taps a meal in the
-- athlete's profile, reviews the photo + AI read, and leaves a comment that lands in THAT
-- meal's thread — the same thread the athlete replies in. This is the app's first real
-- DELIVERED messaging, deliberately scoped to a meal (not general DMs): the conversation
-- lives on the plate it is about, and the minor-safety surface stays as small as the
-- existing can_view link graph.
--
-- RLS mirrors the 0043 coach_views discipline: the athlete reads/writes on their own
-- meals; a linked overseer (coach/trainer/parent via can_view) reads/writes on meals of
-- athletes they can already see. author_id is always the writer's own id — a comment can
-- never be forged in someone else's name.

create table meal_comments (
  id         uuid primary key default gen_random_uuid(),
  meal_id    uuid not null references meals(id) on delete cascade,
  -- Denormalized from the meal so RLS never needs a joined subquery on the hot path.
  athlete_id uuid not null references profiles(id) on delete cascade,
  author_id  uuid not null references profiles(id) on delete cascade,
  -- Who is speaking, for the bubble style. 'ai' rows are reserved for a future
  -- service-role writer; the client can only ever write athlete/coach rows (see checks).
  role       text not null check (role in ('athlete', 'coach', 'ai')),
  text       text not null check (char_length(text) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index meal_comments_meal on meal_comments (meal_id, created_at);
create index meal_comments_athlete on meal_comments (athlete_id, created_at);

alter table meal_comments enable row level security;

-- Read: the athlete themselves, or a linked overseer.
create policy meal_comments_read on meal_comments
  for select using (athlete_id = auth.uid() or can_view(athlete_id));

-- Write: always as yourself. An athlete writes 'athlete' rows on their own meals; a linked
-- overseer writes 'coach' rows on meals of athletes they can_view. The meal_id must really
-- belong to athlete_id (no cross-wiring a comment onto someone else's plate). Nobody
-- inserts 'ai' rows from the client.
create policy meal_comments_insert on meal_comments
  for insert with check (
    author_id = auth.uid()
    and exists (select 1 from meals m where m.id = meal_id and m.athlete_id = meal_comments.athlete_id)
    and (
      (role = 'athlete' and athlete_id = auth.uid())
      or (role = 'coach' and athlete_id <> auth.uid() and can_view(athlete_id))
    )
  );

-- Delete your own comment (a typo'd coach comment should be retractable); no updates —
-- an edited accountability trail is not a trail.
create policy meal_comments_delete_own on meal_comments
  for delete using (author_id = auth.uid());

grant select, insert, delete on meal_comments to authenticated;
grant select, insert, update, delete on meal_comments to service_role;
