-- OnStandard — Trainer monetization wedge (handoff Section 10/16). The lead-gen loop: a trainer
-- builds offers + a PUBLIC acquisition page (dedicated projection, opaque slug), a prospect applies
-- from that page (anon), and the trainer works the applications from their in-app inbox. No in-app
-- payment in v1 (OnStandard Pay deferred) — the trainer converts + connects via the existing
-- practice join-code flow. Builds ON existing practices/practice_clients/owns_practice; nothing here
-- rebuilds identity or client-linking.
--
-- Security: owner writes are RLS-gated by owns_practice(); the two PUBLIC entry points are anon
-- SECURITY DEFINER RPCs that (a) read ONLY approved projection columns and (b) accept applications
-- behind a honeypot + per-practice rate guard, inserting via the definer into an RLS-locked table.
-- The trainer's private profile rows are NEVER serialized to the public page. Numbered 0114.

-- ================================================================ offers (a trainer's packages)
create table if not exists public.offers (
  id          uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  name        text not null,
  blurb       text not null default '',
  -- price is TRAINER-CONFIGURABLE; never a hard-coded platform price. Null = "contact for pricing".
  price_cents int,
  cadence     text not null default 'month' check (cadence in ('month','week','one-time','session')),
  features    text[] not null default '{}',
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists offers_practice on public.offers (practice_id);

-- ================================================================ public projection (approved fields only)
create table if not exists public.trainer_public_pages (
  practice_id uuid primary key references practices(id) on delete cascade,
  public_slug text unique,                              -- opaque, server-minted on publish; never the row id
  published   boolean not null default false,
  display_name text not null default '',
  headline    text not null default '',
  bio         text not null default '',
  specialty   text not null default '',
  cta_label   text not null default 'Apply to work with me',
  accent      text not null default 'teal',
  updated_at  timestamptz not null default now()
);

-- ================================================================ applications (inbound leads)
create table if not exists public.trainer_applications (
  id               uuid primary key default gen_random_uuid(),
  practice_id      uuid not null references practices(id) on delete cascade,
  offer_id         uuid references offers(id) on delete set null,
  applicant_name   text not null,
  applicant_contact text not null,
  message          text not null default '',
  status           text not null default 'new' check (status in ('new','accepted','declined')),
  source_slug      text,
  created_at       timestamptz not null default now()
);
create index if not exists trainer_applications_practice on public.trainer_applications (practice_id, created_at desc);

-- ---------------------------------------------------------------- RLS: owner CRUD only
alter table public.offers enable row level security;
alter table public.trainer_public_pages enable row level security;
alter table public.trainer_applications enable row level security;
revoke all on table public.offers, public.trainer_public_pages, public.trainer_applications from anon, authenticated;
-- new-table grants (0013 revoked defaults): the practice owner drives these via the app's authenticated role.
grant select, insert, update, delete on public.offers to authenticated;
grant select, insert, update, delete on public.trainer_public_pages to authenticated;
grant select, update on public.trainer_applications to authenticated;  -- NO insert: inserts only via the anon submit RPC (definer)

drop policy if exists offers_owner on public.offers;
create policy offers_owner on public.offers for all using (owns_practice(practice_id)) with check (owns_practice(practice_id));
drop policy if exists tpp_owner on public.trainer_public_pages;
create policy tpp_owner on public.trainer_public_pages for all using (owns_practice(practice_id)) with check (owns_practice(practice_id));
drop policy if exists ta_owner_read on public.trainer_applications;
create policy ta_owner_read on public.trainer_applications for select using (owns_practice(practice_id));
drop policy if exists ta_owner_update on public.trainer_applications;
create policy ta_owner_update on public.trainer_applications for update using (owns_practice(practice_id)) with check (owns_practice(practice_id));

-- ================================================================ owner RPC: publish / mint slug
create or replace function public.publish_trainer_page(p_practice uuid, p_publish boolean default true)
returns public.trainer_public_pages
language plpgsql volatile security definer set search_path = public as $$
declare v_row public.trainer_public_pages;
begin
  if not owns_practice(p_practice) then raise exception 'not authorized'; end if;
  -- Ensure a page row exists, then mint an opaque slug the first time it's published (never reuse the id).
  insert into public.trainer_public_pages (practice_id) values (p_practice) on conflict (practice_id) do nothing;
  update public.trainer_public_pages
     set published = coalesce(p_publish, true),
         -- opaque, non-sequential slug from gen_random_uuid (in public; avoids the extensions-schema
         -- search_path issue with pgcrypto's gen_random_bytes). 16 hex chars = 64 bits, ample for a lead page.
         public_slug = coalesce(public_slug, substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
         updated_at = now()
   where practice_id = p_practice
   returning * into v_row;
  return v_row;
end $$;
grant execute on function public.publish_trainer_page(uuid, boolean) to authenticated;

-- ================================================================ PUBLIC read: the projection (anon)
-- Returns ONLY approved projection columns + active offers, and ONLY for a published page. A private
-- profile row can never leak because this function selects a fixed column list from the projection table.
create or replace function public.public_trainer_page(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if p_slug is null or p_slug !~ '^[a-f0-9]{8,64}$' then return null; end if;   -- opaque-slug shape only
  select jsonb_build_object(
    'display_name', pp.display_name, 'headline', pp.headline, 'bio', pp.bio,
    'specialty', pp.specialty, 'cta_label', pp.cta_label, 'accent', pp.accent, 'slug', pp.public_slug,
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object('name', o.name, 'blurb', o.blurb, 'price_cents', o.price_cents,
                                          'cadence', o.cadence, 'features', o.features) order by o.sort, o.created_at)
      from offers o where o.practice_id = pp.practice_id and o.active), '[]'::jsonb)
  ) into v
  from trainer_public_pages pp
  where pp.public_slug = p_slug and pp.published;
  return v;  -- null when not found / unpublished
end $$;
revoke all on function public.public_trainer_page(text) from public;
grant execute on function public.public_trainer_page(text) to anon, authenticated;

-- ================================================================ PUBLIC submit: an application (anon)
-- Honeypot (p_hp non-empty → silent fake success), field clamps, and a per-practice hourly rate guard.
-- Inserts via the definer into the RLS-locked applications table; the client never touches the table.
create or replace function public.submit_trainer_application(
  p_slug text, p_name text, p_contact text, p_message text default '', p_offer text default null, p_hp text default ''
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_practice uuid; v_offer uuid; v_recent int;
begin
  if coalesce(p_hp, '') <> '' then return jsonb_build_object('ok', true); end if;   -- bot honeypot: pretend success
  if p_slug is null or p_slug !~ '^[a-f0-9]{8,64}$' then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
  select practice_id into v_practice from trainer_public_pages where public_slug = p_slug and published;
  if v_practice is null then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
  if length(trim(coalesce(p_name, ''))) = 0 or length(trim(coalesce(p_contact, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'name and contact are required');
  end if;
  -- per-practice hourly rate guard (abuse control on the public endpoint)
  select count(*) into v_recent from trainer_applications
    where practice_id = v_practice and created_at > now() - interval '1 hour';
  if v_recent >= 30 then return jsonb_build_object('ok', false, 'error', 'too many applications, try later'); end if;
  -- optional offer must belong to this practice
  if p_offer is not null then select id into v_offer from offers where id = p_offer::uuid and practice_id = v_practice; end if;
  insert into trainer_applications (practice_id, offer_id, applicant_name, applicant_contact, message, source_slug)
    values (v_practice, v_offer, left(trim(p_name), 120), left(trim(p_contact), 200), left(coalesce(p_message, ''), 1000), p_slug);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.submit_trainer_application(text, text, text, text, text, text) from public;
grant execute on function public.submit_trainer_application(text, text, text, text, text, text) to anon, authenticated;

-- ================================================================ flag (kill-switch discipline)
insert into public.feature_flags (name, description, default_on) values
  ('professional_v1', 'Trainer monetization wedge: offers, public acquisition page, applications', true)
on conflict (name) do nothing;
