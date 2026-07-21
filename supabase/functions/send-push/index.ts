// OnStandard — send-push: a coach/trainer nudges an athlete → an in-app notification PLUS a
// push to the athlete's device(s). Flow:
//   1) authorize the caller with THEIR jwt via can_view (must be linked to the athlete),
//   2) service-role: record the in-app notification (so it shows in the bell even with no token),
//   3) service-role: read the athlete's device tokens + POST to Expo's push API (best-effort).
// verify_jwt stays ON (default) — only a signed-in, linked overseer can call this.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

// CORS (2026-07-04 fix): send-push had NO CORS handling, so the browser preflight got a bare
// 405 and every coach comment / nudge notification silently failed on web. Mirror the AI
// functions: reflect an allowlisted Origin, allow native (no Origin). Set ALLOWED_ORIGINS to
// your web origin(s); native apps send no Origin and are always allowed.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return BASE_HEADERS;
  if (ALLOWED_ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS;
}

const json = (obj: unknown, status = 200, cors: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Best-effort per-IP rate limit (mirrors analyze-meal/assist) so a compromised overseer account
// can't spam pushes. In-memory/per-instance — blunts a single abusive caller. Tunable.
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '20');
const RL_WINDOW_MS = 60_000;
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request): boolean {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) { rlHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS }); return false; }
  e.count++;
  return e.count > RL_MAX;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (rateLimited(req)) return json({ error: 'rate limited, slow down' }, 429, cors);
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'unauthorized' }, 401, cors);

  let payload: {
    athlete_id?: string; title?: string; body?: string;
    /** Reverse direction (meal-conversation upgrade 2026-07-16): the ATHLETE notifies their
     *  linked coach staff about their own meal. Caller identity comes from the JWT; the link
     *  is verified server-side (active team membership → active staff). */
    to_coach?: boolean; kind?: string; urgent?: boolean; route?: string;
    /** Coach OS Slice C: push-only fan-out for an already-posted announcement (feed rows were
     *  already written by post_announcement — this mode must NEVER insert notifications). */
    announcement_id?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400, cors);
  }

  // ---------- coach announcement fan-out (announcement_id mode, push-only) ----------
  if (payload.announcement_id) {
    const svc0 = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: ann, error: annErr } = await svc0.from('announcements')
      .select('id,team_id,scope_kind,scope_value,title,body')
      .eq('id', payload.announcement_id).maybeSingle();
    if (annErr || !ann) return json({ error: 'announcement not found' }, 404, cors);

    // Authorize: caller must be an ACTIVE team_staff member of the announcement's team. Identity
    // comes from the caller's own JWT (never the service-role client) — mirrors the to_coach
    // pattern above.
    const caller0 = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: me0, error: meErr0 } = await caller0.auth.getUser();
    const callerId = me0?.user?.id;
    if (meErr0 || !callerId) return json({ error: 'unauthorized' }, 401, cors);
    const { data: staffRow } = await svc0.from('team_staff')
      .select('staff_id').eq('team_id', ann.team_id).eq('staff_id', callerId).eq('status', 'active').maybeSingle();
    if (!staffRow) return json({ error: 'not authorized for this team' }, 403, cors);

    // Resolve the SAME audience as post_announcement (0074_coach_os_slice_c.sql): active
    // team_members of this team, narrowed by scope. Mirror the RPC's matching semantics exactly.
    const { data: members } = await svc0.from('team_members')
      .select('athlete_id,position').eq('team_id', ann.team_id).eq('status', 'active');
    const active = members ?? [];
    let athleteIds: string[] = [];
    if (ann.scope_kind === 'team') {
      athleteIds = active.map((m: { athlete_id: string }) => m.athlete_id);
    } else if (ann.scope_kind === 'position') {
      const want = String(ann.scope_value ?? '').toUpperCase();
      athleteIds = active
        .filter((m: { position?: string | null }) => String(m.position ?? '').toUpperCase() === want)
        .map((m: { athlete_id: string }) => m.athlete_id);
    } else if (ann.scope_kind === 'athlete') {
      athleteIds = active
        .filter((m: { athlete_id: string }) => m.athlete_id === ann.scope_value)
        .map((m: { athlete_id: string }) => m.athlete_id);
    } else if (ann.scope_kind === 'group') {
      // The group row must belong to THIS team — same as the RPC's `g.team_id = p_team` guard —
      // so a scope_value from another team's group can never leak an audience cross-team.
      const { data: group } = await svc0.from('coach_groups')
        .select('athlete_ids').eq('id', ann.scope_value).eq('team_id', ann.team_id).maybeSingle();
      const groupSet = new Set<string>((group?.athlete_ids as string[] | null) ?? []);
      athleteIds = active
        .filter((m: { athlete_id: string }) => groupSet.has(m.athlete_id))
        .map((m: { athlete_id: string }) => m.athlete_id);
    }
    athleteIds = [...new Set(athleteIds)];
    if (!athleteIds.length) return json({ ok: true, pushed: 0 }, 200, cors);

    // Opt-out filter BEFORE token fetch — same convention as the athlete_id branch below.
    const { data: prefs0 } = await svc0.from('profiles')
      .select('id,notifications_opt_out').in('id', athleteIds);
    const optedOut0 = new Set((prefs0 ?? [])
      .filter((p: { notifications_opt_out?: boolean }) => p.notifications_opt_out === true)
      .map((p: { id: string }) => p.id));
    const targets0 = athleteIds.filter((id) => !optedOut0.has(id));
    if (!targets0.length) return json({ ok: true, pushed: 0 }, 200, cors);

    // NOTE: no `notifications` insert here — post_announcement already wrote every feed row.
    // This branch is push-only; writing here would double-deliver.
    const { data: toks0 } = await svc0.from('device_tokens').select('token').in('user_id', targets0);
    const tokens0 = (toks0 ?? []).map((t: { token: string }) => t.token).filter(Boolean);
    let pushed = 0;
    const title0 = (ann.title ?? 'Team announcement').slice(0, 120);
    const body0 = (ann.body ?? '').slice(0, 300);
    for (let i = 0; i < tokens0.length; i += 100) {
      const chunk = tokens0.slice(i, i + 100);
      try {
        const r0 = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk.map((to) => ({ to, title: title0, body: body0, sound: 'default' }))),
        });
        if (r0.ok) pushed += chunk.length;
      } catch { /* best-effort; feed rows already landed via post_announcement */ }
    }
    return json({ ok: true, pushed }, 200, cors);
  }

  // ---------- athlete → coach (to_coach mode) ----------
  if (payload.to_coach === true) {
    const caller = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: me, error: meErr } = await caller.auth.getUser();
    const athleteId2 = me?.user?.id;
    if (meErr || !athleteId2) return json({ error: 'unauthorized' }, 401, cors);
    const title2 = (payload.title ?? 'Athlete update').slice(0, 120);
    const body2 = (payload.body ?? '').slice(0, 300);
    const kind = /^[a-z_]{3,32}$/.test(payload.kind ?? '') ? (payload.kind as string) : 'meal_logged';
    const route = typeof payload.route === 'string' ? payload.route.slice(0, 120) : null;

    // Resolve the athlete's ACTIVE coach staff via service role (RLS-free, link-verified).
    const svc2 = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: memberships } = await svc2.from('team_members')
      .select('team_id').eq('athlete_id', athleteId2).eq('status', 'active');
    const teamIds = (memberships ?? []).map((m: { team_id: string }) => m.team_id);
    if (!teamIds.length) return json({ ok: true, pushed: 0, coaches: 0 }, 200, cors);
    const { data: staff } = await svc2.from('team_staff')
      .select('staff_id').in('team_id', teamIds).eq('status', 'active');
    const coachIds = [...new Set((staff ?? []).map((s: { staff_id: string }) => s.staff_id))]
      .filter((id) => id !== athleteId2).slice(0, 12);
    if (!coachIds.length) return json({ ok: true, pushed: 0, coaches: 0 }, 200, cors);

    // Durable in-app record for every coach (the unread item), regardless of push urgency.
    await svc2.from('notifications').insert(coachIds.map((id) => ({
      user_id: id, kind, title: title2, body: body2,
    })));

    // Device push: 'meal_logged' stays quiet (in-app record only); review/action classes
    // push, action with sound. Each coach's notifications_opt_out suppresses their push.
    let pushed = 0;
    if (payload.urgent === true || kind !== 'meal_logged') {
      const { data: prefs } = await svc2.from('profiles')
        .select('id,notifications_opt_out').in('id', coachIds);
      const optedOut = new Set((prefs ?? [])
        .filter((p: { notifications_opt_out?: boolean }) => p.notifications_opt_out === true)
        .map((p: { id: string }) => p.id));
      const targets = coachIds.filter((id) => !optedOut.has(id));
      if (targets.length) {
        const { data: toks2 } = await svc2.from('device_tokens').select('token,user_id').in('user_id', targets);
        const tokens2 = (toks2 ?? []).map((t: { token: string }) => t.token).filter(Boolean);
        if (tokens2.length) {
          try {
            const r2 = await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(tokens2.map((to) => ({
                to, title: title2, body: body2,
                sound: payload.urgent === true ? 'default' : undefined,
                ...(route ? { data: { route } } : {}),
              }))),
            });
            if (r2.ok) pushed = tokens2.length;
          } catch { /* best-effort; the in-app rows already landed */ }
        }
      }
    }
    return json({ ok: true, pushed, coaches: coachIds.length }, 200, cors);
  }

  const athleteId = payload.athlete_id;
  if (!athleteId) return json({ error: 'athlete_id required' }, 400, cors);
  const title = (payload.title ?? 'Your coach sent a nudge').slice(0, 120);
  const message = (payload.body ?? '').slice(0, 300);

  // 1) Authorize with the CALLER's jwt: can_view is true only if they're linked to the athlete.
  const caller = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: allowed, error: viewErr } = await caller.rpc('can_view', { athlete: athleteId });
  if (viewErr || allowed !== true) return json({ error: 'not authorized for this athlete' }, 403, cors);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1b) Idempotency guard: a retried client call or a double-tap on the same nudge button
  // should not double-deliver. Skip if this athlete already got a 'nudge' in the last 2 minutes —
  // long enough to absorb a retry/double-submit, short enough that a coach nudging again
  // moments later (different reason) still goes through.
  const DEDUPE_WINDOW_MS = 2 * 60_000;
  const { data: recentNudge, error: dedupeErr } = await svc.from('notifications')
    .select('id').eq('user_id', athleteId).eq('kind', 'nudge')
    .gte('created_at', new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()).limit(1).maybeSingle();
  if (!dedupeErr && recentNudge) return json({ ok: true, pushed: 0, deduped: true }, 200, cors);

  // 2) Record the in-app notification (service role bypasses the self-only insert policy).
  await svc.from('notifications').insert({ user_id: athleteId, kind: 'nudge', title, body: message });

  // 2b) Honor the athlete's notification preference for the PUSH. The in-app notification above is
  // the durable record and always lands (it shows in the bell); we only suppress the device push
  // when they turned notifications OFF. Resilient / fail-open: if notifications_opt_out (0067) is
  // not applied yet the check errors and we push exactly as before.
  const { data: pref, error: prefErr } = await svc.from('profiles')
    .select('notifications_opt_out').eq('id', athleteId).maybeSingle();
  if (!prefErr && pref?.notifications_opt_out === true) {
    return json({ ok: true, pushed: 0, suppressed: 'notifications_off' }, 200, cors);
  }

  // 3) Push to the athlete's registered devices (best-effort; the feed entry is already saved).
  const { data: toks } = await svc.from('device_tokens').select('token').eq('user_id', athleteId);
  const tokens = (toks ?? []).map((t: { token: string }) => t.token).filter(Boolean);
  let pushed = 0;
  if (tokens.length > 0) {
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tokens.map((to) => ({ to, title, body: message, sound: 'default' }))),
      });
      if (r.ok) pushed = tokens.length;
    } catch {
      /* push is best-effort; the in-app notification already landed */
    }
  }
  return json({ ok: true, pushed }, 200, cors);
});
