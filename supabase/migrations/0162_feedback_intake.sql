-- OnStandard 0162 — the support pipeline gets a front door, and ideas get a lane.
--
-- 0125 built the whole support apparatus: support_tickets, support_ticket_events, a validated and
-- rate-limited create_support_ticket(), a founder queue that orders safety first and masks minors'
-- contact details, and per-ticket history. It is covered by the RLS suite.
--
-- Nothing in the app has ever called it. The only way a user could say anything was the
-- mailto: link in Settings, so the intake side of a fully-built, fully-audited pipeline sat unused
-- while feedback went to an inbox with no queue, no categories and no history. This migration adds
-- the one thing the pipeline was missing to accept product feedback, and the app grows the door.
--
-- 'idea' is a FIFTH category, added in BOTH places that enumerate them — the table's CHECK
-- constraint and the RPC's own guard. Changing one and not the other is a silent trap: the insert
-- would pass validation and then fail the constraint (or vice versa), and the failure surfaces to
-- the athlete as a generic error at the exact moment they tried to help.
--
-- Deliberately NOT in this migration: any notion of votes, scores or public visibility. An idea
-- board is a different product from a support queue, and Settings promises athletes that "there is
-- no team feed and no leaderboard" — a public, attributed list of what your teammates want is a
-- feed. When that board is built it needs its own privacy decision, not a column bolted on here.

begin;

-- ---------------------------------------------------------------- categories
-- Recreate the constraint rather than ALTER it: Postgres has no "add value to CHECK", and naming
-- the constraint explicitly means the next migration can find it instead of guessing at
-- support_tickets_category_check.
alter table public.support_tickets
  drop constraint if exists support_tickets_category_check;

alter table public.support_tickets
  add constraint support_tickets_category_check
  check (category in ('question', 'bug', 'billing', 'safety', 'idea'));

-- ---------------------------------------------------------------- intake
-- Identical to 0125's function except for the category list. Everything else is deliberately
-- preserved, because each line is load-bearing:
--   · auth.uid() required                    — no anonymous tickets
--   · subject 3..200, body <= 4000           — bounded storage, bounded admin rendering
--   · 5 tickets / hour / user                — the rate limit that makes this safe to expose in-app
--   · safety => priority 'urgent'            — routing a safeguarding report is not the client's job
--   · body into support_ticket_events        — the ticket carries its own history from creation
-- 'idea' takes the normal priority: it is product feedback, not a problem to triage.
create or replace function public.create_support_ticket(p_category text, p_subject text, p_body text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_recent int; v_cat text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_cat := coalesce(nullif(trim(p_category), ''), 'question');
  if v_cat not in ('question','bug','billing','safety','idea') then raise exception 'invalid category'; end if;
  if p_subject is null or length(trim(p_subject)) < 3 then raise exception 'subject too short'; end if;
  if length(p_subject) > 200 or length(coalesce(p_body, '')) > 4000 then raise exception 'too long'; end if;
  select count(*) into v_recent from support_tickets where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'rate limit: too many tickets in the last hour'; end if;
  insert into support_tickets (user_id, category, subject, priority)
    values (auth.uid(), v_cat, trim(p_subject), case when v_cat = 'safety' then 'urgent' else 'normal' end)
    returning id into v_id;
  insert into support_ticket_events (ticket_id, actor_id, kind, body)
    values (v_id, auth.uid(), 'created', left(coalesce(p_body, ''), 4000));
  return v_id;
end $$;

-- 0098's lesson: a dropped/recreated function loses its grants. create-or-replace keeps them, but
-- re-granting is idempotent and costs nothing next to an intake that silently 403s in production.
grant execute on function public.create_support_ticket(text, text, text) to authenticated;

-- ---------------------------------------------------------------- store review kill switch
-- The in-app star prompt is a NATIVE system modal (SKStoreReviewController / Play In-App Review).
-- It cannot be styled, cannot be counted, and iOS silently discards it after 3 per user per year —
-- so the one control worth having is the ability to stop asking without shipping a build.
--
-- Seeded default_on = TRUE, which is the opposite of this repo's usual "no row → off" stance, and
-- deliberately so. The prompt is already gated four ways in the client (a 7/30/100 streak milestone
-- only, the day must be on standard, at most one ask per 120 days per device, and no ask after any
-- error), AND the platform refuses to show it outside an App Store build — isAvailableAsync() is
-- false in TestFlight. A flag defaulting off would leave dead code that someone has to remember to
-- switch on during launch week, which is exactly when nobody remembers.
--
-- kill_switch stays FALSE. It is not a label for "this flag is a switch" — the evaluator reads it as
-- `if (flag.kill_switch) return false`, first in precedence, overriding default_on and every
-- allowlist. Seeding it true would have shipped a prompt that is silently, permanently off while
-- looking enabled. To stop asking, that is the single column to flip:
--   update feature_flags set kill_switch = true where name = 'store_review_enabled';
insert into public.feature_flags (name, description, default_on, kill_switch)
values ('store_review_enabled',
        'In-app App Store / Play rating prompt at streak milestones. kill_switch = true stops all asking.',
        true, false)
on conflict (name) do nothing;

commit;
