// OnStandard — ai-followup: the one time a day the AI speaks first.
//
// WHY THIS EXISTS
// The AI has only ever answered. It reads a plate, replies to a question, and goes quiet. A
// nutritionist who actually worked with an athlete would come back the next day about the thing
// that mattered. That single beat is most of the difference between a tool and a relationship.
//
// WHY IT IS SO HEAVILY CAPPED
// Every rule here is about NOT sending. One message per athlete per day, in their own local
// afternoon, only when there is a real reason, behind a flag, under a dollar ceiling and a global
// daily budget. The moment this reads as noise it gets muted — and then the message that mattered
// is muted too. A proactive feature earns its place by being rare.
//
// TWO BEATS, ONE VOICE (2026-09-10)
//   1. THE FOLLOW-UP looks back: yesterday's weak dinner, sent 15:00-19:00 local, landing on that
//      meal's thread (meal-view/<id>) where its photo and numbers already live.
//   2. THE DAY-GAP NUDGE looks forward: "you're 40g short with dinner still open", sent 19:00-20:00
//      local, landing on the camera for the open slot. It reads the athlete's own `days` row (the
//      client writes meals, slotMacros and task deadlines there on every change) and the coach-set
//      protein target; the server derives no timing of its own. It NEVER fires on a day the
//      follow-up already spoke, and it shares the follow-up's global daily budget.
//
// INVOCATION: hourly, shared-key protected (deploy with --no-verify-jwt):
//   supabase secrets set AI_FOLLOWUP_CRON_KEY=<long random string>
//   supabase functions deploy ai-followup --no-verify-jwt
//   select cron.schedule('ai-followup-hourly','5 * * * *', $$ ... net.http_post ... $$);
// Add ?dry=1 to see the selection without writing anything.
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.0';
import { recordAiCall, usageFrom } from '../_shared/ai-telemetry.ts';
import { checkSpend, EST_USD } from '../_shared/spend-gate.ts';
import { flagOn } from '../_shared/feature-flags.ts';
import { loadPlanStyleForAthlete } from '../_shared/plan-style-load.ts';
import { violatesStyleLanguage, styleShowsNumbers, type PlanStyle } from '../_shared/plan-style.ts';
import {
  inLocalWindow, localDateISO, pickFollowUpMeal, fallbackFollowUp, routeForMeal, notificationKind,
  pickDayGapNudge, dayGapFallback, dayGapMessageOk, clampSentences, slotNoun, routeForSlot, dayGapKind,
  DAY_GAP_WINDOW,
  type MealRow, type DayRowForGap, type DayGapNudge,
} from '../_shared/followup.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_KEY = Deno.env.get('AI_FOLLOWUP_CRON_KEY') ?? '';
// Haiku-class: 50 words of warm prose off a handful of numbers does not need the vision model.
const MODEL = Deno.env.get('ANTHROPIC_MODEL_FOLLOWUP') ?? Deno.env.get('ANTHROPIC_TEXT_MODEL') ?? 'claude-haiku-4-5-20251001';
// Start small on purpose. Raise it once the open/reply rate says the beat is wanted.
const DAILY_GLOBAL = Math.max(1, Number(Deno.env.get('FOLLOWUP_DAILY_GLOBAL') ?? '50'));
const SCAN_LIMIT = 400;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

