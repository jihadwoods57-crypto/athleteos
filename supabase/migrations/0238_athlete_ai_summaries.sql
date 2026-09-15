-- 0238 — the AI Nutritionist's standing read of one athlete, for the coach's Overview.
--
-- WHY (founder 2026-09-15): "In overview it should have an AI summary from the AI Nutritionist
-- that updates every 3 or 6 days, coach should have that option, or can refresh with a new
-- summary with a refresh button, only once every 2 days."
--
-- One row per athlete per BOOK (team or practice): an athlete with a team coach and a private
-- nutritionist gets one read per relationship, and neither reads the other's. The cadence is a
-- fact of that relationship, so it lives on the row. The row is written only by the
-- athlete-summary function under the service role (the 0046 'ai' discipline: AI prose is never
-- forgeable from a client); coaches and the athlete read it.
create table if not exists public.athlete_ai_summaries (
  athlete_id      uuid not null references public.profiles(id) on delete cascade,
  book_kind       text not null check (book_kind in ('team', 'practice')),
  book_id         uuid not null,
  summary         text not null default '',
  headline        text not null default '',
  watch           text not null default '',
  facts           jsonb not null default '{}'::jsonb,
  generated_at    timestamptz,
  next_at         timestamptz not null default now(),
  cadence_days    smallint not null default 6 check (cadence_days in (3, 6)),
  last_manual_at  timestamptz,
  requested_by    uuid references public.profiles(id) on delete set null,
  model           text,
  updated_at      timestamptz not null default now(),
  primary key (athlete_id, book_kind, book_id)
);
create index if not exists athlete_ai_summaries_due on public.athlete_ai_summaries (next_at);

alter table public.athlete_ai_summaries enable row level security;
-- Read: the athlete themselves (it is about them, and the athlete can read the thread the coach
-- reads) and anyone can_view lets in (the coach-side predicate every athlete row already uses).
drop policy if exists aas_read on public.athlete_ai_summaries;
create policy aas_read on public.athlete_ai_summaries
  for select using (athlete_id = auth.uid() or can_view(athlete_id));
-- The cadence is the coach's to change from the card, and only the cadence: a row-level update
-- policy plus a column grant. Everything else is the function's.
drop policy if exists aas_cadence on public.athlete_ai_summaries;
create policy aas_cadence on public.athlete_ai_summaries
  for update using (can_view(athlete_id) and athlete_id <> auth.uid())
  with check (can_view(athlete_id) and athlete_id <> auth.uid());
grant select on public.athlete_ai_summaries to authenticated;
grant update (cadence_days, next_at) on public.athlete_ai_summaries to authenticated;

-- A coach chooses 3 or 6 days from the card. The next run is pulled forward if the new cadence
-- says the current read is already stale, never pushed later than it already was.
create or replace function public.set_ai_summary_cadence(p_athlete uuid, p_book_kind text, p_book uuid, p_days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_days not in (3, 6) then raise exception 'cadence must be 3 or 6'; end if;
  if not can_view(p_athlete) or p_athlete = auth.uid() then raise exception 'not authorized for this athlete'; end if;
  insert into athlete_ai_summaries (athlete_id, book_kind, book_id, cadence_days, next_at)
    values (p_athlete, p_book_kind, p_book, p_days, now())
  on conflict (athlete_id, book_kind, book_id) do update
    set cadence_days = excluded.cadence_days,
        next_at = least(athlete_ai_summaries.next_at, coalesce(athlete_ai_summaries.generated_at, now()) + make_interval(days => p_days)),
        updated_at = now();
end; $$;
revoke execute on function public.set_ai_summary_cadence(uuid, text, uuid, int) from public, anon;
grant execute on function public.set_ai_summary_cadence(uuid, text, uuid, int) to authenticated;

-- The hourly cron, installed the 0222 way: the URL and the key never enter this file. The founder
-- runs, once, against prod:
--   select schedule_athlete_summary('https://<ref>.supabase.co/functions/v1/athlete-summary', '<ATHLETE_SUMMARY_CRON_KEY>');
create or replace function public.schedule_athlete_summary(fn_url text, cron_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'athlete-summary';
  perform cron.schedule(
    'athlete-summary',
    '20 * * * *',
    format(
      $job$ select net.http_post(url := %L, headers := jsonb_build_object('x-summary-key', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb); $job$,
      fn_url, cron_key
    )
  );
end; $$;
revoke execute on function public.schedule_athlete_summary(text, text) from public, anon, authenticated;
