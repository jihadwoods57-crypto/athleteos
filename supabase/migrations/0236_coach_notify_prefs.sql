-- 0236 — the coach's own notification switches, where the server can read them.
--
-- WHY. A coach, trainer or dietitian could not be told the moment an athlete logged (send-push
-- kept 'meal_logged' as a silent bell row), was never told about a weigh-in, a check-in, a
-- training log or a roll-call answer, and was never told when an athlete wrote in the
-- season-long nutrition chat. The founder wants all three (2026-09-15). The pushes are sent by
-- send-push and meal-miss-escalation under the service role, so the switches that govern them
-- must live server-side: one jsonb on profiles, the same shape 0221 used for quiet hours.
--
-- Keys the functions read (absent = on): onLog, onMessage, onLate, onClosing. The client mirrors
-- its coach notification preferences into this column (state.js serverPrefPatch).
alter table public.profiles add column if not exists coach_notify jsonb not null default '{}'::jsonb;

-- Self-update only; the authenticated role already updates its own profiles row for the quiet
-- hour columns (0221) under the same policy, so no new policy is needed. Column-level grants are
-- restated because this project grants profiles columns explicitly (see the table-grants gotcha).
grant select (coach_notify) on public.profiles to authenticated;
grant update (coach_notify) on public.profiles to authenticated;