/** Constant-time compare of the shared cron key — mirrors weekly-digest / commitment-reminders. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

const FOLLOWUP_TOOL = {
  name: 'followup',
  description: 'Return ONE short message to the athlete about yesterday evening.',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'At most 45 words. Second person. One concrete thing they can do tonight. No greeting, no sign-off.' },
    },
    required: ['message'],
  },
} as const;

const SYSTEM = [
  'You are the athlete\'s nutrition coach, opening a conversation the morning after.',
  'You get ONE short message. Make it worth the interruption.',
  'Rules:',
  '- Name the specific thing (the meal, the number if you are given one). Never generic encouragement.',
  '- Point at tonight, not at yesterday. Yesterday is finished; tonight is the rep.',
  '- End with a question they can answer in a few words.',
  '- No greeting, no sign-off, no emoji, no em dash.',
  '- Never invent a figure. Use only what you are given.',
  '- 45 words maximum.',
].join('\n');

const DAYGAP_TOOL = {
  name: 'daygap',
  description: 'Return ONE short nudge about the protein still to eat today.',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'At most 2 sentences and 30 words. Second person. Quote the gap in grams exactly as given. No greeting, no sign-off.' },
    },
    required: ['message'],
  },
} as const;

const DAYGAP_SYSTEM = [
  'You are the athlete\'s nutrition coach, texting them early in the evening.',
  'You get ONE short nudge, two sentences at most. Make it worth the interruption.',
  'Rules:',
  '- State the exact protein gap you are given, in grams, and which meal is still open.',
  '- Use ONLY the numbers you are given. Never invent a figure, a portion, or a food.',
  '- Point at the open meal as the fix. No lecture, no recap of the day.',
  '- No greeting, no sign-off, no emoji, no em dash. Plain English.',
  '- Two sentences maximum, 30 words maximum.',
].join('\n');

type Prof = { timezone: string | null; notifications_opt_out?: boolean | null };
type Blocked = { flag: number; window: number; dedup: number; global: number; nothing: number; style: number; followup: number };
type FollowSend = { athleteId: string; meal: MealRow; text: string };
type GapSend = { athleteId: string; nudge: DayGapNudge; text: string };

const claimAllowed = (claim: unknown): boolean =>
  (Array.isArray(claim) ? claim[0] : claim as { allowed?: boolean } | null)?.allowed !== false;

/** Best-effort Expo push in batches of 100. The durable rows are already written by the caller. */
async function pushAll(messages: Array<Record<string, unknown>>): Promise<number> {
  let pushed = 0;
  for (let i = 0; i < messages.length; i += 100) {
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
      if (r.ok) pushed += Math.min(100, messages.length - i);
    } catch { /* the thread row and notification are already written */ }
  }
  return pushed;
}

/* ================================================================================
   THE DAY-GAP PASS. Same shape as the follow-up pass: select in the athlete's own window, claim
   once per local day, claim against the shared global budget, compose through Haiku with a
   deterministic fallback, then write durable rows before any push.
   ================================================================================ */
