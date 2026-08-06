-- 0184 — Coach Marketplace core schema: applications, credentials, listings, agreements, reports.
--
-- The role-model law (founder decision): an OnStandard Coach IS a practice owner. There is no new
-- role, no new link table — clients attach via practice_clients exactly like trainer clients, chat
-- rides threads, payouts ride Connect. These tables only add what a marketplace genuinely adds:
-- who applied, what we verified, what the directory shows, what the client agreed to, and who
-- complained.
--
-- NAMING LAW: this is coach_marketplace_applications — a person applying TO OnStandard.
-- trainer_applications (0114) means the OPPOSITE (a client applying to a trainer). Never mix them.

-- ================================================================ applications
create table if not exists public.coach_marketplace_applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade unique,
  status        text not null default 'draft'
                check (status in ('draft','submitted','under_review','info_needed','approved','rejected')),
  legal_name    text not null default '',
  display_name  text not null default '',
  bio           text not null default '',
  experience    text not null default '',
  -- categories the applicant WANTS. What they GET lives on coach_listings.categories, set only by
  -- the approval RPC. v1 set: accountability (no credential) + cpt / snc (doc-verified).
  categories    text[] not null default '{accountability}'
                check (categories <@ array['accountability','cpt','snc']),
  style         text not null default '',
  languages     text[] not null default '{}',
  timezone      text not null default '',
  capacity      int  not null default 10 check (capacity between 1 and 100),
  -- agreement acknowledgements, stamped at submit: {scope: ts, no_solicitation: ts, safeguarding: ts}
  agreements    jsonb not null default '{}'::jsonb,
  submitted_at  timestamptz,
  reviewed_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists cma_status_idx on public.coach_marketplace_applications (status, submitted_at);

