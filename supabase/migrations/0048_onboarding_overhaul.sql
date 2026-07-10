-- OnStandard — onboarding overhaul: identity, consent receipts, the commitment
-- (spec docs/superpowers/specs/2026-07-09-onboarding-overhaul-design.md).
--
-- GUARDRAIL: authored only; the founder applies this at go-live (like 0004+). Additive and
-- inert; the client writes these columns in SEPARATE best-effort calls, so it is safe on
-- either side of the apply. No policy changes: profiles_self_write (0002) covers the
-- profiles stamps, and the athlete_profiles self-write policies cover dob/standard.

alter table athlete_profiles add column if not exists dob date;
alter table athlete_profiles add column if not exists standard jsonb;
alter table profiles add column if not exists tos_accepted_at timestamptz;
alter table profiles add column if not exists tos_version text;
alter table profiles add column if not exists committed_at timestamptz;

comment on column athlete_profiles.dob is
  'Date of birth from signup. Under-13 is blocked client-side (COPPA); 13-17 proceed with no guardian dependency. Visible only within existing can_view() scope.';
comment on column athlete_profiles.standard is
  'Solo standard knobs {mealsPerDay, pressure}. Coach-connected athletes inherit the team standard; this never feeds the scoring formula (DECISION-MEMO D3).';
comment on column profiles.tos_accepted_at is
  'When this account accepted the Terms/Privacy (implicit-agree line at account creation).';
comment on column profiles.tos_version is
  'Version tag of the accepted terms, e.g. 2026-07-09.';
comment on column profiles.committed_at is
  'The hold-to-commit timestamp from onboarding — the user''s signature on their Standard.';
