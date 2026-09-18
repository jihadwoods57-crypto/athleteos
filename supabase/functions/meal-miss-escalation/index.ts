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
import { missedTasks, closingTasks, missBody, coachDigestBody } from '../_shared/meal-miss.ts';
// Expo answers a refused batch with HTTP 200 + per-message error tickets, so `r.ok` counted
// refusals as deliveries. These read the tickets; see _shared/expo-push.mjs.
import { sendExpoPush, sendExpoPushAndPrune } from '../_shared/expo-push.mjs';

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

/** Same rule as send-push: minutes after local midnight in the person's own timezone (0221). */
function inQuietHours(fromMin: number | null | undefined, toMin: number | null | undefined, tz: string | null | undefined, nowMs: number): boolean {
  if (fromMin == null || toMin == null || !Number.isFinite(fromMin) || !Number.isFinite(toMin)) return false;
  let local: number;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(nowMs));
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    local = h * 60 + m;
  } catch { return false; }
  return fromMin <= toMin ? (local >= fromMin && local < toMin) : (local >= fromMin || local < toMin);
}

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
  // No misses is not "nothing to do": the closing rung below still runs. The early returns
  // that used to sit here skipped it.

  // THE OPT-OUT IS NOT ADVISORY. profiles.notifications_opt_out is the athlete's own switch, and
  // an accountability feature that ignores it is just spam with a mission statement. Checked
  // before a single row is written, not filtered at push time, so a muted athlete does not even
  // accumulate notification rows.
  const { data: prefs } = await svc
    .from('profiles').select('id,notifications_opt_out').in('id', misses.map((m) => m.athleteId));
  const muted = new Set(((prefs ?? []) as Array<{ id: string; notifications_opt_out: unknown }>)
    .filter((p) => p.notifications_opt_out === true).map((p) => p.id));
  const audible = misses.filter((m) => !muted.has(m.athleteId));


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

  const { data: toks } = fresh.length
    ? await svc.from('device_tokens').select('token,user_id').in('user_id', fresh.map((m) => m.athleteId))
    : { data: [] as Array<{ token: string; user_id: string }> };
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

  // The notification rows are already durable; `pushed` is what Expo ACCEPTED, never what we sent.
  const athleteOut = await sendExpoPush(messages as Array<Record<string, unknown>>);
  const pushed = athleteOut.sent;
  if (athleteOut.failed) console.error('meal-miss-escalation: athlete push refused', athleteOut.failed, athleteOut.errors.join('; '));

  // ---- L3: the coach, batched. ONE line per coach per day naming who missed, never one per
  // miss. The digest is written as a notification row for the same reason as above. ----
  const coachPushes: Array<{ coachId: string; title: string; body: string; route: string; gate: 'onLate' | 'onClosing' }> = [];
  let digests = 0;
  // An athlete's coaches are their team's ACTIVE STAFF — the same definition the RLS predicate
  // is_team_coach_of() uses (team_members join team_staff). team_members carries no coach_id, and
  // teams.created_by would silently drop every assistant, so this walks the same path the
  // database itself considers authoritative.
  const { data: mem } = fresh.length
    ? await svc.from('team_members').select('athlete_id,team_id').in('athlete_id', fresh.map((m) => m.athleteId)).eq('status', 'active')
    : { data: [] as Array<{ athlete_id: string; team_id: string }> };
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
      coachPushes.push({ coachId, title: 'Missed today', body: body.slice(0, 160), route: 'coach-home', gate: 'onLate' });
    }
  }

  // ---- THE HEADS-UP (founder 2026-09-15: "if a player is about to be late"). Windows closing
  // within CLOSING_LEAD_MIN with nothing logged, told to the coach as one line per athlete per
  // window. Deduped per coach on the kind (athlete-scoped) within the last hour, so the 15-minute
  // cron cannot repeat itself. The athlete already has their own pre-deadline reminder
  // (notify-plan.js, device-scheduled); this is the coach's. ----
  let closings = 0;
  {
    const closing: Array<{ athleteId: string; id: string; minutesLeft: number }> = [];
    for (const d of (days ?? []) as DayRow[]) {
      const found = closingTasks(d.tasks, now);
      if (!found.length) continue;
      closing.push({ athleteId: d.athlete_id, id: found[0].id, minutesLeft: found[0].minutesLeft });
    }
    if (closing.length) {
      const { data: cmem } = await svc
        .from('team_members').select('athlete_id,team_id')
        .in('athlete_id', closing.map((c) => c.athleteId)).eq('status', 'active');
      const cTeamIds = [...new Set(((cmem ?? []) as Array<{ team_id: string }>).map((r) => r.team_id).filter(Boolean))];
      const { data: cstaff } = cTeamIds.length
        ? await svc.from('team_staff').select('team_id,staff_id').in('team_id', cTeamIds).eq('status', 'active')
        : { data: [] as Array<{ team_id: string; staff_id: string }> };
      const { data: cpcs } = await svc
        .from('practice_clients').select('athlete_id,practice_id')
        .in('athlete_id', closing.map((c) => c.athleteId)).eq('status', 'active');
      const cPracticeIds = [...new Set(((cpcs ?? []) as Array<{ practice_id: string }>).map((r) => r.practice_id).filter(Boolean))];
      const { data: cowners } = cPracticeIds.length
        ? await svc.from('practices').select('id,owner_id').in('id', cPracticeIds)
        : { data: [] as Array<{ id: string; owner_id: string }> };
      const staffOf = new Map<string, string[]>();
      for (const s2 of ((cstaff ?? []) as Array<{ team_id: string; staff_id: string }>)) {
        staffOf.set(s2.team_id, [...(staffOf.get(s2.team_id) ?? []), s2.staff_id]);
      }
      const ownerOf = new Map(((cowners ?? []) as Array<{ id: string; owner_id: string }>).map((o) => [o.id, o.owner_id]));
      const coachesOf = new Map<string, Set<string>>();
      for (const l of ((cmem ?? []) as Array<{ athlete_id: string; team_id: string }>)) {
        for (const c of (staffOf.get(l.team_id) ?? [])) coachesOf.set(l.athlete_id, new Set([...(coachesOf.get(l.athlete_id) ?? []), c]));
      }
      for (const l of ((cpcs ?? []) as Array<{ athlete_id: string; practice_id: string }>)) {
        const o = ownerOf.get(l.practice_id);
        if (o) coachesOf.set(l.athlete_id, new Set([...(coachesOf.get(l.athlete_id) ?? []), o]));
      }
      const ids = [...new Set(closing.map((c) => c.athleteId))];
      const { data: names } = await svc.from('profiles').select('id,full_name').in('id', ids);
      const nameOf = new Map(((names ?? []) as Array<{ id: string; full_name: string | null }>)
        .map((r) => [r.id, (r.full_name || 'An athlete').split(' ')[0]]));
      const hourAgo = new Date(now - 3600000).toISOString();
      for (const c of closing) {
        const kind = `athlete_closing:${c.athleteId}`;
        const title = `${nameOf.get(c.athleteId) ?? 'An athlete'} is about to be late`;
        const body = `${titleFor(c.id)} closes in ${c.minutesLeft} min and nothing is logged.`;
        for (const coachId of (coachesOf.get(c.athleteId) ?? [])) {
          const { data: had } = await svc.from('notifications')
            .select('id').eq('user_id', coachId).eq('kind', kind).gte('created_at', hourAgo).limit(1);
          if (had && had.length) continue;
          const { error: cerr } = await svc.from('notifications').insert({ user_id: coachId, kind, title, body });
          if (cerr) continue;
          closings++;
          coachPushes.push({ coachId, title, body, route: `coach-athlete/${c.athleteId}`, gate: 'onClosing' });
        }
      }
    }
  }

  // ---- The coach's device, once per line above, through the coach's own switches (0236) and
  // quiet hours (0221). The bell rows are already durable; this is the phone buzzing. ----
  let coachPushed = 0;
  if (coachPushes.length) {
    const coachIds = [...new Set(coachPushes.map((p) => p.coachId))];
    const { data: cprefs } = await svc.from('profiles')
      .select('id,notifications_opt_out,coach_notify,quiet_from_min,quiet_to_min,timezone').in('id', coachIds);
    type Pref = { id: string; notifications_opt_out?: boolean | null; coach_notify?: Record<string, unknown> | null;
      quiet_from_min?: number | null; quiet_to_min?: number | null; timezone?: string | null };
    const prefOf = new Map(((cprefs ?? []) as Pref[]).map((p) => [p.id, p]));
    const allowed = coachPushes.filter((p) => {
      const pr = prefOf.get(p.coachId);
      if (!pr || pr.notifications_opt_out === true) return false;
      const cn = (pr.coach_notify && typeof pr.coach_notify === 'object') ? pr.coach_notify : {};
      if ((cn as Record<string, unknown>)[p.gate] === false) return false;
      return !inQuietHours(pr.quiet_from_min, pr.quiet_to_min, pr.timezone, now);
    });
    if (allowed.length) {
      const { data: ctoks } = await svc.from('device_tokens').select('token,user_id').in('user_id', [...new Set(allowed.map((p) => p.coachId))]);
      const tokensOf = new Map<string, string[]>();
      for (const t of ((ctoks ?? []) as Array<{ token: string; user_id: string }>)) tokensOf.set(t.user_id, [...(tokensOf.get(t.user_id) ?? []), t.token]);
      const msgs = allowed.flatMap((p) => (tokensOf.get(p.coachId) ?? []).map((to) => ({ to, title: p.title, body: p.body, data: { route: p.route } })));
      const coachOut = await sendExpoPushAndPrune(msgs, svc);
      coachPushed += coachOut.sent;
      if (coachOut.failed) console.error('meal-miss-escalation: coach push refused', coachOut.failed, coachOut.errors.join('; '));
    }
  }

  return json({ scanned: (days ?? []).length, sent, pushed, digests, closings, coachPushed });
});
