// OnStandard — weekly-digest: the coach's proof-of-value receipt (churn build 2026-07-04).
//
// A coach cancels when he can't tell the product is working. Once a week this sends every
// coach/trainer a digest of their roster's week — logged days, team average, and who has
// gone silent — as an in-app notification AND a device push, so even a coach who hasn't
// opened the app gets reminded it's earning its keep. Numbers are computed HERE from the
// same days rows the dashboard reads; nothing is invented, and a roster with zero athletes
// gets an activation nudge, not a fake stat.
//
// INVOCATION: scheduled. Protected by a shared key so only the scheduler can fire it
// (deploy with --no-verify-jwt; a browser/anon caller without the key gets 401):
//   supabase secrets set DIGEST_CRON_KEY=<long random string>
//   supabase functions deploy weekly-digest --use-api --no-verify-jwt
// Then schedule it weekly (Supabase Dashboard -> Integrations -> Cron -> HTTP request, or
// the SQL helper in migration 0044): POST <url>/functions/v1/weekly-digest with header
// x-digest-key: <the same key>. Recommended: Sunday 18:00 team-local.
import { createClient } from 'npm:@supabase/supabase-js@^2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_KEY = Deno.env.get('DIGEST_CRON_KEY') ?? '';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Constant-time compare of the shared cron key so the check leaks no timing signal about how many
// leading bytes matched (audit 2026-07-12; belt-and-suspenders given the key is long + random).
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** Local ISO date N days ago (UTC-based; the digest is a weekly summary, not a clock). */
function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

interface DayLite { athlete_id: string; date: string; score: number | null }

