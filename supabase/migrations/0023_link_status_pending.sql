-- OnStandard — linking feature, Stage 2a: add a 'pending' link status.
-- Athlete-initiated join REQUESTS live as team_members / practice_clients rows with
-- status='pending'. The RLS view helpers (is_team_coach_of / is_trainer_of, 0002)
-- already require status='active', so a pending row grants NO access to the athlete's
-- data — it only becomes visible once a coach/trainer approves (flips it to 'active').
--
-- Must be its OWN migration: Postgres forbids using a newly-added enum value in the
-- same transaction that adds it, so the RPCs that write 'pending' live in 0024.
--
-- GUARDRAIL: authored only; the founder applies it at go-live (like 0004+).

alter type link_status add value if not exists 'pending';
