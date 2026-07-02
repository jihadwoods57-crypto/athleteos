-- OnStandard — push notification device tokens (coach→athlete push).
-- Stores each user's Expo push token(s) so a coach's nudge can reach a closed phone. The
-- token is captured on the device after notification permission is granted and upserted via
-- register_device_token. The actual send is the `send-push` edge function (service-role reads
-- these tokens + calls Expo's push API); a client can only read/write its OWN tokens.
--
-- GUARDRAIL: authored only; the founder applies it at go-live (like 0004+).

create table if not exists device_tokens (
  user_id     uuid not null references profiles(id) on delete cascade,
  token       text not null,
  platform    text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, token)
);

alter table device_tokens enable row level security;
create policy dt_rw on device_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Upsert the caller's own push token (SECURITY DEFINER so it's a single safe entry point).
create or replace function register_device_token(tok text, plat text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(trim(tok), '') = '' then return; end if;
  insert into device_tokens (user_id, token, platform, updated_at)
  values (auth.uid(), tok, plat, now())
  on conflict (user_id, token) do update set platform = excluded.platform, updated_at = now();
end; $$;
