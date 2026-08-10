-- OnStandard — Per-tester demo accounts (2026-08-09). Ten beta testers need their own isolated
-- coach+athlete+trainer+client set instead of sharing scripts/seed-demo-accounts.sql's single set,
-- and a way to claim one without the founder hand-delivering credentials ten times. See
-- docs/superpowers/specs/2026-08-09-tester-demo-accounts-design.md for the full design.
--
-- SECURITY MODEL — same deliberate shape as 0191 (beta_board): RLS is ON with NO POLICIES and NO
-- grants to anon/authenticated. tester_sets holds ten PLAINTEXT production passwords — handing
-- them out is the entire point of this feature, so they must be readable, but nothing except the
-- service-role client (inside supabase/functions/tester-claim) may ever touch this table.
--
-- Forward-only, idempotent.

create table if not exists tester_sets (
  set_no              int primary key,
  password            text not null,
  email_coach         text not null,
  email_athlete       text not null,
  email_trainer       text not null,
  email_client        text not null,
  team_id             uuid,
  team_join_code      text,
  practice_id         uuid,
  practice_join_code  text,
  claimed_at          timestamptz,
  claimed_name        text,
  claimed_email       text,
  device_token        text,
  created_at          timestamptz not null default now()
);
alter table tester_sets enable row level security;

-- One claim per email. Partial (WHERE claimed_email is not null) so the nine-plus unclaimed rows
-- — every time the seed script re-runs, all ten start that way — never collide on a shared NULL.
create unique index if not exists tester_sets_claimed_email_idx
  on tester_sets (lower(claimed_email)) where claimed_email is not null;

revoke all on table tester_sets from anon, authenticated;

comment on table tester_sets is
  'Per-tester demo account handout (2026-08-09). Ten sets, ten claims. Service-role only: RLS on '
  'with no policies, by design — see this migration''s header. Plaintext passwords are load-bearing.';

-- ---------------------------------------------------------------------------------------------
-- claim_next_tester_set: the ONLY place a set gets assigned. FOR UPDATE SKIP LOCKED so two
-- testers tapping the claim link at the same instant cannot land on the same set — one gets the
-- next-lowest FREE row, the other moves on to the row after that, and neither blocks waiting on
-- the other's transaction. Returns an all-NULL row (not an error) when every set is taken; the
-- caller checks `set_no is null` to detect "exhausted". SECURITY DEFINER + revoked from everyone
-- but service_role, same posture as claim_ai_usage_key (0030) — only ever called from
-- tester-claim's service-role client.
-- ---------------------------------------------------------------------------------------------
create or replace function claim_next_tester_set(p_name text, p_email text, p_device text)
returns tester_sets
language plpgsql security definer set search_path = public as $$
declare r tester_sets;
begin
  update tester_sets
     set claimed_at = now(),
         claimed_name = p_name,
         claimed_email = lower(p_email),
         device_token = p_device
   where set_no = (
     select set_no from tester_sets
      where claimed_at is null
      order by set_no
      for update skip locked
      limit 1
   )
  returning * into r;
  return r;
end $$;

revoke execute on function claim_next_tester_set(text, text, text) from public, anon, authenticated;
grant  execute on function claim_next_tester_set(text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Ties each beta report to the tester's real prod accounts. Nullable: external TestFlight testers
-- post to the same board and have no set. This is a HINT, not an attestation — it arrives from the
-- browser and a determined visitor could forge it. Fine for a feedback board; nothing is
-- authorized on its basis.
-- ---------------------------------------------------------------------------------------------
alter table beta_posts add column if not exists tester_set int;

-- ROLLBACK:
--   alter table beta_posts drop column if exists tester_set;
--   drop function if exists claim_next_tester_set(text, text, text);
--   drop table if exists tester_sets;
