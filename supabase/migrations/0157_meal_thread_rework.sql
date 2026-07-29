-- OnStandard — the meal thread becomes a conversation (2026-07-28, founder-directed).
--
-- WHAT CHANGED AND WHY. 0059 capped a meal thread at coach 2 / athlete 3 / AI 2 messages,
-- because "a meal thread is accountability, not a group chat". The founder has since decided
-- the opposite: it SHOULD be a group chat — the athlete, the coach, and the AI nutritionist in
-- one running conversation, with the AI posting a real analysis of every plate and answering
-- follow-ups. Those caps are now the product's biggest limitation. An athlete asking a third
-- question got a wall; a coach making a third point got a wall.
--
-- The caps do not disappear, they change job. Pacing the AI is a COST question and belongs where
-- cost lives: the per-athlete daily budget (claim_ai_usage_key, 0030) and the dollar ceiling
-- (0152), both of which understand spend. What is left here is a pure anti-spam backstop against
-- a modified client — a bound so high that no real conversation can reach it, cheap enough to
-- evaluate on every insert (one indexed count on meal_comments_meal).
--
-- 50 human / 20 AI per meal per role. 50 is far past any real thread, especially now that the
-- stitched season view removes any reason to pack one meal's discussion. 20 for the AI is
-- defence-in-depth: the opener, correction updates, coach support and replies fit comfortably,
-- and a runaway loop still cannot flood a thread.
--
-- Forward-only and idempotent (create or replace + guarded add column), matching 0049/0068.
-- RLS VISIBILITY IS DELIBERATELY UNCHANGED: who can read a thread is still exactly can_view().

-- ---------------------------------------------------------------- 1. caps become a backstop
create or replace function tg_meal_comment_caps()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int;
  cap int;
begin
  -- Reactions and coach notes have never been capped and still are not.
  if coalesce(NEW.kind, 'message') <> 'message' then return NEW; end if;
  cap := case NEW.role when 'ai' then 20 else 50 end;
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

comment on function tg_meal_comment_caps() is
  'Anti-spam backstop only (50 human / 20 AI per meal per role). AI pacing lives in the daily usage budget + spend ceiling, not here.';

-- ---------------------------------------------------------------- 2. what KIND of AI message
-- The AI now posts more than one kind of thing: the analysis of a plate, and a fresh analysis
-- after the athlete corrects it. The thread renders them differently (an update carries the
-- correction it answers), and the stitched season view needs to find the opener for a meal
-- without re-deriving it from ordering — ordering is not stable across pagination.
--
-- Why a column and not inference: `meta` survives paging, deletion of neighbours, and the day
-- the AI gains a third message type. Note that clients CAN write meta on their own rows (the
-- insert policy is row-level, not column-level) — which costs nothing, because the renderer
-- only reads meta on role='ai' rows and RLS makes those unforgeable by any client.
alter table meal_comments add column if not exists meta jsonb;

comment on column meal_comments.meta is
  'Optional message subtype. {"t":"analysis"} = the AI''s read of the plate; {"t":"analysis_update"} = a fresh read after an athlete correction. Only honoured on role=''ai'' rows.';
