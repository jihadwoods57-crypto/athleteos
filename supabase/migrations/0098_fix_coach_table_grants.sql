-- OnStandard — table-level write GRANTs for staff tables written by DIRECT client inserts.
--
-- ROOT CAUSE: 0013_security_hardening revoked 0005's default `alter default privileges ... grant
-- ... to authenticated`, so since 0013 every table written by a direct PostgREST call
-- (insert/update/upsert/delete from the client) needs an EXPLICIT table grant, or the
-- `authenticated` role hits "permission denied for table" BEFORE RLS is even evaluated. Tables
-- written only through SECURITY DEFINER RPCs (e.g. requirement_sets via set_team_requirements,
-- announcements via post_announcement) don't need this and correctly weren't granted.
--
-- THE HOLE: these six staff tables shipped their RLS policies but not the grant, so in prod the
-- direct-write coach actions silently failed — coach notes (0073), excusals + position groups +
-- interventions (0071), first-run setup-state (0092), and Coach Voice config (0094). Found by a
-- live smoke test: reads succeeded (0005 still grants select) but every direct write returned
-- "permission denied for table". trust_pass_policy (0097) has no client writer yet but is granted
-- here for its future config upsert, matching the others.
--
-- RLS (already enabled + policied on every table below) stays the row-level wall — these grants
-- only get the authenticated role past the table gate so its policies can do their job. Each
-- grant matches what the client actually does (least privilege); re-granting is a no-op, so this
-- migration is idempotent and safe to re-run.

grant select, insert, update         on athlete_exceptions  to authenticated;  -- 0071: mark / clear excused
grant select, insert, update, delete on coach_groups        to authenticated;  -- 0071: create / edit / remove groups
grant select, insert                 on coach_interventions to authenticated;  -- 0071: nudge / log an intervention
grant select, insert, delete         on coach_notes         to authenticated;  -- 0073: add / remove a note
grant select, insert, update         on coach_setup_state   to authenticated;  -- 0092: markCoachSetup upsert
grant select, insert, update         on coach_voice_config  to authenticated;  -- 0094: setCoachVoice upsert
grant select, insert, update         on trust_pass_policy   to authenticated;  -- 0097: future policy upsert
