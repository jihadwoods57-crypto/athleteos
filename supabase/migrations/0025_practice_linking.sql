-- OnStandard — linking feature, Stage 4: client ↔ trainer mirror.
-- Trainers have no school, so their discovery key is a unique @handle (plus the existing
-- shareable join code). This mirrors the coach flow: create_practice mints a practice +
-- code (the trainer side had join_practice but no creation path), a client requests to
-- join (pending), and the trainer approves (pending -> active) or declines. Pending rows
-- grant no access — is_trainer_of (0002) already requires status='active'.
--
-- GUARDRAIL: authored only; the founder applies it at go-live (like 0004+).

-- ---------------------------------------------------------------- practices: handle + discovery
alter table practices add column if not exists handle text;
alter table practices add column if not exists discoverable boolean not null default false;
-- Case-insensitive unique handle (the client-first discovery key).
create unique index if not exists practices_handle_lower
  on practices (lower(handle)) where handle is not null;

-- ---------------------------------------------------------------- create_practice (mirror of create_team)
-- A trainer creates their practice and gets a real, server-generated join code + optional
-- @handle. SECURITY DEFINER like create_team. gen_join_code() is defined in 0004.
create or replace function create_practice(
  practice_name text,
  practice_handle text default null,
  is_discoverable boolean default false
) returns text
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to create a practice';
  end if;
  new_code := gen_join_code();
  insert into practices (owner_id, name, join_code, handle, discoverable)
  values (auth.uid(), coalesce(nullif(practice_name, ''), 'My Practice'),
          new_code, nullif(practice_handle, ''), coalesce(is_discoverable, false));
  return new_code;
end; $$;

-- ---------------------------------------------------------------- discovery + resolve (safe cols only)
create or replace function find_practice_by_handle(h text)
returns table (id uuid, name text, trainer_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, (select pr.full_name from profiles pr where pr.id = p.owner_id)
  from practices p
  where lower(p.handle) = lower(h) and p.discoverable;
$$;

create or replace function resolve_practice_code(code text)
returns table (id uuid, name text, trainer_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, (select pr.full_name from profiles pr where pr.id = p.owner_id)
  from practices p
  where p.join_code = code;
$$;

-- ---------------------------------------------------------------- request + pending inbox
-- Client requests to join a discoverable practice → a 'pending' row for auth.uid().
create or replace function request_join_practice(practice uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'must be signed in to request to join';
  end if;
  if not exists (select 1 from practices p where p.id = practice and p.discoverable) then
    raise exception 'this practice is not open to join requests';
  end if;
  insert into practice_clients (practice_id, client_id, status, last_active_at)
  values (practice, auth.uid(), 'pending', now())
  on conflict (practice_id, client_id) do nothing;
  return practice;
end; $$;

-- Pending client requests for a practice, with the requester's name (the trainer can't
-- read a pending client's profile directly — the link isn't active). Gated to the owner.
create or replace function pending_practice_requests(practice uuid)
returns table (client_id uuid, client_name text, requested_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not owns_practice(practice) then
    raise exception 'not authorized for this practice';
  end if;
  return query
    select pc.client_id, p.full_name, pc.last_active_at
    from practice_clients pc join profiles p on p.id = pc.client_id
    where pc.practice_id = practice and pc.status = 'pending'
    order by pc.last_active_at desc nulls last;
end; $$;

-- NOTE: approve = `update practice_clients set status='active'` and decline = `delete`,
-- both already permitted to the practice owner by the pc_manage policy (0002) — no RPC.
