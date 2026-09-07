// OnStandard — meal-miss-escalation: the absence half of accountability.
//
// WHY THIS EXISTS
// Every notification this product emitted was triggered by COMPLIANCE — meal_logged, meal_review,
// meal_action. Miss lunch and nothing fired, to anyone, until a coach digest the next morning.
// Accountability is entirely about what happens when you DON'T, so the one thing the product is
// named for was pointed the wrong way round. Measured on the live database (2026-09-07): 78 meals
// logged, 9 coach opens, 2 coach comments, and 88 of 108 thread messages written by the AI. The
// athlete was being watched almost entirely by a bot, and only ever when they did the right thing.
//
// The ladder for absence already existed and was good — commitment-escalation claims missed
// deadlines, breaks through to the athlete, digests the coach, has a kill switch, never fires a
// rung twice. It was wired to COMMITMENTS, of which the database holds exactly one. This points
// the same shape at the meal standard, which is what athletes actually do three times a day.
//
// THE SHAPE (founder ruling 2026-09-07): IMMEDIATE to the athlete, BATCHED to the coach. A miss is
// still actionable for the athlete right now — they can eat. Per-miss pushes across a roster would
// make a coach unreachable within a week, so the coach gets one line naming who, once.
//
// WHAT THIS FUNCTION MAY NOT DO: derive a deadline. One line runs through this codebase — "the
// athlete's local clock is the only honest source, the server never derives timing". The client
// writes `dueAt` into days.tasks from its own clock; this function only COMPARES (_shared/
// meal-miss.ts). A second deadline engine here would drift from the client's, which is the
// two-authorities bug that made the meal thread quote 23g under a card reading 29g.
//
// KNOWN BOUNDARY, stated rather than hidden: an athlete whose app never opened today has no day
// row, so no `dueAt`, so no miss is raised for them. That is the correct failure for THIS function
// (a false "you missed breakfast" is far more expensive than a quiet one), but it means the
// fully-absent athlete is still unaddressed — that was the roll call's job and the roll call is
// off. Do not paper over it here by inventing a default window.
//
// Deploy:
//   supabase functions deploy meal-miss-escalation --use-api --no-verify-jwt
//   supabase secrets set MEAL_MISS_CRON_KEY=<long random string>
// Then schedule every 15 minutes with header x-miss-key: <key>.

import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { missedTasks, missBody, coachDigestBody } from '../_shared/meal-miss.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_KEY = Deno.env.get('MEAL_MISS_CRON_KEY') ?? '';
// The kill switch mirrors commitment-escalation's: one env var stops the ladder without a deploy.
const KILL = (Deno.env.get('MEAL_MISS_KILL') ?? '').toLowerCase() === 'true';

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

/** Constant-time compare of the shared cron key — mirrors commitment-reminders. */
function safeEqual(a: string, b: string): boolean {
  const e = new TextEncoder();
  const ab = e.encode(a), bb = e.encode(b);
  if (ab.length !== bb.length) return false;
  let d = 0;
  for (let i = 0; i < ab.length; i++) d |= ab[i] ^ bb[i];
  return d === 0;
}

/** Human titles for the standard slots. Anything else is Title-Cased from its own id, so a
 *  coach-defined slot ("meal-5") still reads like a thing rather than a key. */
const TITLES: Record<string, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Your snack',
  recovery: 'Your check-in', weight: 'Your weigh-in',
};
const titleFor = (id: string) =>
  TITLES[id] ?? id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

type DayRow = { athlete_id: string; date: string; tasks: unknown };

