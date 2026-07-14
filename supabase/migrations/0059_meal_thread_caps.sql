-- OnStandard — meal-thread caps (WS4d, founder-ratified: coach 2 / athlete 3 / AI 1 support).
-- A meal thread is accountability, not a group chat. Caps are enforced IN the database so a
-- modified client cannot spam past them. Reactions (kind='reaction') are exempt.
--
-- GUARDRAIL: authored by direction of the founder 2026-07-14; apply with supabase db push.

create or replace function tg_meal_comment_caps()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int;
  cap int;
begin
  if coalesce(NEW.kind, 'message') <> 'message' then return NEW; end if;
  cap := case NEW.role when 'coach' then 2 when 'athlete' then 3 else 2 end; -- ai: 1 opener + 1 support
  select count(*) into n from meal_comments
   where meal_id = NEW.meal_id and role = NEW.role and coalesce(kind, 'message') = 'message';
  if n >= cap then
    raise exception 'Thread cap reached: % messages per meal for %.', cap, NEW.role;
  end if;
  return NEW;
end; $$;

drop trigger if exists meal_comment_caps on meal_comments;
create trigger meal_comment_caps before insert on meal_comments
  for each row execute function tg_meal_comment_caps();
