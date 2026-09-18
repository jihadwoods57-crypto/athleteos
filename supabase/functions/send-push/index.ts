// OnStandard — send-push: a coach/trainer nudges an athlete → an in-app notification PLUS a
// push to the athlete's device(s). Flow:
//   1) authorize the caller with THEIR jwt via can_view (must be linked to the athlete),
//   2) service-role: record the in-app notification (so it shows in the bell even with no token),
//   3) service-role: read the athlete's device tokens + POST to Expo's push API (best-effort).
// verify_jwt stays ON (default) — only a signed-in, linked overseer can call this.
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { clientIpFrom } from '../_shared/client-ip.ts';
import { sanitizeBulkPayload, aggregateBulkResults } from './logic.mjs';
// Expo answers a REFUSED batch with HTTP 200 and per-message error tickets. Every branch below
// used to read `r.ok` and report the whole chunk as delivered, which is how an unconfigured APNs
// key stayed invisible for months. sendExpoPushAndPrune reads the tickets and retires dead ones.
import { sendExpoPushAndPrune } from '../_shared/expo-push.mjs';

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
  const ip = clientIpFrom(req);
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) { rlHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS }); return false; }
  e.count++;
  return e.count > RL_MAX;
}

/** Is `nowMs` inside the person's quiet window? Minutes after local midnight in their own
 *  timezone (0221). A window that wraps midnight (22:00 → 07:00) is the common one. No window,
 *  or an unusable timezone, means never quiet: a broken preference must not silence a coach. */
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
    /** Nudge v2 (2026-08-15): operator→athlete calls may carry a kind ('nudge' default,
     *  'coach_comment', 'coach_react') plus a ref (meal id) so the bell row deep-links.
     *  Comments/reactions are MESSAGES: they skip the nudge dedupe that used to eat them. */
    ref?: string;
    /** Coach OS Slice C: push-only fan-out for an already-posted announcement (feed rows were
     *  already written by post_announcement — this mode must NEVER insert notifications). */
    announcement_id?: string;
    /** Service-role broadcast (security audit 2026-07-30). See the branch below. */
    user_ids?: unknown;
    /** Operator bulk nudge (scale pass 2026-08-18): one call fans out to a roster selection.
     *  Replaces the client's serial per-athlete loop (300 ms stagger, 20/min ceiling at
     *  athlete 21). Authorization is set-based; see the branch below. */
    athlete_ids?: unknown; book_id?: string; book?: string;
    reasons?: Record<string, { reason_key?: string; tier?: string }>;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400, cors);
  }

  // ---------- service-role broadcast (user_ids mode, push-only) ----------
  // WHY THIS EXISTS: admin-alert has been calling this function with { user_ids, title, body }
  // since it was written, to push a security alert to every platform admin's device. There was no
  // user_ids mode. The request fell through to the athlete_id branch and 400'd — every time,
  // silently — so the push half of break-glass alerting has never worked. Worse, admin-alert set
  // `results.push = true` without checking the response, so admin_audit_log recorded a delivery
  // that never happened. Both halves are fixed; this is the receiving half.
  //
  // THE BEARER CHECK IS LOAD-BEARING. Without it this is an arbitrary-user push endpoint that any
  // signed-in caller could aim anywhere. Only server code holding the service role gets in; every
  // other branch in this function authorizes through the CALLER's own JWT instead, which is the
  // right default and stays the default.
  if (Array.isArray(payload.user_ids)) {
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!SERVICE_ROLE || bearer !== SERVICE_ROLE) return json({ error: 'unauthorized' }, 403, cors);

    const ids = (payload.user_ids as unknown[])
      .filter((v): v is string => typeof v === 'string')
      .slice(0, 50);
    if (!ids.length) return json({ ok: true, pushed: 0 }, 200, cors);

    // No notifications insert and no opt-out filter: this path is operational security alerting
    // to the platform's own admins, not product messaging. An admin who muted product pushes
    // still needs to hear that their MFA was just reset.
    const svcB = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: toksB } = await svcB.from('device_tokens').select('token').in('user_id', ids);
    const tokensB = (toksB ?? []).map((t: { token: string }) => t.token).filter(Boolean);
    if (!tokensB.length) return json({ ok: true, pushed: 0, reason: 'no-tokens' }, 200, cors);

    const titleB = (payload.title ?? 'OnStandard').slice(0, 120);
    const bodyB = (payload.body ?? '').slice(0, 300);
    const outB = await sendExpoPushAndPrune(
      tokensB.map((to) => ({ to, title: titleB, body: bodyB, sound: 'default' })), svcB);
    // Report honestly — admin-alert writes this outcome into admin_audit_log. `pushed` is what
    // Expo ACCEPTED, and `errors` names why the rest did not go, so a break-glass alert that was
    // refused can never be filed as one that was delivered.
    return json({ ok: outB.sent > 0, pushed: outB.sent, failed: outB.failed, errors: outB.errors },
      outB.sent > 0 ? 200 : 502, cors);
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
    const title0 = (ann.title ?? 'Team announcement').slice(0, 120);
    const body0 = (ann.body ?? '').slice(0, 300);
    const out0 = await sendExpoPushAndPrune(
      tokens0.map((to) => ({ to, title: title0, body: body0, sound: 'default' })), svc0);
    return json({ ok: true, pushed: out0.sent, failed: out0.failed, errors: out0.errors }, 200, cors);
  }

  // ---------- operator bulk nudge (athlete_ids mode) ----------
  // One call for a whole roster selection. The single-athlete path authorizes with can_view per
  // call, which is O(N) round trips from the client and guaranteed to trip the per-IP limiter at
  // athlete 21; this branch authorizes SET-based the way the announcement fan-out already does:
  // the caller must run the book, and the targets must be that book's active members. Everything
  // else (2-minute dedupe, opt-out, bell rows, Expo chunks) matches the single path, batched.
  if (Array.isArray(payload.athlete_ids)) {
    const norm = sanitizeBulkPayload(payload);
    if (!norm.ok) return json({ error: norm.error }, 400, cors);

    const caller3 = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: me3, error: meErr3 } = await caller3.auth.getUser();
    const callerId3 = me3?.user?.id;
    if (meErr3 || !callerId3) return json({ error: 'unauthorized' }, 401, cors);

    const svc3 = createClient(SUPABASE_URL, SERVICE_ROLE);
    let memberIds: string[] = [];
    if (norm.book === 'team') {
      const { data: staff3 } = await svc3.from('team_staff')
        .select('role').eq('team_id', norm.bookId).eq('staff_id', callerId3).eq('status', 'active').maybeSingle();
      if (!staff3 || staff3.role === 'readonly') return json({ error: 'not authorized for this team' }, 403, cors);
      const { data: mem3 } = await svc3.from('team_members')
        .select('athlete_id').eq('team_id', norm.bookId).eq('status', 'active').in('athlete_id', norm.ids);
      memberIds = (mem3 ?? []).map((m: { athlete_id: string }) => m.athlete_id);
    } else {
      const { data: pr3 } = await svc3.from('practices')
        .select('owner_id').eq('id', norm.bookId).maybeSingle();
      if (!pr3 || pr3.owner_id !== callerId3) return json({ error: 'not authorized for this practice' }, 403, cors);
      const { data: pc3 } = await svc3.from('practice_clients')
        .select('client_id').eq('practice_id', norm.bookId).eq('status', 'active').in('client_id', norm.ids);
      memberIds = (pc3 ?? []).map((m: { client_id: string }) => m.client_id);
    }
    const memberSet = new Set(memberIds);
    const targets3 = norm.ids.filter((id) => memberSet.has(id));
    const results: Array<{ athlete_id: string; pushed: number; devices: number; deduped?: boolean; suppressed?: string | null }> = [];
    // Ids the book doesn't know get an honest per-athlete verdict, never a silent drop.
    for (const id of norm.ids) if (!memberSet.has(id)) results.push({ athlete_id: id, pushed: 0, devices: 0, suppressed: 'not_on_roster' });
    if (!targets3.length) return json({ ok: false, dropped: norm.dropped, results, ...aggregateBulkResults(results) }, 200, cors);

    // Batched 2-minute nudge dedupe — same window as the single path, one read for all targets.
    const DEDUPE_MS3 = 2 * 60_000;
    const { data: recent3 } = await svc3.from('notifications')
      .select('user_id').in('user_id', targets3).eq('kind', 'nudge')
      .gte('created_at', new Date(Date.now() - DEDUPE_MS3).toISOString());
    const dedupedSet3 = new Set((recent3 ?? []).map((n: { user_id: string }) => n.user_id));

    // Opt-out, fail-open like the single path: a pre-0067 database pushes anyway.
    let optedOut3 = new Set<string>();
    try {
      const { data: prefs3 } = await svc3.from('profiles').select('id,notifications_opt_out').in('id', targets3);
      optedOut3 = new Set((prefs3 ?? [])
        .filter((p: { notifications_opt_out?: boolean }) => p.notifications_opt_out === true)
        .map((p: { id: string }) => p.id));
    } catch { /* fail-open */ }

    const live3 = targets3.filter((id) => !dedupedSet3.has(id) && !optedOut3.has(id));

    // Durable bell rows first — they land even for a zero-device athlete (in-app only).
    if (live3.length) {
      await svc3.from('notifications').insert(live3.map((id) => ({ user_id: id, kind: 'nudge', title: norm.title, body: norm.body })));
    }

    // Tokens with per-athlete attribution, then Expo in chunks of 100.
    const tokByUser = new Map<string, string[]>();
    if (live3.length) {
      const { data: toks3 } = await svc3.from('device_tokens').select('user_id,token').in('user_id', live3);
      for (const t of (toks3 ?? []) as Array<{ user_id: string; token: string }>) {
        if (!t?.token) continue;
        const arr = tokByUser.get(t.user_id) ?? [];
        arr.push(t.token);
        tokByUser.set(t.user_id, arr);
      }
    }
    const messages3 = live3.flatMap((id) => (tokByUser.get(id) ?? [])
      .map((to) => ({ to, title: norm.title, body: norm.body, sound: 'default', data: { route: 'home' } })));
    // Per-token truth, not one batch-wide boolean: with the old flag, one refused token marked the
    // whole roster undelivered (and one accepted token marked the whole roster delivered). Now the
    // accepted tokens are known by name, so each athlete's row below reports their OWN phones.
    const out3 = await sendExpoPushAndPrune(messages3, svc3);
    const deadSet3 = new Set(out3.dead);
    const acceptedFor = (id: string) => {
      const toks = tokByUser.get(id) ?? [];
      if (!toks.length) return 0;
      // A chunk-wide failure (no credentials, offline) accepted nothing at all.
      if (out3.sent === 0) return 0;
      return toks.filter((t) => !deadSet3.has(t)).length;
    };

    // The queue-clear rows, one bulk insert. coach_id must be EXPLICIT: under the service role
    // the column's auth.uid() default is null and the row would violate not-null — and RLS's
    // `coach_id = auth.uid()` check never runs for service role, so honesty is on us here.
    // Exactly one owner column is set (the 0136 CHECK).
    try {
      const ownerCol3 = norm.book === 'practice' ? 'practice_id' : 'team_id';
      await svc3.from('coach_interventions').insert(live3.map((id) => ({
        [ownerCol3]: norm.bookId, athlete_id: id, coach_id: callerId3, kind: 'nudge',
        reason_key: (norm.reasons[id] && norm.reasons[id].reason_key) || null,
        tier: (norm.reasons[id] && norm.reasons[id].tier) || null,
      })));
    } catch { /* the nudge already landed; the queue-clear row stays best-effort, as it was client-side */ }

    for (const id of targets3) {
      if (dedupedSet3.has(id)) { results.push({ athlete_id: id, pushed: 0, devices: 0, deduped: true }); continue; }
      if (optedOut3.has(id)) { results.push({ athlete_id: id, pushed: 0, devices: 0, suppressed: 'notifications_off' }); continue; }
      const devices = (tokByUser.get(id) ?? []).length;
      results.push({ athlete_id: id, pushed: acceptedFor(id), devices });
    }
    return json({ ok: true, dropped: norm.dropped, results, errors: out3.errors, ...aggregateBulkResults(results) }, 200, cors);
  }

  // ---------- athlete → coach (to_coach mode) ----------
  if (payload.to_coach === true) {
    const caller = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: me, error: meErr } = await caller.auth.getUser();
    const athleteId2 = me?.user?.id;
    if (meErr || !athleteId2) return json({ error: 'unauthorized' }, 401, cors);
    const title2 = (payload.title ?? 'Athlete update').slice(0, 120);
    const body2 = (payload.body ?? '').slice(0, 300);
    // The kind may carry a deep-link suffix (`meal_review:<mealId>`) — the same convention
    // meal-chat's meal_flag rows already use, so the coach bell can route a tap to the meal.
    // The old regex rejected any suffix, which silently downgraded every row to a dead
    // 'meal_logged' record the bell couldn't link anywhere.
    const kind = /^[a-z_]{3,32}(:[A-Za-z0-9-]{6,64})?$/.test(payload.kind ?? '') ? (payload.kind as string) : 'meal_logged';
    const baseKind = kind.split(':')[0];
    const route = typeof payload.route === 'string' ? payload.route.slice(0, 120) : null;

    // Resolve the athlete's ACTIVE overseers via service role (RLS-free, link-verified): the
    // team's active staff AND the owner of any practice they are an active client of. The
    // practice lane was missing here (it existed for the bulk-nudge branch), so a trainer or a
    // private nutritionist got nothing an athlete did (2026-09-15).
    const svc2 = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: memberships } = await svc2.from('team_members')
      .select('team_id').eq('athlete_id', athleteId2).eq('status', 'active');
    const teamIds = (memberships ?? []).map((m: { team_id: string }) => m.team_id);
    const { data: staff } = teamIds.length
      ? await svc2.from('team_staff').select('staff_id').in('team_id', teamIds).eq('status', 'active')
      : { data: [] as Array<{ staff_id: string }> };
    const { data: pcs } = await svc2.from('practice_clients')
      .select('practice_id').eq('athlete_id', athleteId2).eq('status', 'active');
    const practiceIds = (pcs ?? []).map((r: { practice_id: string }) => r.practice_id);
    const { data: owners } = practiceIds.length
      ? await svc2.from('practices').select('owner_id').in('id', practiceIds)
      : { data: [] as Array<{ owner_id: string }> };
    const coachIds = [...new Set([
      ...(staff ?? []).map((s: { staff_id: string }) => s.staff_id),
      ...(owners ?? []).map((o: { owner_id: string }) => o.owner_id),
    ])].filter((id) => !!id && id !== athleteId2).slice(0, 12);
    if (!coachIds.length) return json({ ok: true, pushed: 0, coaches: 0 }, 200, cors);

    // Durable in-app record for every coach (the unread item), regardless of push urgency.
    await svc2.from('notifications').insert(coachIds.map((id) => ({
      user_id: id, kind, title: title2, body: body2,
    })));

    // Device push, per coach, by the coach's OWN switches (profiles.coach_notify, 0236) and
    // their quiet hours (0221). 'meal_logged' and the other log kinds push when onLog is not
    // off (the founder wants to know the moment an athlete logs anything); an athlete's
    // message pushes when onMessage is not off, with sound; review/action/flag classes always
    // push. Quiet hours hold every non-urgent push; the bell row above already landed either
    // way. notifications_opt_out is the person's master switch and beats all of it.
    const LOG_KINDS = new Set(['meal_logged', 'weight_logged', 'checkin_logged', 'training_logged', 'rollcall_answered']);
    const wantsPush = (cn: Record<string, unknown> | null | undefined) => {
      const c = cn && typeof cn === 'object' ? cn : {};
      if (LOG_KINDS.has(baseKind)) return c.onLog !== false;
      if (baseKind === 'athlete_message') return c.onMessage !== false;
      return true;
    };
    let pushed = 0;
    let pushErrors: string[] = [];
    {
      const { data: prefs } = await svc2.from('profiles')
        .select('id,notifications_opt_out,coach_notify,quiet_from_min,quiet_to_min,timezone').in('id', coachIds);
      type Pref = { id: string; notifications_opt_out?: boolean | null; coach_notify?: Record<string, unknown> | null;
        quiet_from_min?: number | null; quiet_to_min?: number | null; timezone?: string | null };
      const urgent = payload.urgent === true;
      const targets = ((prefs ?? []) as Pref[])
        .filter((p) => p.notifications_opt_out !== true)
        .filter((p) => wantsPush(p.coach_notify))
        .filter((p) => urgent || !inQuietHours(p.quiet_from_min, p.quiet_to_min, p.timezone, Date.now()))
        .map((p) => p.id);
      if (targets.length) {
        const { data: toks2 } = await svc2.from('device_tokens').select('token,user_id').in('user_id', targets);
        const tokens2 = (toks2 ?? []).map((t: { token: string }) => t.token).filter(Boolean);
        if (tokens2.length) {
          const out2 = await sendExpoPushAndPrune(tokens2.map((to) => ({
            to, title: title2, body: body2,
            sound: payload.urgent === true || baseKind === 'athlete_message' ? 'default' : undefined,
            ...(route ? { data: { route } } : {}),
          })), svc2);
          pushed = out2.sent;
          pushErrors = out2.errors;
        }
      }
    }
    return json({ ok: true, pushed, coaches: coachIds.length, ...(pushErrors.length ? { errors: pushErrors } : {}) }, 200, cors);
  }

  const athleteId = payload.athlete_id;
  if (!athleteId) return json({ error: 'athlete_id required' }, 400, cors);
  const title = (payload.title ?? 'Your coach sent a nudge').slice(0, 120);
  const message = (payload.body ?? '').slice(0, 300);
  // Operator-origin kinds (nudge v2). 'nudge' keeps its dedupe; a comment or reaction is a
  // MESSAGE riding the same authorized pipe — before this, two coach comments inside two
  // minutes meant the second one produced no bell row and no push, silently. `ref` (the meal
  // id) rides the row's kind as a suffix so the athlete's bell can deep-link the tap; `route`
  // rides the push payload so the OS notification opens the right screen instead of nowhere.
  const OP_KINDS = new Set(['nudge', 'coach_comment', 'coach_react']);
  const opKind = OP_KINDS.has(payload.kind ?? '') ? (payload.kind as string) : 'nudge';
  const opRef = typeof payload.ref === 'string' && /^[A-Za-z0-9-]{6,64}$/.test(payload.ref) ? payload.ref : null;
  const opRoute = typeof payload.route === 'string' && /^[A-Za-z0-9/_-]{1,120}$/.test(payload.route)
    ? payload.route
    : (opKind === 'nudge' ? 'home' : (opRef ? `meal-view/${opRef}` : null));

  // 1) Authorize with the CALLER's jwt: can_view is true only if they're linked to the athlete.
  const caller = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: allowed, error: viewErr } = await caller.rpc('can_view', { athlete: athleteId });
  if (viewErr || allowed !== true) return json({ error: 'not authorized for this athlete' }, 403, cors);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1b) Idempotency guard: a retried client call or a double-tap on the same nudge button
  // should not double-deliver. Skip if this athlete already got a 'nudge' in the last 2 minutes —
  // long enough to absorb a retry/double-submit, short enough that a coach nudging again
  // moments later (different reason) still goes through.
  // Scoped to actual nudges: comments and reactions are conversation, and deduping
  // conversation means eating it.
  const DEDUPE_WINDOW_MS = 2 * 60_000;
  if (opKind === 'nudge') {
    const { data: recentNudge, error: dedupeErr } = await svc.from('notifications')
      .select('id').eq('user_id', athleteId).eq('kind', 'nudge')
      .gte('created_at', new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()).limit(1).maybeSingle();
    if (!dedupeErr && recentNudge) return json({ ok: true, pushed: 0, deduped: true }, 200, cors);
  }

  // 2) Record the in-app notification (service role bypasses the self-only insert policy).
  await svc.from('notifications').insert({
    user_id: athleteId, kind: opRef ? `${opKind}:${opRef}` : opKind, title, body: message,
  });

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
  const out = tokens.length
    ? await sendExpoPushAndPrune(tokens.map((to) => ({
        to, title, body: message, sound: 'default',
        ...(opRoute ? { data: { route: opRoute } } : {}),
      })), svc)
    : { sent: 0, failed: 0, dead: [] as string[], errors: [] as string[] };
  const pushed = out.sent;
  // `devices` lets the client tell "pushed to their phone" from "they have no push device" —
  // the UI used to assert phone delivery either way.
  // `devices` is how many phones we KNOW about; `pushed` is how many Expo accepted. When they
  // differ the coach is told the truth instead of "sent to their phone".
  return json({ ok: true, pushed, devices: tokens.length, ...(out.errors.length ? { errors: out.errors } : {}) }, 200, cors);
});