/** One owner's digest copy from their athletes' week. Factual, no guilt, no em dash. */
function digestBody(
  athleteIds: string[],
  days: DayLite[],
  names: Map<string, string>,
): { title: string; body: string } {
  const mine = new Set(athleteIds);
  const week = days.filter((d) => mine.has(d.athlete_id));
  const loggedScores = week.map((d) => d.score).filter((s): s is number => typeof s === 'number');
  const avg = loggedScores.length > 0 ? Math.round(loggedScores.reduce((a, b) => a + b, 0) / loggedScores.length) : null;

  // Silent = no logged day in the last 3 days — the exact athlete accountability exists for.
  const cutoff = daysAgo(2);
  const recent = new Set(week.filter((d) => d.date >= cutoff).map((d) => d.athlete_id));
  const silent = athleteIds.filter((id) => !recent.has(id));
  const silentNames = silent
    .map((id) => (names.get(id) ?? '').split(' ')[0])
    .filter(Boolean)
    .slice(0, 3);

  if (athleteIds.length === 0) {
    return {
      title: 'Your OnStandard week',
      body: 'No athletes on your roster yet. Share your join code and your first weekly report starts building.',
    };
  }
  const parts: string[] = [];
  parts.push(`${week.length} logged ${week.length === 1 ? 'day' : 'days'} across ${athleteIds.length} ${athleteIds.length === 1 ? 'athlete' : 'athletes'}`);
  if (avg != null) parts.push(`team average ${avg}`);
  let tail: string;
  if (silent.length === 0) {
    tail = 'Nobody went silent this week.';
  } else {
    const who = silentNames.length > 0
      ? `${silentNames.join(', ')}${silent.length > silentNames.length ? ` and ${silent.length - silentNames.length} more` : ''}`
      : `${silent.length}`;
    tail = `${silent.length === 1 ? 'One athlete has' : `${silent.length} athletes have`} not logged in 3+ days: ${who}. A quick check-in usually restarts them.`;
  }
  return {
    title: 'Your OnStandard week',
    body: `${parts.join(', ')}. ${tail}`,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  // The shared-key gate is the endpoint's ONLY caller auth (deployed with JWT off so the
  // scheduler can call it). No key configured = fail closed, never open.
  if (!CRON_KEY || !safeEqual(req.headers.get('x-digest-key') ?? '', CRON_KEY)) return json({ error: 'unauthorized' }, 401);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server not configured' }, 500);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    // 1) Owners and their athletes: team coaches (created_by) + practice trainers (owner_id).
    const [teamsRes, membersRes, practicesRes, clientsRes] = await Promise.all([
      svc.from('teams').select('id, created_by'),
      svc.from('team_members').select('team_id, athlete_id, status'),
      svc.from('practices').select('id, owner_id'),
      svc.from('practice_clients').select('practice_id, client_id, status'),
    ]);
    const rosters = new Map<string, Set<string>>(); // owner -> athlete ids
    const teamOwner = new Map((teamsRes.data ?? []).map((t) => [t.id, t.created_by]).filter(([, o]) => !!o) as [string, string][]);
    for (const m of membersRes.data ?? []) {
      if (m.status !== 'active') continue;
      const owner = teamOwner.get(m.team_id);
      if (!owner) continue;
      if (!rosters.has(owner)) rosters.set(owner, new Set());
      rosters.get(owner)!.add(m.athlete_id);
    }
    const practiceOwner = new Map((practicesRes.data ?? []).map((p) => [p.id, p.owner_id]) as [string, string][]);
    for (const pc of clientsRes.data ?? []) {
      if (pc.status !== 'active') continue;
      const owner = practiceOwner.get(pc.practice_id);
      if (!owner) continue;
      if (!rosters.has(owner)) rosters.set(owner, new Set());
      rosters.get(owner)!.add(pc.client_id);
    }
    if (rosters.size === 0) return json({ ok: true, digests: 0 });

    // Honor the notification preference server-side (GDPR/PECR: a coach who turned notifications
    // OFF must not receive this automated engagement digest). Resilient / fail-open: if the
    // notifications_opt_out column is not applied yet the filter errors and we send as before,
    // so function-deploy vs migration-apply order is not load-bearing.
    const ownerIds = [...rosters.keys()];
    let optedOut = new Set<string>();
    {
      const { data: outs, error: outErr } = await svc.from('profiles')
        .select('id').eq('notifications_opt_out', true).in('id', ownerIds);
      if (!outErr && outs) optedOut = new Set(outs.map((r: { id: string }) => r.id));
    }

    // 2) The week's day rows + names for every rostered athlete, in two bulk reads.
    const allAthletes = [...new Set([...rosters.values()].flatMap((s) => [...s]))];
    const [daysRes, profRes] = await Promise.all([
      svc.from('days').select('athlete_id, date, score').gte('date', daysAgo(6)).in('athlete_id', allAthletes),
      svc.from('profiles').select('id, full_name').in('id', allAthletes),
    ]);
    const days = (daysRes.data ?? []) as DayLite[];
    const names = new Map((profRes.data ?? []).map((p) => [p.id, p.full_name ?? '']));

    // 2b) Idempotency guard: a digest already sent for this owner in the last 6 days means the
    // scheduler fired twice in the same window (manual re-trigger, misconfigured cron) — skip it
    // rather than double-deliver. Reduces the risk without a hard DB constraint; the cron only
    // fires weekly in practice, so a same-week re-fire is the one failure mode worth guarding.
    let alreadySent = new Set<string>();
    {
      const { data: recentDigests, error: rdErr } = await svc.from('notifications')
        .select('user_id').eq('kind', 'digest').gte('created_at', new Date(Date.now() - 6 * 86_400_000).toISOString())
        .in('user_id', ownerIds);
      if (!rdErr && recentDigests) alreadySent = new Set(recentDigests.map((r: { user_id: string }) => r.user_id));
    }

    // 3) One digest per owner: in-app feed row + best-effort push to their devices.
    let sent = 0;
    let deduped = 0;
    for (const [owner, athletes] of rosters) {
      if (optedOut.has(owner)) continue; // respect the owner's notifications-off preference
      if (alreadySent.has(owner)) { deduped++; continue; } // this week's digest already landed
      const { title, body } = digestBody([...athletes], days, names);
      await svc.from('notifications').insert({ user_id: owner, kind: 'digest', title, body });
      const { data: toks } = await svc.from('device_tokens').select('token').eq('user_id', owner);
      const tokens = (toks ?? []).map((t: { token: string }) => t.token).filter(Boolean);
      if (tokens.length > 0) {
        try {
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default' }))),
          });
        } catch { /* push is best-effort; the feed entry already landed */ }
      }
      sent++;
    }
    return json({ ok: true, digests: sent, deduped });
  } catch (e) {
    console.error('weekly-digest error:', e);
    return json({ error: 'digest failed' }, 500);
  }
});
