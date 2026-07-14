-- OnStandard — thread-cap correction (0059 follow-up).
-- 0059 capped role='ai' at 2 messages per meal, but the athlete may ask up to 3 questions
-- (3 AI answers) and the coach side gets 1 AI supporting message (founder-ratified 2/3/1).
-- Correct ceiling: 4. Human caps unchanged (coach 2, athlete 3).
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
  cap := case NEW.role when 'coach' then 2 when 'athlete' then 3 else 4 end;
  select count(*) into n from meal_comments
   where meal_id = NEW.meal_id and role = NEW.role and coalesce(kind, 'message') = 'message';
  if n >= cap then
    raise exception 'Thread cap reached: % messages per meal for %.', cap, NEW.role;
  end if;
  return NEW;
end; $$;