async function dayGapPass(opts: {
  svc: SupabaseClient; anthropic: Anthropic; now: Date; dry: boolean;
  dates: string[]; todayUtc: string; blocked: Blocked;
  /** Athletes the follow-up pass is about to message THIS run. */
  followupNow: Set<string>;
}): Promise<{ scanned: number; sends: GapSend[] }> {
  const { svc, anthropic, now, dry, dates, todayUtc, blocked, followupNow } = opts;
  const nowMs = now.getTime();

  // Candidate days: today by UTC date or the one before (the athlete's local today is one of the
  // two). Bounded like the meal scan.
  const { data: dayRows, error: daysErr } = await svc
    .from('days').select('athlete_id,date,meals,checkin,tasks')
    .in('date', dates).limit(SCAN_LIMIT);
  if (daysErr) return { scanned: 0, sends: [] };
  const days = (dayRows ?? []) as DayRowForGap[];
  if (!days.length) return { scanned: 0, sends: [] };
  const athleteIds = [...new Set(days.map((d) => d.athlete_id))];

  // Timezones + opt-out; the coach-set protein target; and whether the follow-up already spoke
  // to this athlete today (its notification row is the durable record of that).
  const [{ data: profs }, { data: targets }, { data: spoke }] = await Promise.all([
    svc.from('profiles').select('id,timezone,notifications_opt_out').in('id', athleteIds),
    svc.from('athlete_profiles').select('athlete_id,targets').in('athlete_id', athleteIds),
    svc.from('notifications').select('user_id,kind,created_at')
      .in('user_id', athleteIds).like('kind', 'ai_followup:%')
      .gte('created_at', new Date(nowMs - 30 * 3600_000).toISOString()),
  ]);
  const profById = new Map<string, Prof>();
  for (const p of (profs ?? []) as Array<{ id: string } & Prof>) profById.set(p.id, p);
  const targetById = new Map<string, unknown>();
  for (const t of (targets ?? []) as Array<{ athlete_id: string; targets: { protein?: unknown } | null }>) {
    targetById.set(t.athlete_id, t.targets?.protein);
  }
  const followupAt = new Map<string, string[]>();
  for (const n of (spoke ?? []) as Array<{ user_id: string; created_at: string }>) {
    if (!followupAt.has(n.user_id)) followupAt.set(n.user_id, []);
    followupAt.get(n.user_id)!.push(n.created_at);
  }

  const sends: GapSend[] = [];
  const seen = new Set<string>();
  for (const day of days) {
    const athleteId = day.athlete_id;
    if (seen.has(athleteId)) continue;
    const prof = profById.get(athleteId);
    if (!prof || prof.notifications_opt_out) { blocked.window++; continue; }
    const tz = prof.timezone;
    if (!inLocalWindow(now, tz, DAY_GAP_WINDOW[0], DAY_GAP_WINDOW[1])) { blocked.window++; continue; }
    const localDate = localDateISO(now, tz);
    if (!localDate) { blocked.window++; continue; }
    // Only the row for THEIR today. The other date in the scan is yesterday or tomorrow there.
    if (day.date !== localDate) continue;
    seen.add(athleteId);

    if (!(await flagOn(svc, 'ai_followups', { userId: athleteId }))) { blocked.flag++; continue; }

    // Never a second proactive message on a day the follow-up already spoke: this run, or an
    // earlier run today (the follow-up window closes exactly when this one opens).
    const spokeToday = followupNow.has(athleteId)
      || (followupAt.get(athleteId) ?? []).some((at) => localDateISO(new Date(at), tz) === localDate);
    if (spokeToday) { blocked.followup++; continue; }

    const nudge = pickDayGapNudge(day, targetById.get(athleteId), nowMs);
    if (!nudge) { blocked.nothing++; continue; }

    // A gap nudge is a number by nature. An athlete whose plan style hides numbers is not told
    // one on our initiative; that is the whole point of their style.
    const planStyle: PlanStyle | null = (await loadPlanStyleForAthlete(svc, athleteId))?.style ?? null;
    if (!styleShowsNumbers(planStyle)) { blocked.style++; continue; }

    // ONE per athlete per LOCAL day, then the global budget shared with the follow-up.
    const { data: claim } = await svc.rpc('claim_ai_usage_key', { p_key: `daygap:${athleteId}:${localDate}`, p_limit: 1 });
    if (!claimAllowed(claim)) { blocked.dedup++; continue; }
    const { data: gclaim } = await svc.rpc('claim_ai_usage_key', { p_key: `followup_global:${todayUtc}`, p_limit: DAILY_GLOBAL });
    if (!claimAllowed(gclaim)) { blocked.global++; break; }

    let text = dayGapFallback(nudge);
    if (!dry) {
      const t0 = Date.now();
      try {
        const msg = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 160,
          system: DAYGAP_SYSTEM,
          tools: [DAYGAP_TOOL] as unknown as Anthropic.Tool[],
          tool_choice: { type: 'tool', name: 'daygap' },
          messages: [{
            role: 'user',
            content: `So far today the athlete has logged ${nudge.soFar}g of a ${nudge.target}g protein target: ${nudge.gap}g still to go. ${slotNoun(nudge.slot)} is still open${nudge.openSlots.length > 1 ? ` (${nudge.openSlots.length} meals open in total)` : ''}. Write the one nudge, quoting ${nudge.gap}g exactly.`,
          }],
        });
        const block = msg.content.find((c) => c.type === 'tool_use');
        const out = block && 'input' in block ? (block.input as { message?: string }).message : null;
        if (out && typeof out === 'string') {
          const candidate = clampSentences(out.trim().replace(/—/g, ','), 2).slice(0, 300);
          // The contract is exact numbers and two sentences; a message that breaks it is replaced
          // by the deterministic line rather than shipped.
          if (dayGapMessageOk(candidate, nudge)) text = candidate;
        }
        await recordAiCall({ fn: 'ai-followup', mode: 'daygap', userId: athleteId, model: MODEL, latencyMs: Date.now() - t0, ok: true, ...usageFrom(msg) });
      } catch {
        await recordAiCall({ fn: 'ai-followup', mode: 'daygap', userId: athleteId, model: MODEL, latencyMs: Date.now() - t0, ok: false, errorCode: 'upstream_error' });
      }
      if (violatesStyleLanguage(text, planStyle)) { text = dayGapFallback(nudge); blocked.style++; }
    }
    sends.push({ athleteId, nudge, text });
  }
  return { scanned: seen.size, sends };
}

