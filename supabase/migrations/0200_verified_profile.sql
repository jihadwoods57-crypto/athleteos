-- 0200: Verified Profile — the recruiter-facing public page (design:
-- docs/design/2026-08-11-verified-profile-design.md).
--
-- One row per athlete. The slug is server-minted entropy (the coach_listings 0184 precedent:
-- never the legal name), because the URL of a minor's public page must not be guessable from
-- their identity. The record window is [enabled_at, now] — the founder-approved all-or-nothing
-- contract: everything after enablement shows, nothing inside the window can be curated, and
-- unpublish removes the whole page. enabled_at never moves once set; re-enabling after an
-- unpublish keeps the original window, otherwise disable/re-enable would BE the curation door
-- this table exists to close.
--
-- Access model is the 0191 beta-board inversion of the usual grants gotcha: RLS on, ZERO
-- policies, explicit revoke. Every read and write goes through the verified-profile edge
-- function with the service role, because the readers (recruiters) have no session and the
-- writes (publish/unpublish) must enforce premium + minor-consent + 30-day checks that a
-- client-side policy cannot express. A grant to anon here would be a real hole.

create table verified_profiles (
  athlete_id       uuid primary key references profiles(id) on delete cascade,
  slug             text not null unique default encode(gen_random_bytes(9), 'hex'),
  enabled_at       timestamptz not null default now(),
  published        boolean not null default false,
  published_at     timestamptz,
  card_path        text,                -- storage object for the og:image unfurl card
  grace_started_at timestamptz,        -- premium lapsed: 7-day grace, then auto-unpublish
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index verified_profiles_slug on verified_profiles (slug) where published;

alter table verified_profiles enable row level security;
revoke all on table verified_profiles from public, anon, authenticated;

-- The page's accountability numbers reuse the ONE shared arithmetic (0138's accountability_raw:
-- ack 10 / arrival 30 / completion 60, unverified leaves the denominator). 0138 revoked it from
-- every client role on purpose; the service role needs it back explicitly so the edge function
-- is not re-implementing the weights.
grant execute on function public.accountability_raw(uuid, date, date) to service_role;

-- The unfurl card bucket. PUBLIC on purpose — Twitter/iMessage/Slack unfurlers hold no session,
-- so a signed URL can never serve an og:image. Nothing in the card is not already on the public
-- page it unfurls. png-only and small (a 1080x1350 card is ~room under 4 MB), and NO storage
-- policies: only the service role writes it (publish/refresh in the edge function), and public
-- read rides the bucket flag, so an authenticated client has no path in. The object path is
-- cards/<slug>.png — slug-keyed, so the athlete id never appears in a public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verified-cards', 'verified-cards', true, 4194304, array['image/png'])
on conflict (id) do nothing;
