-- 0221: quiet hours and the team-standard push opt-out live on the server too (2026-09-05 audit, parked).
--
-- THE GAP. Quiet hours exist only on the device. The proto keeps them in RT.notifPrefs (athlete)
-- and RT.coachNotifPrefs (coach) as quietFrom / quietTo, minutes from midnight, and the local
-- notification planner shifts its OWN reminders around that window. Nothing server-side has ever
-- seen those numbers. connected-standards-tick, the scheduled function behind team-standard
-- reminders and misses, pushes at whatever minute the deadline math produces, so a step goal
-- that closes at 11:59 PM wakes the athlete at midnight, and the one opt-out it could have
-- honoured (profiles.notifications_opt_out, 0067) it never read. The settings screen was already
-- honest about this ("reminders for team standards still come through"); this migration is the
-- first half of making that sentence false, the function change is the second, and the client
-- sync of these columns is a separate proto change (see the mapping at the bottom).
--
-- THE COLUMNS. Three additive, nullable-or-defaulted columns on profiles, the table both
-- functions already read for timezone (0088) and the master opt-out (0067):
--   quiet_from_min   smallint, 0..1439, the minute of local day the quiet window opens
--   quiet_to_min     smallint, 0..1439, the minute of local day it closes (may be before
--                    quiet_from_min: the window wraps midnight, exactly like the client's inQuiet)
--   team_standard_pushes_opt_out  boolean, true when the athlete turned team-standard pushes off
-- A null pair means the device never synced a window, and the server treats that as "no quiet
-- window", never as the client default. A default here would have the server silence pushes for
-- an athlete who never asked, which is a worse surprise than one late-night reminder.
--
-- RLS. profiles_self_write (0002) already lets the owner update their own row and profiles_read
-- lets the owner and their connected circle read it; the service role bypasses RLS. That is the
-- same posture notifications_opt_out and timezone have had since 0067/0088, so no new policy is
-- needed and none is added. The CHECK constraints are the only new guard: a tampered client
-- cannot write a minute outside a day, and the function can trust the range without clamping.
--
-- Reversible-safe: IF NOT EXISTS on every column, constraints added only when absent, no data
-- touched, no existing migration edited.
--
-- CLIENT MAPPING for the follow-up (proto agents own this; nothing here touches the proto):
--   RT.notifPrefs.quietFrom       -> profiles.quiet_from_min               (athlete device)
--   RT.notifPrefs.quietTo         -> profiles.quiet_to_min                 (athlete device)
--   RT.coachNotifPrefs.quietFrom  -> profiles.quiet_from_min               (coach device, same row)
--   RT.coachNotifPrefs.quietTo    -> profiles.quiet_to_min                 (coach device, same row)
--   RT.notifPrefs.enabled         -> profiles.notifications_opt_out = !enabled   (already synced, 0067)
--   (new toggle, not yet in RT)   -> profiles.team_standard_pushes_opt_out
--   Intl timezone on the device   -> profiles.timezone                     (already synced, 0088)

alter table profiles add column if not exists quiet_from_min smallint;
alter table profiles add column if not exists quiet_to_min smallint;
alter table profiles add column if not exists team_standard_pushes_opt_out boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_quiet_from_min_range') then
    alter table profiles add constraint profiles_quiet_from_min_range
      check (quiet_from_min is null or (quiet_from_min >= 0 and quiet_from_min < 1440));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_quiet_to_min_range') then
    alter table profiles add constraint profiles_quiet_to_min_range
      check (quiet_to_min is null or (quiet_to_min >= 0 and quiet_to_min < 1440));
  end if;
end $$;

comment on column profiles.quiet_from_min is
  'Minute of the local day (0..1439, in profiles.timezone) when the user''s quiet window opens. '
  'Synced from the device''s notification prefs (quietFrom). Null = the device never synced one; '
  'scheduled pushes then run without a quiet window. Honoured by connected-standards-tick.';

comment on column profiles.quiet_to_min is
  'Minute of the local day (0..1439) when the quiet window closes. May be earlier than '
  'quiet_from_min, in which case the window wraps midnight. Synced from the device (quietTo).';

comment on column profiles.team_standard_pushes_opt_out is
  'True when the user turned team-standard pushes off. connected-standards-tick still writes the '
  'in-app notification row (the durable record of a reminder or a miss) but sends no device push. '
  'Independent of notifications_opt_out, which silences everything.';
