-- OnStandard 0165 — the first-run tour remembers it already ran.
--
-- The tour's governing flag is device-local (RT.tourSeen), which is correct: it decides whether to
-- paint an overlay, and the fast path must not wait on a round trip. This column exists for one
-- case the local flag cannot cover — a reinstall, or a second device. Without it, someone six
-- months in who replaces their phone gets tutorialized like a new signup.
--
-- One nullable timestamp, written best-effort and read tolerantly, so a device that never reaches
-- the server just runs the tour again. Over-showing a 30-second tour is a shrug; suppressing it
-- for someone who has genuinely never seen it is the failure worth avoiding, and this column can
-- only ever cause the former.
--
-- Contextual tips (tip:*) deliberately do NOT get columns. They are one line each, device-local,
-- and not worth a schema row apiece.

begin;

alter table public.profiles
  add column if not exists tour_seen_at timestamptz;

comment on column public.profiles.tour_seen_at is
  'When the first-run tour was first SHOWN to this user (any role). Survives reinstall; the device-local RT.tourSeen flag governs day to day.';

-- No new policy needed: profiles already carries self-select and self-update for the owning user,
-- which is exactly the access this column requires (the app writes it for RT.userId only).

commit;
