-- OnStandard — Command Center Phase 1B: make admin_audit_log APPEND-ONLY at the DB (founder correction
-- #9). The ledger already denies anon/authenticated (0109) and is written only by SECURITY DEFINER RPCs;
-- this closes the last gap — nobody (not even service_role or a direct SQL editor) may UPDATE or DELETE a
-- recorded action. Revoke the DML + a BEFORE UPDATE/DELETE trigger that always raises. INSERT still works.

revoke update, delete on public.admin_audit_log from anon, authenticated;

create or replace function public.admin_audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'admin_audit_log is append-only — % is not permitted', tg_op;
end $$;

drop trigger if exists admin_audit_log_no_mutate on public.admin_audit_log;
create trigger admin_audit_log_no_mutate
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_immutable();
