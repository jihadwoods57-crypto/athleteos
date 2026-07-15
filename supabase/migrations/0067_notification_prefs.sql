-- OnStandard — server-honored notification preference (GDPR/PECR + general "respect the user's
-- stated choice"). Companion to the in-app Notifications toggle.
--
-- THE GAP (compliance audit 2026-07-15): the app's Notifications toggle set only a device-local
-- boolean (useStore `notif`); it was never consulted server-side, so the automated weekly-digest
-- engagement push (weekly-digest function) went to every coach/trainer with a roster regardless
-- of whether they had turned notifications OFF. There was no server-side, honored opt-out.
--
-- THE FIX: one boolean on profiles. The client writes it best-effort when the user flips the
-- toggle (useStore.toggleNotif); weekly-digest reads it and skips opted-out owners. The read is
-- written to FAIL OPEN (if this column is not yet applied the function's filter errors and it
-- sends as before), so deploy order between the function and this migration is not load-bearing.
--
-- profiles_self_write (0002) already lets the owner update their own row, so no policy change.
--
-- GUARDRAIL: authored only — NOT applied to live by the audit. Founder applies at go-live.

alter table profiles add column if not exists notifications_opt_out boolean not null default false;

comment on column profiles.notifications_opt_out is
  'True when the user turned the in-app Notifications toggle OFF. Honored server-side so automated '
  'engagement pushes (e.g. the weekly digest) are not sent to them. Written best-effort by the client.';