Deno.serve(async (req) => {
  if (!CRON_KEY || !safeEqual(req.headers.get('x-followup-key') ?? '', CRON_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'not configured' }, 500);

  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const blocked: Blocked = { flag: 0, window: 0, dedup: 0, global: 0, nothing: 0, style: 0, followup: 0 };
  const gapBlocked: Blocked = { flag: 0, window: 0, dedup: 0, global: 0, nothing: 0, style: 0, followup: 0 };

  // SPEND FIRST, before any claim is burned. Fails closed: if the ceiling cannot be read, nobody
  // gets a follow-up, which is the right direction for a non-essential paid feature.
  const spend = await checkSpend(EST_USD.text);
  if (!spend.allowed) return json({ sent: 0, aborted: 'spend', reason: spend.reason });

  const now = new Date();
  const yesterdayUtc = new Date(now.getTime() - 24 * 3600_000).toISOString().slice(0, 10);
  const todayUtc = now.toISOString().slice(0, 10);
  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

  // ---- PASS 1: the follow-up about yesterday evening ----
  // Candidate meals: yesterday or today by UTC date (the athlete's local yesterday is one of the
  // two, depending on their offset), evening slots, weak reads only. Bounded scan.
  const { data: mealsData, error: mealsErr } = await svc
    .from('meals')
    .select('id,athlete_id,type,quality,day_date')
    .in('day_date', [yesterdayUtc, todayUtc])
    .in('type', ['dinner', 'snack'])
    .not('quality', 'is', null)
    .lte('quality', 55)
    .order('day_date', { ascending: false })
    .limit(SCAN_LIMIT);
  if (mealsErr) return json({ error: 'scan failed' }, 500);

  const byAthlete = new Map<string, MealRow[]>();
  for (const m of (mealsData ?? []) as MealRow[]) {
    if (!byAthlete.has(m.athlete_id)) byAthlete.set(m.athlete_id, []);
    byAthlete.get(m.athlete_id)!.push(m);
  }
  const athleteIds = [...byAthlete.keys()];

  // Timezones + notification opt-out, one read.
  const profById = new Map<string, Prof>();
  if (athleteIds.length) {
    const { data: profs } = await svc
      .from('profiles').select('id,timezone,notifications_opt_out').in('id', athleteIds);
    for (const p of (profs ?? []) as Array<{ id: string } & Prof>) profById.set(p.id, p);
  }

  const sends: FollowSend[] = [];

  for (const athleteId of athleteIds) {
    const prof = profById.get(athleteId);
    if (!prof || prof.notifications_opt_out) { blocked.window++; continue; }
    const tz = prof.timezone;

    // Their local afternoon, or not at all. A null timezone is a skip, never a guess.
    if (!inLocalWindow(now, tz)) { blocked.window++; continue; }
    const localDate = localDateISO(now, tz);
    if (!localDate) { blocked.window++; continue; }

    if (!(await flagOn(svc, 'ai_followups', { userId: athleteId }))) { blocked.flag++; continue; }

    // Their local yesterday, which is what the message is actually about.
    const yesterdayLocal = localDateISO(new Date(now.getTime() - 24 * 3600_000), tz);
    const meal = pickFollowUpMeal((byAthlete.get(athleteId) ?? []).filter((m) => m.day_date === yesterdayLocal));
    if (!meal) { blocked.nothing++; continue; }

    // ONE per athlete per LOCAL day. claim_ai_usage_key marks in the same statement, so two
    // overlapping ticks cannot both win.
    const { data: claim } = await svc.rpc('claim_ai_usage_key', { p_key: `followup:${athleteId}:${localDate}`, p_limit: 1 });
    if (!claimAllowed(claim)) { blocked.dedup++; continue; }

    // Global daily budget across everyone — the backstop on a runaway day.
    const { data: gclaim } = await svc.rpc('claim_ai_usage_key', { p_key: `followup_global:${todayUtc}`, p_limit: DAILY_GLOBAL });
    if (!claimAllowed(gclaim)) { blocked.global++; break; }

    // The athlete's plan style decides what may be SAID. An Intuitive athlete is not tracking
    // figures by choice; quoting a quality score at them would break that on our initiative.
    const planStyle: PlanStyle | null = (await loadPlanStyleForAthlete(svc, athleteId))?.style ?? null;
    // styleShowsNumbers is the ONE place that fact is decided (plan-style.ts:47) — asking it
    // rather than re-deriving keeps this in step with the client and the other functions.
    const numbersOk = styleShowsNumbers(planStyle);

    let text = fallbackFollowUp(meal, numbersOk);
    if (!dry) {
      const t0 = Date.now();
      try {
        const msg = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 220,
          system: SYSTEM,
          tools: [FOLLOWUP_TOOL] as unknown as Anthropic.Tool[],
          tool_choice: { type: 'tool', name: 'followup' },
          messages: [{
            role: 'user',
            content: `Yesterday's ${meal.type} scored ${numbersOk ? meal.quality : 'below their usual'} out of 100.${numbersOk ? '' : ' Do not mention any number or score.'} Write the one message.`,
          }],
        });
        const block = msg.content.find((c) => c.type === 'tool_use');
        const out = block && 'input' in block ? (block.input as { message?: string }).message : null;
        if (out && typeof out === 'string' && out.trim()) text = out.trim().replace(/—/g, '-').slice(0, 400);
        await recordAiCall({ fn: 'ai-followup', mode: 'followup', userId: athleteId, model: MODEL, latencyMs: Date.now() - t0, ok: true, ...usageFrom(msg) });
      } catch {
        // Keep the deterministic message. The beat matters more than the prose, and a follow-up
        // that silently doesn't happen because an API had a bad minute is worse than a plain one.
        await recordAiCall({ fn: 'ai-followup', mode: 'followup', userId: athleteId, model: MODEL, latencyMs: Date.now() - t0, ok: false, errorCode: 'upstream_error' });
      }
      // Final rail: never ship style-violating language, even from the fallback.
      if (violatesStyleLanguage(text, planStyle)) { text = fallbackFollowUp(meal, false); blocked.style++; }
    }
    sends.push({ athleteId, meal, text });
  }

  // ---- PASS 2: the day-gap nudge about tonight ----
  const gap = await dayGapPass({
    svc, anthropic, now, dry, dates: [yesterdayUtc, todayUtc], todayUtc, blocked: gapBlocked,
    followupNow: new Set(sends.map((s) => s.athleteId)),
  });
  const daygap = { scanned: gap.scanned, blocked: gapBlocked } as Record<string, unknown>;

  if (dry) {
    return json({
      scanned: athleteIds.length, wouldSend: sends.length, blocked,
      sample: sends.slice(0, 3).map((s) => ({ meal: s.meal.id, text: s.text })),
      daygap: { ...daygap, wouldSend: gap.sends.length, sample: gap.sends.slice(0, 3).map((s) => ({ slot: s.nudge.slot, gap: s.nudge.gap, text: s.text })) },
    });
  }
  if (!sends.length && !gap.sends.length) return json({ scanned: athleteIds.length, sent: 0, blocked, daygap: { ...daygap, sent: 0 } });

  // WRITE ORDER: thread row, then notification, then push. The first two are durable; the push is
  // best-effort. A failed push must never mean the message does not exist.
  let wrote = 0;
  for (const s of sends) {
    const { error } = await svc.from('meal_comments').insert({
      meal_id: s.meal.id, athlete_id: s.athleteId, author_id: s.athleteId,
      role: 'ai', kind: 'message', text: s.text,
    });
    if (error) continue;
    wrote++;
    await svc.from('notifications').insert({
      user_id: s.athleteId, kind: notificationKind(s.meal.id),
      title: 'Your nutritionist', body: s.text.slice(0, 160),
    });
  }

  // The day-gap nudge has no meal thread to land on (the meal it is about is not logged yet), so
  // its durable record is the notification row alone; the bell routes it by kind.
  let gapWrote = 0;
  const gapSent: GapSend[] = [];
  for (const s of gap.sends) {
    const { error } = await svc.from('notifications').insert({
      user_id: s.athleteId, kind: dayGapKind(s.nudge.slot),
      title: 'Your nutritionist', body: s.text.slice(0, 160),
    });
    if (error) continue;
    gapWrote++;
    gapSent.push(s);
  }

  const all = [...sends.map((s) => s.athleteId), ...gapSent.map((s) => s.athleteId)];
  const { data: toks } = all.length
    ? await svc.from('device_tokens').select('token,user_id').in('user_id', all)
    : { data: [] };
  const byUser = new Map(sends.map((s) => [s.athleteId, s]));
  const gapByUser = new Map(gapSent.map((s) => [s.athleteId, s]));
  const messages: Array<Record<string, unknown>> = [];
  for (const t of (toks ?? []) as Array<{ token: string; user_id: string }>) {
    const s = byUser.get(t.user_id);
    if (s) {
      messages.push({
        to: t.token, title: 'Your nutritionist', body: s.text.slice(0, 160),
        data: { route: routeForMeal(s.meal.id) },
        // Normal priority: this is a conversation, not a scheduled commitment. It waits for DND.
        sound: 'default',
      });
    }
    const g = gapByUser.get(t.user_id);
    if (g) {
      messages.push({
        to: t.token, title: 'Your nutritionist', body: g.text.slice(0, 160),
        // Straight to the camera for the slot that closes the gap.
        data: { route: routeForSlot(g.nudge.slot) },
        sound: 'default',
      });
    }
  }
  const pushed = await pushAll(messages);

  return json({ scanned: athleteIds.length, sent: wrote, pushed, blocked, daygap: { ...daygap, sent: gapWrote } });
});
