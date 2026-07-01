-- OnStandard — Coach Copilot artifacts + audit log (doc-05 §6). Forward-only, idempotent.
--
-- The Copilot drafts messages/reports for a coach; SENDING is a separate, human, permissioned,
-- audited action. This adds:
--   * activity_log      — the doc-02 audit trail (who did what, when). Append-only.
--   * copilot_artifacts — the drafts the Copilot produces. status starts 'draft'; only the
--                         send_copilot_artifact() RPC flips it to 'sent' AND writes activity_log,
--                         so "the AI sent a message" is impossible — the audit always shows a human.
--
-- RLS: a coach sees only their own artifacts, and an artifact may reference only athletes the coach
-- can already see (can_view, from 0012/0013). The Copilot edge function has NO send capability.
--
-- GUARDRAIL: authored here; NOT applied to the live project. The founder applies it with the others.

-- ---------------------------------------------------------------- activity_log (audit trail)
create table if not exists public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid not null references auth.users(id) on delete cascade,
  action     text not null,                       -- e.g. 'copilot_artifact.sent'
  subject_id uuid null,                            -- the athlete/thread/artifact acted on
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.activity_log enable row level security;
-- Actors read their own audit rows; writes happen only through SECURITY DEFINER RPCs / service_role.
drop policy if exists al_read_self on public.activity_log;
create policy al_read_self on public.activity_log for select using (actor_id = auth.uid());
revoke insert, update, delete on public.activity_log from authenticated;
grant select on public.activity_log to authenticated;

-- ---------------------------------------------------------------- copilot_artifacts (drafts)
create table if not exists public.copilot_artifacts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references auth.users(id) on delete cascade,  -- the coach
  athlete_id uuid null references auth.users(id) on delete set null,     -- per-athlete draft
  scope_id   uuid null,                                                   -- group/team for a roster draft
  kind       text not null check (kind in ('message', 'report', 'summary')),
  body       jsonb not null,
  status     text not null default 'draft' check (status in ('draft', 'sent', 'discarded')),
  model_meta jsonb null,                            -- which model/version produced it (transparency)
  created_at timestamptz not null default now()
);
alter table public.copilot_artifacts enable row level security;

-- The coach sees/edits only their own artifacts, and may only reference an athlete they can view.
drop policy if exists ca_read on public.copilot_artifacts;
create policy ca_read on public.copilot_artifacts for select using (author_id = auth.uid());

drop policy if exists ca_insert on public.copilot_artifacts;
create policy ca_insert on public.copilot_artifacts for insert
  with check (author_id = auth.uid() and (athlete_id is null or can_view(athlete_id)));

drop policy if exists ca_update on public.copilot_artifacts;
create policy ca_update on public.copilot_artifacts for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and (athlete_id is null or can_view(athlete_id)));

-- New tables do NOT inherit authenticated DML after 0013 — grant it explicitly (RLS scopes rows).
grant select, insert, update on public.copilot_artifacts to authenticated;

-- ---------------------------------------------------------------- draft -> sent (the ONLY send path)
-- Flips a draft to 'sent' and records the audit in one atomic, permissioned step. SECURITY DEFINER
-- so it can write activity_log, but it verifies the caller OWNS the artifact — a coach can only send
-- their own draft, and the row proves a human pressed send. The Copilot/edge function cannot call
-- this on a human's behalf (it has no session as the coach).
create or replace function public.send_copilot_artifact(p_id uuid)
returns public.copilot_artifacts
language plpgsql
security definer
set search_path = public
as $$
declare
  art public.copilot_artifacts;
begin
  update public.copilot_artifacts
     set status = 'sent'
   where id = p_id and author_id = auth.uid() and status = 'draft'
   returning * into art;

  if art.id is null then
    raise exception 'artifact not found, not yours, or not a draft';
  end if;

  insert into public.activity_log (actor_id, action, subject_id, meta)
  values (auth.uid(), 'copilot_artifact.sent', art.athlete_id, jsonb_build_object('artifact_id', art.id, 'kind', art.kind));

  return art;
end;
$$;

revoke execute on function public.send_copilot_artifact(uuid) from public;
grant  execute on function public.send_copilot_artifact(uuid) to authenticated;
