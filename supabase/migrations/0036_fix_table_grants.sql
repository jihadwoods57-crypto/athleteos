-- OnStandard — restore the table DML grants that RLS policies promise (audit 2026-07-02, item 4a)
--
-- THE BUG: 0013 revoked the default-privilege INSERT/UPDATE/DELETE for `authenticated` so that
-- FUTURE tables don't auto-inherit write access (a good hardening). 0018/0019/0020 correctly
-- re-added explicit grants for their tables. But 0027 (notifications) and 0032 (meal_plans &
-- co.) shipped with RLS write policies and NO matching grants — so the policy looks correct in
-- review while every write fails with 42501 (permission denied) at runtime. This is invisible
-- in code review precisely because the policy is right; only the privilege is missing.
--
-- LIVE IMPACT TODAY: notifications is applied to live (2026-07-02), so mark-notification-read
-- and mark-all-read (queries.ts:471,480 -> UPDATE notifications) currently fail on live. This
-- migration fixes that and pre-empts the identical trap for meal_plans before 0032 goes live.
--
-- Grants are aligned EXACTLY to each table's existing RLS policy surface (never broader): RLS
-- still decides which rows; these grants just let the governed operations execute. SELECT is
-- already auto-granted (0005's default; 0013 only revoked I/U/D), so it is not repeated here.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here. Founder applies per the
-- Phase 0 go-live doc. Must run AFTER 0027 and 0032 (both tables must already exist).

-- ---------------------------------------------------------------- notifications (0027)
-- Policies: notif_update (UPDATE own) + notif_delete (DELETE own). No INSERT policy — rows are
-- created server-side only via notify() — so INSERT is deliberately NOT granted.
grant update, delete on notifications to authenticated;

-- ---------------------------------------------------------------- meal plans (0032)
-- Policies meal_plans_author_all / plan_assignments_assigner_all / meal_templates_author_all
-- are `for all` with an author/assigner self-check — i.e. the data-layer contract is "the
-- author writes these rows directly." Grant the matching write privileges (RLS scopes them to
-- the author's own rows). device_tokens (0028) is intentionally omitted: its only write path is
-- the register_device_token SECURITY DEFINER RPC, which needs no direct authenticated grant.
grant insert, update, delete on meal_plans       to authenticated;
grant insert, update, delete on plan_assignments to authenticated;
grant insert, update, delete on meal_templates   to authenticated;
