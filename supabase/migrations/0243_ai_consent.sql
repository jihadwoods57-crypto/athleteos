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

-- ---------------------------------------------------------------- write: own row only
create or replace function public.set_ai_consent(p_consent boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_consent is null then
    raise exception 'an answer is required' using errcode = '22004';
  end if;
  update public.profiles set ai_consent = p_consent, ai_consent_at = v_at where id = v_uid;
  if not found then
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
