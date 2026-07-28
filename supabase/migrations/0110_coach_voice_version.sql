-- OnStandard — Coach Voice versioning (handoff Section 7). Adds a monotonic `version` to
-- coach_voice_config so every AI output produced under a given voice can record which version it
-- used, and so editing the config never retroactively changes what past outputs were generated
-- with. The version bumps only when the voice actually changes (config or enabled), not on a no-op
-- touch. Also seeds the coach_voice_v2 feature flag (default OFF) that gates the analyze-meal wiring.

alter table coach_voice_config add column if not exists version int not null default 1;

create or replace function bump_coach_voice_version() returns trigger
language plpgsql as $$
begin
  -- Only a real change to the voice bumps the version; touching updated_at/updated_by alone does not.
  if (new.config is distinct from old.config) or (new.enabled is distinct from old.enabled) then
    new.version := old.version + 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_bump_coach_voice_version on coach_voice_config;
create trigger trg_bump_coach_voice_version
  before update on coach_voice_config
  for each row execute function bump_coach_voice_version();

-- Gate for the analyze-meal Coach Voice wiring. OFF by default: flip on per pilot team/user via the
-- flags panel. Evaluated per-athlete server-side in analyze-meal, so the kill-switch is immediate.
insert into public.feature_flags (name, description, default_on) values
  ('coach_voice_v2', 'Apply the team Coach Voice config to analyze-meal note/analysis text', false)
on conflict (name) do nothing;
