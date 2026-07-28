-- OnStandard — per-day completion store for standing NON-MEAL check requirements (handoff Section 6:
-- multi-domain execution). The requirements engine already models lift/custom/hydration/weigh items,
-- but the athlete could only complete meals + one-off assignments. This adds a small per-day map of
-- {requirement_id: true} for the coach's standing `check` items (lift/custom) the athlete taps done.
--
-- TRACKED, NOT SCORED (founder decision 2026-07-21): these completions are visible to the coach (they
-- ride into days.tasks via the exec task provider) but do NOT feed the deterministic score — the
-- parity-locked scoring core reads meals/checkin/commitment only, never this column. Additive +
-- idempotent; RLS + grants inherit from the days table (athlete writes their own row).

alter table days add column if not exists checked_tasks jsonb not null default '{}'::jsonb;