alter table public.coach_marketplace_applications enable row level security;
revoke all on table public.coach_marketplace_applications from anon, authenticated;
-- Applicant reads their own row. ALL writes go through definer RPCs (0185) so status can never be
-- client-asserted — no insert/update grant at all.
grant select on public.coach_marketplace_applications to authenticated;
drop policy if exists cma_own_read on public.coach_marketplace_applications;
create policy cma_own_read on public.coach_marketplace_applications
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------- internal review notes
-- Separate table (not a column) because RLS is row-level: the applicant must NEVER read these,
-- and a column filter can't express that. No authenticated grants — admin RPCs only.
create table if not exists public.coach_application_notes (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references coach_marketplace_applications(id) on delete cascade,
  author_id      uuid references auth.users(id) on delete set null,
  note           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists can_app_idx on public.coach_application_notes (application_id, created_at);
alter table public.coach_application_notes enable row level security;
revoke all on table public.coach_application_notes from anon, authenticated;

-- ================================================================ credentials
-- One row per claimed credential (cpt / snc). The doc lives in the private coach-credentials
-- bucket under the applicant's own folder. Status is writable ONLY by the admin verify RPC —
-- there is no update grant, so self-approval is structurally impossible, not just policy-blocked.
create table if not exists public.coach_credentials (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references coach_marketplace_applications(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade,
  category       text not null check (category in ('cpt','snc')),
  title          text not null default '',          -- e.g. "NASM-CPT", "CSCS"
  doc_path       text not null,                     -- {user_id}/{ts}-{name} in coach-credentials
  status         text not null default 'submitted' check (status in ('submitted','verified','rejected')),
  verified_by    uuid references auth.users(id) on delete set null,
  verified_at    timestamptz,
  review_note    text not null default '',
  created_at     timestamptz not null default now(),
  unique (application_id, category)
);
alter table public.coach_credentials enable row level security;
revoke all on table public.coach_credentials from anon, authenticated;
grant select, insert, delete on public.coach_credentials to authenticated;
drop policy if exists cc_own_read on public.coach_credentials;
create policy cc_own_read on public.coach_credentials
  for select using (user_id = auth.uid());
-- insert/delete only against your own draft-stage application, always starting at 'submitted'
drop policy if exists cc_own_insert on public.coach_credentials;
create policy cc_own_insert on public.coach_credentials
  for insert with check (
    user_id = auth.uid() and status = 'submitted' and verified_by is null
    and exists (select 1 from coach_marketplace_applications a
                where a.id = application_id and a.user_id = auth.uid()
                  and a.status in ('draft','info_needed'))
  );
drop policy if exists cc_own_delete on public.coach_credentials;
create policy cc_own_delete on public.coach_credentials
  for delete using (
    user_id = auth.uid() and status = 'submitted'
    and exists (select 1 from coach_marketplace_applications a
                where a.id = application_id and a.user_id = auth.uid()
                  and a.status in ('draft','info_needed'))
  );

-- ---------------------------------------------------------------- credential documents bucket
insert into storage.buckets (id, name, public)
values ('coach-credentials', 'coach-credentials', false)
on conflict (id) do nothing;

-- Policies can't call is_platform_admin() (execute revoked from authenticated since 0037), so the
-- admin read gets its own tiny probe with execute granted — it only ever reveals your OWN adminness.
create or replace function public.mkt_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
     and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$$;
grant execute on function public.mkt_is_admin() to authenticated;

drop policy if exists coach_creds_own_write on storage.objects;
create policy coach_creds_own_write on storage.objects for insert with check (
  bucket_id = 'coach-credentials' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists coach_creds_read on storage.objects;
create policy coach_creds_read on storage.objects for select using (
  bucket_id = 'coach-credentials'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.mkt_is_admin())
);
drop policy if exists coach_creds_own_delete on storage.objects;
create policy coach_creds_own_delete on storage.objects for delete using (
  bucket_id = 'coach-credentials' and (storage.foldername(name))[1] = auth.uid()::text
);

-- ================================================================ listings (the directory row)
-- Created ONLY by the admin approval RPC. Public reads go through definer RPCs (0185) that
-- project approved fields — authenticated users can only select their own row directly.
create table if not exists public.coach_listings (
  practice_id    uuid primary key references practices(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade unique,
  slug           text not null unique,              -- server-minted from display name + entropy; never the legal name
  display_name   text not null,
  categories     text[] not null default '{accountability}'
                 check (categories <@ array['accountability','cpt','snc']),
  headline       text not null default '',
  bio            text not null default '',
  style_tags     text[] not null default '{}',
  languages      text[] not null default '{}',
  timezone       text not null default '',
  capacity       int  not null default 10 check (capacity between 1 and 100),
  published      boolean not null default false,
  suspended      boolean not null default false,    -- admin-only; wins over published everywhere
  suspend_reason text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.coach_listings enable row level security;
revoke all on table public.coach_listings from anon, authenticated;
-- Column-split update grant (the 0103 pattern): the coach edits presentation + publish, but can
-- NEVER touch categories (verified scope), suspended, slug, or capacity ceiling ownership fields.
grant select on public.coach_listings to authenticated;
grant update (display_name, headline, bio, style_tags, languages, timezone, capacity, published, updated_at)
  on public.coach_listings to authenticated;
drop policy if exists cl_own_read on public.coach_listings;
create policy cl_own_read on public.coach_listings
  for select using (user_id = auth.uid());
drop policy if exists cl_own_update on public.coach_listings;
create policy cl_own_update on public.coach_listings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ================================================================ agreements (legal record)
-- Written by the stripe webhook (service role) at hire. Survives the relationship: profile/practice
-- FKs go null on delete but the row — tier, price, version, timestamp — stays.
create table if not exists public.coach_agreements (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references profiles(id) on delete set null,
  practice_id       uuid references practices(id) on delete set null,
  tier              text not null check (tier in ('essential','daily','high_touch')),
  price_cents       int not null,
  agreement_version text not null,
  -- webhook idempotency: one agreement per checkout session, no matter how often Stripe retries
  stripe_checkout_session_id text unique,
  created_at        timestamptz not null default now()
);
create index if not exists ca_client_idx on public.coach_agreements (client_id, created_at desc);
alter table public.coach_agreements enable row level security;
revoke all on table public.coach_agreements from anon, authenticated;
grant select on public.coach_agreements to authenticated;
drop policy if exists ca_own_read on public.coach_agreements;
create policy ca_own_read on public.coach_agreements
  for select using (client_id = auth.uid());

-- ================================================================ reports (safety intake)
create table if not exists public.coach_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references profiles(id) on delete set null,
  practice_id  uuid references practices(id) on delete set null,
  reason       text not null check (reason in ('scope','conduct','solicitation','spam','other')),
  detail       text not null default '',
  status       text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  resolution   text not null default '',
  resolved_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists cr_status_idx on public.coach_reports (status, created_at);
alter table public.coach_reports enable row level security;
revoke all on table public.coach_reports from anon, authenticated;
grant select, insert on public.coach_reports to authenticated;
drop policy if exists cr_own_read on public.coach_reports;
create policy cr_own_read on public.coach_reports
  for select using (reporter_id = auth.uid());
drop policy if exists cr_own_insert on public.coach_reports;
create policy cr_own_insert on public.coach_reports
  for insert with check (reporter_id = auth.uid() and status = 'open'
                         and resolution = '' and resolved_by is null);

-- ================================================================ offers grow a tier
-- Marketplace plans ARE offers (cadence 'month') tagged with the standard tier, so checkout,
-- webhooks, renewals, funded premium (0166) and refunds all ride the existing rails untouched.
alter table public.offers add column if not exists tier text
  check (tier is null or tier in ('essential','daily','high_touch'));
