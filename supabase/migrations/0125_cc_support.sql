-- OnStandard — Command Center Phase 1B: minimal Support with history + safety separation (corrections
-- #4/#11). support_tickets + support_ticket_events (resolution notes / full history). User intake is
-- validated + rate-limited. category='safety' routes to a distinct higher-priority queue (urgent), so a
-- minor-safety report is never buried in normal support. Founder queue + resolve are audited.

create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  category    text not null default 'question' check (category in ('question','bug','billing','safety')),
  priority    text not null default 'normal'   check (priority in ('low','normal','high','urgent')),
  status      text not null default 'open'     check (status in ('open','pending','resolved')),
  subject     text not null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolver_id uuid references auth.users(id) on delete set null
);
create index if not exists support_tickets_status on public.support_tickets (status, created_at desc);
create index if not exists support_tickets_user   on public.support_tickets (user_id, created_at desc);

create table if not exists public.support_ticket_events (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references support_tickets(id) on delete cascade,
  actor_id   uuid references auth.users(id) on delete set null,
  kind       text not null check (kind in ('created','note','status_change','assigned','resolved')),
  body       text,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_events_ticket on public.support_ticket_events (ticket_id, created_at);

alter table public.support_tickets       enable row level security;
alter table public.support_ticket_events enable row level security;
revoke all on table public.support_tickets       from anon, authenticated;
revoke all on table public.support_ticket_events from anon, authenticated;

-- user intake (from the app): validated + rate-limited (max 5 tickets / rolling hour). Safety = urgent.
create or replace function public.create_support_ticket(p_category text, p_subject text, p_body text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_recent int; v_cat text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_cat := coalesce(nullif(trim(p_category), ''), 'question');
  if v_cat not in ('question','bug','billing','safety') then raise exception 'invalid category'; end if;
  if p_subject is null or length(trim(p_subject)) < 3 then raise exception 'subject too short'; end if;
  if length(p_subject) > 200 or length(coalesce(p_body, '')) > 4000 then raise exception 'too long'; end if;
  select count(*) into v_recent from support_tickets where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'rate limit: too many tickets in the last hour'; end if;
  insert into support_tickets (user_id, category, subject, priority)
    values (auth.uid(), v_cat, trim(p_subject), case when v_cat = 'safety' then 'urgent' else 'normal' end)
    returning id into v_id;
  insert into support_ticket_events (ticket_id, actor_id, kind, body)
    values (v_id, auth.uid(), 'created', left(coalesce(p_body, ''), 4000));
  return v_id;
end $$;
grant execute on function public.create_support_ticket(text, text, text) to authenticated;

-- founder queue: safety first, then priority, then recency. Minor reporter contact PII masked.
create or replace function public.admin_support_queue(p_status text default null, p_category text default null)
returns table (id uuid, user_id uuid, user_name text, user_email text, is_minor boolean, category text, priority text, status text, subject text, created_at timestamptz, resolved_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select t.id, t.user_id, p.full_name,
           case when is_registered_minor(t.user_id) then regexp_replace(coalesce(p.email, ''), '(^.).*(@.*$)', '\1***\2') else p.email end,
           is_registered_minor(t.user_id), t.category, t.priority, t.status, t.subject, t.created_at, t.resolved_at
    from support_tickets t left join profiles p on p.id = t.user_id
    where (p_status is null or t.status = p_status) and (p_category is null or t.category = p_category)
    order by (t.category = 'safety') desc,
             case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
             t.created_at desc
    limit 200;
end $$;
grant execute on function public.admin_support_queue(text, text) to authenticated;

create or replace function public.admin_ticket_events(p_ticket uuid)
returns setof public.support_ticket_events
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query select * from support_ticket_events where ticket_id = p_ticket order by created_at;
end $$;
grant execute on function public.admin_ticket_events(uuid) to authenticated;

create or replace function public.admin_add_ticket_event(p_ticket uuid, p_kind text, p_body text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_kind not in ('note','status_change','assigned','resolved') then raise exception 'invalid kind'; end if;
  insert into support_ticket_events (ticket_id, actor_id, kind, body)
    values (p_ticket, auth.uid(), p_kind, left(coalesce(p_body, ''), 4000)) returning id into v_id;
  insert into admin_audit_log (actor_id, action, target, after)
    values (auth.uid(), 'support.' || p_kind, p_ticket::text, jsonb_build_object('body', left(coalesce(p_body, ''), 200)));
  return v_id;
end $$;
grant execute on function public.admin_add_ticket_event(uuid, text, text) to authenticated;

create or replace function public.admin_resolve_ticket(p_ticket uuid, p_note text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  update support_tickets set status = 'resolved', resolved_at = now(), resolver_id = auth.uid() where id = p_ticket;
  insert into support_ticket_events (ticket_id, actor_id, kind, body) values (p_ticket, auth.uid(), 'resolved', p_note);
  insert into admin_audit_log (actor_id, action, target, after)
    values (auth.uid(), 'support.resolve', p_ticket::text, jsonb_build_object('note', left(coalesce(p_note, ''), 200)));
end $$;
grant execute on function public.admin_resolve_ticket(uuid, text) to authenticated;
