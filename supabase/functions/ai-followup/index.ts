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
// WHERE IT LANDS
// On YESTERDAY's meal thread (meal-view/<id>), not today's slot. Today's dinner is not logged yet,
// so a message about it would open an empty screen; the meal being discussed is where its context,
// its photo and its numbers already live. The AI row goes into meal_comments exactly as meal-chat
// already writes it, so no new storage exists for this feature.
//
// INVOCATION: hourly, shared-key protected (deploy with --no-verify-jwt):
//   supabase secrets set AI_FOLLOWUP_CRON_KEY=<long random string>
//   supabase functions deploy ai-followup --no-verify-jwt
//   select cron.schedule('ai-followup-hourly','5 * * * *', $$ ... net.http_post ... $$);
// Add ?dry=1 to see the selection without writing anything.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { recordAiCall, usageFrom } from '../_shared/ai-telemetry.ts';
import { checkSpend, EST_USD } from '../_shared/spend-gate.ts';
import { flagOn } from '../_shared/feature-flags.ts';
import { loadPlanStyleForAthlete } from '../_shared/plan-style-load.ts';
import { violatesStyleLanguage, styleShowsNumbers, type PlanStyle } from '../_shared/plan-style.ts';
import {
  inLocalWindow, localDateISO, pickFollowUpMeal, fallbackFollowUp, routeForMeal, notificationKind,
  type MealRow,
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

Deno.serve(async (req) => {
  if (!CRON_KEY || !safeEqual(req.headers.get('x-followup-key') ?? '', CRON_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'not configured' }, 500);

  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const blocked = { flag: 0, window: 0, dedup: 0, global: 0, nothing: 0, style: 0 };

  // SPEND FIRST, before any claim is burned. Fails closed: if the ceiling cannot be read, nobody
  // gets a follow-up, which is the right direction for a non-essential paid feature.
  const spend = await checkSpend(EST_USD.text);
  if (!spend.allowed) return json({ sent: 0, aborted: 'spend', reason: spend.reason });

  const now = new Date();
  const yesterdayUtc = new Date(now.getTime() - 24 * 3600_000).toISOString().slice(0, 10);
  const todayUtc = now.toISOString().slice(0, 10);

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
  if (!athleteIds.length) return json({ scanned: 0, sent: 0, blocked });

  // Timezones + notification opt-out, one read.
  const { data: profs } = await svc
    .from('profiles').select('id,timezone,notifications_opt_out').in('id', athleteIds);
  const profById = new Map<string, { timezone: string | null; notifications_opt_out?: boolean | null }>();
  for (const p of (profs ?? []) as Array<{ id: string; timezone: string | null; notifications_opt_out?: boolean | null }>) {
    profById.set(p.id, p);
  }

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
  const sends: Array<{ athleteId: string; meal: MealRow; text: string }> = [];

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
    if ((Array.isArray(claim) ? claim[0] : claim)?.allowed === false) { blocked.dedup++; continue; }

    // Global daily budget across everyone — the backstop on a runaway day.
    const { data: gclaim } = await svc.rpc('claim_ai_usage_key', { p_key: `followup_global:${todayUtc}`, p_limit: DAILY_GLOBAL });
    if ((Array.isArray(gclaim) ? gclaim[0] : gclaim)?.allowed === false) { blocked.global++; break; }

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

  if (dry) return json({ scanned: athleteIds.length, wouldSend: sends.length, blocked, sample: sends.slice(0, 3).map((s) => ({ meal: s.meal.id, text: s.text })) });
  if (!sends.length) return json({ scanned: athleteIds.length, sent: 0, blocked });

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

  const { data: toks } = await svc.from('device_tokens').select('token,user_id').in('user_id', sends.map((s) => s.athleteId));
  const byUser = new Map(sends.map((s) => [s.athleteId, s]));
  const messages = ((toks ?? []) as Array<{ token: string; user_id: string }>)
    .map((t) => {
      const s = byUser.get(t.user_id);
      if (!s) return null;
      return {
        to: t.token, title: 'Your nutritionist', body: s.text.slice(0, 160),
        data: { route: routeForMeal(s.meal.id) },
        // Normal priority: this is a conversation, not a scheduled commitment. It waits for DND.
        sound: 'default',
      };
    })
    .filter(Boolean);

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

  return json({ scanned: athleteIds.length, sent: wrote, pushed, blocked });
});
