-- 0243: permission before a person's data reaches the third-party AI (2026-09-23).
--
-- App Store Review Guideline 5.1.2(i), November 2025 text: an app must "clearly disclose where
-- personal data will be shared with third parties, including with third-party AI, and obtain
-- explicit permission before doing so". Meal photos, thread messages and the athlete dossier
-- (goal, goal weight, position, allergies, the coach's standard) go to Anthropic (Claude). Until
-- now nothing in the app named the provider or asked.
--
-- THE ANSWER LIVES ON THE SERVER, because the server is what sends the data. Every edge function
-- that calls Anthropic with a person's data checks `has_ai_consent` for THAT person (the meal
-- owner, the athlete a summary is about, the caller whose words are sent) and skips the model when
-- it is not true. Cron jobs skip people without consent.
--
--   ai_consent     null  = never asked. Treated as NOT YET: no AI until the person continues.
--                  true  = the person tapped Continue on the consent sheet.
--                  false = the person tapped Not now (or turned it off in Settings > Privacy).
--   ai_consent_at  when the current answer was given.
--
-- Written ONLY through set_ai_consent (own row, SECURITY DEFINER), never by a direct update: there
-- is no update grant on these columns, so a client cannot write another person's answer and the
-- timestamp is always the server's clock. Readable by the owner through the existing self-select
-- policy (column grant below).

alter table public.profiles
  add column if not exists ai_consent boolean,
  add column if not exists ai_consent_at timestamptz;

comment on column public.profiles.ai_consent is
  'Permission to send this person''s data (meal photos, messages, profile facts the AI uses) to the third-party AI (Anthropic). null = not asked yet = no AI. Written only by set_ai_consent.';
comment on column public.profiles.ai_consent_at is
  'When the current ai_consent answer was given (server clock).';

-- This project grants profiles columns explicitly (see 0236). Select only; writes go through the RPC.
grant select (ai_consent, ai_consent_at) on public.profiles to authenticated;

-- A column grant cannot take away a TABLE-level update privilege, and some stacks carry one on
-- profiles (self-update policy). So the rule is a trigger: ai_consent / ai_consent_at change only
-- inside set_ai_consent, which raises a transaction-local flag first. A client update that touches
-- either column is refused; any other profile edit is untouched.
create or replace function public.tg_ai_consent_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.ai_consent is distinct from old.ai_consent or new.ai_consent_at is distinct from old.ai_consent_at)
     and coalesce(current_setting('app.ai_consent_write', true), '') <> 'on'
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'ai_consent is set only through set_ai_consent' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists ai_consent_guard on public.profiles;
create trigger ai_consent_guard before update on public.profiles
  for each row execute function public.tg_ai_consent_guard();

-- ---------------------------------------------------------------- write: own row only
create or replace function public.set_ai_consent(p_consent boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz := now();
  v_n int;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_consent is null then
    raise exception 'an answer is required' using errcode = '22004';
  end if;
  perform set_config('app.ai_consent_write', 'on', true);
  update public.profiles set ai_consent = p_consent, ai_consent_at = v_at where id = v_uid;
  get diagnostics v_n = row_count;
  perform set_config('app.ai_consent_write', 'off', true);
  if v_n = 0 then
    raise exception 'no profile' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ai_consent', p_consent, 'ai_consent_at', v_at);
end $$;

revoke all on function public.set_ai_consent(boolean) from public, anon;
grant execute on function public.set_ai_consent(boolean) to authenticated;

-- ---------------------------------------------------------------- read: the servers' one rule
-- True only for an explicit Continue. Null (never asked) and false both answer false. The edge
-- functions call this under the service role; it is not exposed to clients, who read their own
-- column instead (whether ANOTHER person agreed is not theirs to know).
create or replace function public.has_ai_consent(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select ai_consent from public.profiles where id = p), false);
$$;

revoke all on function public.has_ai_consent(uuid) from public, anon, authenticated;
grant execute on function public.has_ai_consent(uuid) to service_role;
