-- 0245: a content report reaches a person (review pass 2026-09-23, G-R11, Guideline 1.2).
--
-- 0227 stored reports and told nobody: the table filled up and the review notes promised "Report
-- reaches us within 24 hours". Now every open report is sent to support by email (and to the
-- admins' phones) through the existing admin-alert function, within five minutes of landing.
--
-- The repo's pattern for server-to-function calls is pg_cron + pg_net with the URL and key handed
-- in once by the operator (schedule_winback 0160, schedule_athlete_summary 0238): the migration
-- never needs to know the project URL, and no secret sits in a table. So:
--
--   alert_content_reports(url, key)   sends every open, not-yet-alerted report (up to 25) as ONE
--                                     admin-alert call and stamps alerted_at. Idempotent: a report
--                                     is alerted once. Returns how many it sent.
--   schedule_content_report_alerts(url, key)   runs the above every 5 minutes.
--
-- What the email carries: the reason, the ids (report, reporter, the person reported, the meal or
-- team), and the reporter's own short note (clipped to 280 characters). Never the message that was
-- reported: whoever reads the email opens the report where it lives.
--
-- After deploy (founder, once):
--   select schedule_content_report_alerts('https://<ref>.supabase.co/functions/v1/admin-alert', '<ALERT_KEY>');

alter table public.content_reports add column if not exists alerted_at timestamptz;
create index if not exists content_reports_unalerted_idx on public.content_reports (created_at) where alerted_at is null;

create or replace function public.alert_content_reports(p_fn_url text, p_alert_key text)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
  details jsonb := '[]'::jsonb;
begin
  if p_fn_url is null or p_alert_key is null then return 0; end if;
  for r in
    select id, reason, reporter_id, subject_id, meal_id, team_id, comment_id,
           left(coalesce(detail, ''), 280) as note
      from content_reports
     where alerted_at is null and status = 'open'
     order by created_at
     limit 25
       for update skip locked
  loop
    n := n + 1;
    details := details || jsonb_build_array(jsonb_build_object(
      'label', 'Report ' || n || ': ' || r.reason,
      'value', concat_ws(' · ',
        'report ' || r.id,
        'reporter ' || r.reporter_id,
        'about ' || coalesce(r.subject_id::text, 'unknown'),
        case when r.meal_id is not null then 'meal ' || r.meal_id end,
        case when r.team_id is not null then 'team ' || r.team_id end,
        case when r.comment_id is not null then 'message ' || r.comment_id end,
        case when r.note <> '' then 'note: ' || r.note end)));
    update content_reports set alerted_at = now() where id = r.id;
  end loop;
  if n = 0 then return 0; end if;
  perform net.http_post(
    url := p_fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-alert-key', p_alert_key),
    body := jsonb_build_object(
      'kind', 'content_report',
      'subject', n || ' new content report' || case when n = 1 then '' else 's' end,
      'body', 'Someone reported content in OnStandard. Review it in the content_reports table and answer within 24 hours.',
      'details', details,
      'occurredAt', now()));
  return n;
end $$;
revoke all on function public.alert_content_reports(text, text) from public, anon, authenticated;
grant execute on function public.alert_content_reports(text, text) to service_role;

create or replace function public.schedule_content_report_alerts(p_fn_url text, p_alert_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed — skipping schedule';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'content-report-alerts';
  perform cron.schedule('content-report-alerts', '*/5 * * * *',
    format('select public.alert_content_reports(%L, %L);', p_fn_url, p_alert_key));
end $$;
revoke all on function public.schedule_content_report_alerts(text, text) from public, anon, authenticated;
grant execute on function public.schedule_content_report_alerts(text, text) to service_role;
