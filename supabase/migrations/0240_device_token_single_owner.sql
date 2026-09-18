-- OnStandard — a push token belongs to ONE person: whoever is signed in on that phone now.
--
-- THE BUG (found 2026-09-18). register_device_token (0028) upserts on the primary key
-- (user_id, token) and never touches any OTHER user's row for the same token. An Expo push token
-- identifies a DEVICE, not a person, and it survives a sign-out. So every time someone signed out
-- and someone else signed in on the same phone, the table gained a second owner for that one
-- token and kept the first. On live prod today, one phone was registered to three different
-- accounts and another to two — which is not only wrong bookkeeping, it is a delivery bug and a
-- privacy leak both ways:
--
--   · the coach testing on a phone the athlete used still received the ATHLETE's pushes, and
--   · a nudge aimed at the athlete buzzed a phone that person no longer holds.
--
-- A founder testing "do I get a notification as the coach?" on a shared handset therefore saw
-- notifications addressed to the wrong role, or attributed the right one to the wrong account.
--
-- THE RULE: claiming a token takes it. The most recent sign-in on a device is the only truthful
-- owner of that device's token, so registering it deletes every other user's claim on it. Sign-out
-- already deletes the signed-out user's own row (state.js) when it knows the token; this closes
-- the case where it does not — a reinstall, a crash, a session that expired, or a device restored
-- from another person's backup.

-- Retire the historical duplicates: for each token, keep only the most recently updated claim.
delete from device_tokens d
  using device_tokens keep
 where d.token = keep.token
   and d.user_id <> keep.user_id
   and (keep.updated_at, keep.user_id) > (d.updated_at, d.user_id);

-- One owner per token, enforced by the database rather than by everyone remembering to clean up.
create unique index if not exists device_tokens_token_unique on device_tokens (token);

create or replace function register_device_token(tok text, plat text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(trim(tok), '') = '' then return; end if;
  -- Take the device from whoever held it last. SECURITY DEFINER makes this reachable even though
  -- RLS would never let the caller delete another person's row — which is the point: the caller
  -- is proving physical possession of the handset, and that is the only claim that matters here.
  delete from device_tokens where token = tok and user_id <> auth.uid();
  insert into device_tokens (user_id, token, platform, updated_at)
  values (auth.uid(), tok, plat, now())
  on conflict (user_id, token) do update set platform = excluded.platform, updated_at = now();
end; $$;

comment on function register_device_token(text, text) is
  'Claim this device''s push token for the calling user, taking it from any previous owner. A push '
  'token identifies a phone, not a person: the account signed in on it now is the only one that '
  'should receive its notifications (0240).';