Deno.serve(async (req) => {
  if (!CRON_KEY || !safeEqual(req.headers.get('x-miss-key') ?? '', CRON_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (KILL) return json({ killed: true, sent: 0 });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'unconfigured' }, 503);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = Date.now();

  // Only days that could still be today somewhere on earth. Two calendar dates covers every
  // timezone without scanning history.
  const today = new Date(now).toISOString().slice(0, 10);
  const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
  const { data: days, error } = await svc
    .from('days').select('athlete_id,date,tasks').in('date', [yesterday, today]);
  if (error) return json({ error: 'days_read_failed' }, 500);

  // Who missed what. The comparison is the whole of this function's timing authority.
  const misses: Array<{ athleteId: string; date: string; id: string; minutesLate: number; remaining: number }> = [];
  for (const d of (days ?? []) as DayRow[]) {
    const found = missedTasks(d.tasks, now);
    if (!found.length) continue;
    const tasks = Array.isArray(d.tasks) ? d.tasks as Array<{ done?: unknown }> : [];
    const openAfter = tasks.filter((t) => t && t.done !== true).length - found.length;
    // Only the single most-neglected requirement per athlete per run. An athlete who has let two
    // slide does not need two pushes about it; they need to be told the oldest one, once.
    const worst = found[0];
    misses.push({
      athleteId: d.athlete_id, date: d.date, id: worst.id,
      minutesLate: worst.minutesLate, remaining: Math.max(0, openAfter),
    });
  }
  if (!misses.length) return json({ scanned: (days ?? []).length, sent: 0, digests: 0 });

  // THE OPT-OUT IS NOT ADVISORY. profiles.notifications_opt_out is the athlete's own switch, and
  // an accountability feature that ignores it is just spam with a mission statement. Checked
  // before a single row is written, not filtered at push time, so a muted athlete does not even
  // accumulate notification rows.
  const { data: prefs } = await svc
    .from('profiles').select('id,notifications_opt_out').in('id', misses.map((m) => m.athleteId));
  const muted = new Set(((prefs ?? []) as Array<{ id: string; notifications_opt_out: unknown }>)
    .filter((p) => p.notifications_opt_out === true).map((p) => p.id));
  const audible = misses.filter((m) => !muted.has(m.athleteId));
  if (!audible.length) return json({ scanned: (days ?? []).length, sent: 0, digests: 0, muted: muted.size });

  // DEDUPE: one notification per athlete per requirement per day, ever. The kind carries all
  // three, so the uniqueness lives in data rather than in this function remembering anything —
  // the same reasoning that keeps commitment-escalation's rungs from firing twice.
  const kindOf = (m: { date: string; id: string }) => `meal_missed:${m.date}:${m.id}`;
  const { data: already } = await svc
    .from('notifications').select('user_id,kind')
    .in('user_id', audible.map((m) => m.athleteId))
    .in('kind', audible.map(kindOf));
  const seen = new Set(((already ?? []) as Array<{ user_id: string; kind: string }>).map((r) => `${r.user_id}|${r.kind}`));
  const fresh = audible.filter((m) => !seen.has(`${m.athleteId}|${kindOf(m)}`));
  if (!fresh.length) return json({ scanned: (days ?? []).length, sent: 0, digests: 0, deduped: audible.length });

  // ---- L2: the athlete, immediately. Durable row first, push second: a failed push must never
  // mean the message did not exist. ----
  let sent = 0;
  for (const m of fresh) {
    const body = missBody(titleFor(m.id), m.minutesLate, m.remaining);
    const { error: nerr } = await svc.from('notifications').insert({
      user_id: m.athleteId, kind: kindOf(m), title: 'Still open', body: body.slice(0, 160),
    });
    if (!nerr) sent++;
  }

  const { data: toks } = await svc
    .from('device_tokens').select('token,user_id').in('user_id', fresh.map((m) => m.athleteId));
  const byUser = new Map(fresh.map((m) => [m.athleteId, m]));
  const messages = ((toks ?? []) as Array<{ token: string; user_id: string }>)
    .map((t) => {
      const m = byUser.get(t.user_id);
      if (!m) return null;
      return {
        to: t.token, title: 'Still open',
        body: missBody(titleFor(m.id), m.minutesLate, m.remaining).slice(0, 160),
        // Straight to the camera for the slot they missed: the message is only useful if the
        // thing it asks for is one tap away.
        data: { route: `camera/${m.id}` },
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
    } catch { /* the notification row is already durable */ }
  }

  // ---- L3: the coach, batched. ONE line per coach per day naming who missed, never one per
  // miss. The digest is written as a notification row for the same reason as above. ----
  let digests = 0;
  // An athlete's coaches are their team's ACTIVE STAFF — the same definition the RLS predicate
  // is_team_coach_of() uses (team_members join team_staff). team_members carries no coach_id, and
  // teams.created_by would silently drop every assistant, so this walks the same path the
  // database itself considers authoritative.
  const { data: mem } = await svc
    .from('team_members').select('athlete_id,team_id')
    .in('athlete_id', fresh.map((m) => m.athleteId)).eq('status', 'active');
  const teamIds = [...new Set(((mem ?? []) as Array<{ team_id: string }>).map((r) => r.team_id).filter(Boolean))];
  const { data: staff } = teamIds.length
    ? await svc.from('team_staff').select('team_id,staff_id').in('team_id', teamIds).eq('status', 'active')
    : { data: [] as Array<{ team_id: string; staff_id: string }> };
  const staffByTeam = new Map<string, string[]>();
  for (const s2 of ((staff ?? []) as Array<{ team_id: string; staff_id: string }>)) {
    const arr = staffByTeam.get(s2.team_id) ?? [];
    arr.push(s2.staff_id);
    staffByTeam.set(s2.team_id, arr);
  }
  const byCoach = new Map<string, string[]>();
  for (const l of ((mem ?? []) as Array<{ athlete_id: string; team_id: string }>)) {
    for (const coachId of (staffByTeam.get(l.team_id) ?? [])) {
      const arr = byCoach.get(coachId) ?? [];
      if (!arr.includes(l.athlete_id)) arr.push(l.athlete_id);
      byCoach.set(coachId, arr);
    }
  }
  if (byCoach.size) {
    const ids = [...new Set([...byCoach.values()].flat())];
    // Names live on profiles.full_name — athlete_profiles has no name column at all.
    const { data: names } = await svc.from('profiles').select('id,full_name').in('id', ids);
    const nameOf = new Map(((names ?? []) as Array<{ id: string; full_name: string | null }>)
      .map((r) => [r.id, (r.full_name || 'An athlete').split(' ')[0]]));
    for (const [coachId, athleteIds] of byCoach) {
      const digestKind = `miss_digest:${today}`;
      const { data: had } = await svc.from('notifications')
        .select('id').eq('user_id', coachId).eq('kind', digestKind).limit(1);
      if (had && had.length) continue; // one per coach per day, no matter how many misses land
      const body = coachDigestBody(athleteIds.map((a) => nameOf.get(a) ?? 'An athlete'), athleteIds.length);
      if (!body) continue;
      const { error: derr } = await svc.from('notifications').insert({
        user_id: coachId, kind: digestKind, title: 'Missed today', body: body.slice(0, 160),
      });
      if (!derr) digests++;
    }
  }

  return json({ scanned: (days ?? []).length, sent, pushed, digests });
});
