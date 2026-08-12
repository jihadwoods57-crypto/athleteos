// OnStandard — verified-profile: the recruiter-facing Verified Profile (migration 0200, design
// docs/design/2026-08-11-verified-profile-design.md).
//
// One function, two kinds of caller:
//   - `view` — an anonymous recruiter's browser holding a slug (onstandard.app/v/<slug>). No
//     session exists, so verify_jwt is pinned false (config.toml) and the published flag on the
//     slug's row is the entire wall. Nothing here answers "does this handle exist" for an
//     unpublished row: every miss is the same { error: 'not found' }.
//   - `status` / `enable` / `publish` / `refresh_card` / `unpublish` — the signed-in athlete's
//     app (roles.js callFn forwards their JWT). We verify the token ourselves, guardian-request
//     style, since the platform check is off for the anonymous lane.
//
// Every number on the page is computed HERE from the same rows the app reads — days, meals
// (photo_path is not null, the 0039 forgery-resistant signal, never the client-written score
// alone), and 0138's accountability_raw for the commitment arithmetic. The page invents nothing;
// a value we do not have is absent, and the client renders absence as an em dash glyph.
//
// The integrity contract (founder ruling, locked): the record window is [enabled_at, now].
// All-or-nothing — the athlete chooses WHEN the window starts and whether the page exists, never
// which parts of the window show. Publishing requires 30 logged days inside the window, a minor's
// verified guardian consent, and (when VERIFIED_PROFILE_REQUIRES_PLAN=1) premium access.
// Premium lapse: 7-day grace from the first view that sees no access, then auto-unpublish.
//
// DEPLOY (config.toml pins verify_jwt=false):
//   supabase functions deploy verified-profile --use-api --no-verify-jwt
//   Paywall flip (secret, no redeploy): supabase secrets set VERIFIED_PROFILE_REQUIRES_PLAN=1
//   Optional CORS extras: VERIFIED_PROFILE_ALLOWED_ORIGINS (its own list — never the shared
//   ALLOWED_ORIGINS secret; overwriting that one silently changes functions that take money).
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2.110.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const REQUIRES_PLAN = Deno.env.get('VERIFIED_PROFILE_REQUIRES_PLAN') === '1';

const ON_STANDARD = 80;            // the same bar every athlete surface uses (score-band.js)
const MIN_DAYS_TO_PUBLISH = 30;    // founder ruling: no page on a thin record
const GRACE_DAYS = 7;
const PAGE = 500;                  // paged reads, filter in the query (weekly-digest F3 lesson)
const BUCKET = 'verified-cards';
const MAX_CARD_BYTES = 4 * 1024 * 1024;

const DEFAULT_ORIGINS = ['https://onstandard.app', 'https://www.onstandard.app'];
const EXTRA_ORIGINS = (Deno.env.get('VERIFIED_PROFILE_ALLOWED_ORIGINS') ?? '')
  .split(',').map((o) => o.trim()).filter(Boolean);
const ORIGINS = [...DEFAULT_ORIGINS, ...EXTRA_ORIGINS];
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (origin && ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS;
}
const json = (obj: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Per-instance view throttle. Not a real wall (instances recycle) — it just keeps one scraper
// from hammering a single warm instance.
const hits = new Map<string, { n: number; t: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n += 1;
  return h.n > 60;
}

type DayRow = { date: string; score: number | null };

async function allDays(svc: SupabaseClient, athleteId: string, sinceISO: string): Promise<DayRow[]> {
  const out: DayRow[] = [];
  for (let page = 0; page < 40; page++) {
    const { data, error } = await svc.from('days')
      .select('date, score')
      .eq('athlete_id', athleteId).gte('date', sinceISO)
      .order('date', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data) break;
    out.push(...(data as DayRow[]));
    if (data.length < PAGE) break;
  }
  return out;
}

/** The whole record, computed once, shared by the public view and the athlete's own status. */
async function buildRecord(svc: SupabaseClient, athleteId: string, enabledAt: string) {
  const sinceISO = enabledAt.slice(0, 10);
  const days = await allDays(svc, athleteId, sinceISO);
  const scored = days.filter((d) => typeof d.score === 'number');
  const daysOnRecord = days.length;
  const daysOnStandard = scored.filter((d) => (d.score as number) >= ON_STANDARD).length;
  const avg = (rows: DayRow[]) => rows.length
    ? Math.round(rows.reduce((s, d) => s + (d.score as number), 0) / rows.length) : null;
  const cut30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const avg30 = avg(scored.filter((d) => d.date >= cut30));

  // Month buckets across the FULL window — the timeline where bad months show. That the athlete
  // cannot trim this list is the product.
  const byMonth = new Map<string, { logged: number; onStandard: number; sum: number; scored: number }>();
  for (const d of days) {
    const ym = d.date.slice(0, 7);
    const m = byMonth.get(ym) ?? { logged: 0, onStandard: 0, sum: 0, scored: 0 };
    m.logged += 1;
    if (typeof d.score === 'number') {
      m.scored += 1; m.sum += d.score;
      if (d.score >= ON_STANDARD) m.onStandard += 1;
    }
    byMonth.set(ym, m);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([ym, m]) => ({ ym, logged: m.logged, onStandard: m.onStandard, avg: m.scored ? Math.round(m.sum / m.scored) : null }));

  // Photo-verified meal days: real storage uploads (0039), not the self-asserted days.meals map.
  let photoMealDays: number | null = null;
  {
    const { data, error } = await svc.from('meals')
      .select('day_date').eq('athlete_id', athleteId).not('photo_path', 'is', null)
      .gte('day_date', sinceISO).limit(20000);
    if (!error && data) photoMealDays = new Set(data.map((r: { day_date: string }) => r.day_date)).size;
  }

  // Commitment arithmetic through the one shared function (0138; execute re-granted to
  // service_role in 0200). Null when the athlete has no commitments — the row is absent on the
  // page, never faked.
  let accountability: Record<string, number> | null = null;
  {
    const { data, error } = await svc.rpc('accountability_raw', {
      p_athlete: athleteId, p_from: sinceISO, p_to: new Date().toISOString().slice(0, 10),
    });
    if (!error && data && typeof data === 'object' && (data.possible ?? 0) > 0) accountability = data;
  }

  return {
    enabledAt, daysOnRecord, daysOnStandard,
    onStandardPct: scored.length ? Math.round((daysOnStandard / scored.length) * 100) : null,
    avg30, avgAll: avg(scored), months, photoMealDays, accountability,
  };
}

async function identity(svc: SupabaseClient, athleteId: string) {
  const [{ data: prof }, { data: ap }] = await Promise.all([
    svc.from('profiles').select('full_name').eq('id', athleteId).maybeSingle(),
    svc.from('athlete_profiles').select('sport, position, level').eq('athlete_id', athleteId).maybeSingle(),
  ]);
  // Team + head coach: the credibility bridge. Absent when no active team link exists.
  let team: { name: string; coachName: string | null } | null = null;
  const { data: tm } = await svc.from('team_members')
    .select('team_id').eq('athlete_id', athleteId).eq('status', 'active').limit(1).maybeSingle();
  if (tm?.team_id) {
    const { data: t } = await svc.from('teams').select('id, name').eq('id', tm.team_id).maybeSingle();
    if (t?.name) {
      let coachName: string | null = null;
      const { data: staff } = await svc.from('team_staff')
        .select('staff_id').eq('team_id', t.id).eq('role', 'head_coach').eq('status', 'active').limit(1).maybeSingle();
      if (staff?.staff_id) {
        const { data: cp } = await svc.from('profiles')
          .select('coach_display_name, full_name').eq('id', staff.staff_id).maybeSingle();
        coachName = (cp?.coach_display_name || cp?.full_name || '').trim() || null;
      }
      team = { name: t.name, coachName };
    }
  }
  return {
    name: (prof?.full_name || '').trim() || null,
    sport: ap?.sport || null, position: ap?.position || null, level: ap?.level || null,
    team,
  };
}

/** Mirrors 0050's is_provable_minor: unknown age = adult (the live-beta ruling). Computed here
 *  from the columns because the SQL predicate's execute was revoked from every non-definer role. */
async function isProvableMinor(svc: SupabaseClient, athleteId: string): Promise<boolean> {
  const { data } = await svc.from('athlete_profiles')
    .select('base_age, dob').eq('athlete_id', athleteId).maybeSingle();
  if (!data) return false;
  if (typeof data.base_age === 'number' && data.base_age < 18) return true;
  if (data.dob) {
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 18);
    if (new Date(data.dob + 'T00:00:00Z') > cutoff) return true;
  }
  return false;
}

async function hasGuardianConsent(svc: SupabaseClient, athleteId: string): Promise<boolean> {
  const { data } = await svc.from('guardian_consent_requests')
    .select('id').eq('athlete_id', athleteId).eq('status', 'verified').limit(1);
  return !!(data && data.length > 0);
}

async function hasPremium(svc: SupabaseClient, athleteId: string): Promise<boolean> {
  const { data } = await svc.rpc('has_premium_access', { p_user: athleteId });
  return data === true; // null (failed RPC) blocks, never grants — the monthly-report shape
}

function cardPathFor(slug: string) { return `cards/${slug}.png`; }
function publicCardUrl(slug: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${cardPathFor(slug)}`;
}

/** Decode + validate the client-rendered card. Only ever stored under the caller's own slug. */
function decodeCard(dataUrl: unknown): Uint8Array | null {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  try {
    const raw = atob(m[1]);
    if (raw.length > MAX_CARD_BYTES || raw.length < 8) return null;
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    // PNG magic — the bucket is public; never store bytes that merely claim to be a PNG.
    const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!magic.every((b, i) => bytes[i] === b)) return null;
    return bytes;
  } catch { return null; }
}

async function uploadCard(svc: SupabaseClient, slug: string, bytes: Uint8Array): Promise<boolean> {
  const { error } = await svc.storage.from(BUCKET)
    .upload(cardPathFor(slug), bytes, { contentType: 'image/png', upsert: true });
  return !error;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) return json({ error: 'unavailable' }, 503, cors);

  let body: { action?: string; slug?: string; card?: string; guardian_email?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400, cors); }
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  /* ------------------------------------------------ the anonymous recruiter lane */
  if (body.action === 'view') {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
    if (throttled(ip)) return json({ error: 'slow down' }, 429, cors);
    const slug = String(body.slug ?? '');
    if (!/^[a-f0-9]{10,64}$/.test(slug)) return json({ error: 'not found' }, 404, cors);
    const { data: vp } = await svc.from('verified_profiles')
      .select('athlete_id, slug, enabled_at, published, published_at, grace_started_at')
      .eq('slug', slug).eq('published', true).maybeSingle();
    if (!vp) return json({ error: 'not found' }, 404, cors);

    // Premium lapse: grace starts at the first unpaid view, the page auto-unpublishes after 7
    // days, and a recovered subscription clears the clock. The page never degrades in between —
    // a recruiter either sees the real document or a clean absence.
    if (REQUIRES_PLAN) {
      const paid = await hasPremium(svc, vp.athlete_id);
      if (paid && vp.grace_started_at) {
        await svc.from('verified_profiles').update({ grace_started_at: null, updated_at: new Date().toISOString() }).eq('athlete_id', vp.athlete_id);
      } else if (!paid) {
        if (!vp.grace_started_at) {
          await svc.from('verified_profiles').update({ grace_started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('athlete_id', vp.athlete_id);
          await svc.from('notifications').insert({
            user_id: vp.athlete_id, kind: 'verified_profile',
            title: 'Your Verified Profile needs your plan',
            body: `Your plan lapsed, so your public profile comes down in ${GRACE_DAYS} days unless you renew.`,
          });
        } else if (Date.now() - new Date(vp.grace_started_at).getTime() > GRACE_DAYS * 86400_000) {
          await svc.from('verified_profiles').update({ published: false, updated_at: new Date().toISOString() }).eq('athlete_id', vp.athlete_id);
          await svc.storage.from(BUCKET).remove([cardPathFor(slug)]).catch(() => {});
          return json({ error: 'not found' }, 404, cors);
        }
      }
    }

    const [who, record] = await Promise.all([
      identity(svc, vp.athlete_id),
      buildRecord(svc, vp.athlete_id, vp.enabled_at),
    ]);
    return json({ ok: true, profile: { ...who, publishedAt: vp.published_at, record } }, 200, cors);
  }

  /* ------------------------------------------------ the signed-in athlete lane */
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || token === SUPABASE_ANON_KEY) return json({ error: 'sign in required' }, 401, cors);
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userErr } = await caller.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: 'sign in required' }, 401, cors);
  const uid = userData.user.id;

  const getRow = async () => (await svc.from('verified_profiles')
    .select('athlete_id, slug, enabled_at, published, published_at, card_path, grace_started_at')
    .eq('athlete_id', uid).maybeSingle()).data;

  if (body.action === 'enable') {
    // Idempotent, and enabled_at never moves once set: re-enabling after an unpublish keeping the
    // original window is what makes disable/re-enable useless as a curation tool.
    const existing = await getRow();
    if (!existing) {
      const { error } = await svc.from('verified_profiles').insert({ athlete_id: uid });
      if (error) return json({ error: 'could not enable' }, 500, cors);
    }
    body.action = 'status'; // fall through to the fresh status read
  }

  if (body.action === 'status') {
    const row = await getRow();
    const minor = await isProvableMinor(svc, uid);
    const consent = minor ? await hasGuardianConsent(svc, uid) : true;
    const paid = REQUIRES_PLAN ? await hasPremium(svc, uid) : true;
    if (!row) return json({ ok: true, enabled: false, minor, consentOk: consent, paid, requiresPlan: REQUIRES_PLAN, minDays: MIN_DAYS_TO_PUBLISH }, 200, cors);
    const record = await buildRecord(svc, uid, row.enabled_at);
    const who = await identity(svc, uid);
    return json({
      ok: true, enabled: true, published: row.published, slug: row.slug,
      url: `https://onstandard.app/v/${row.slug}`,
      cardUrl: row.card_path ? publicCardUrl(row.slug) : null,
      minor, consentOk: consent, paid, requiresPlan: REQUIRES_PLAN,
      minDays: MIN_DAYS_TO_PUBLISH, eligible: record.daysOnRecord >= MIN_DAYS_TO_PUBLISH,
      graceStartedAt: row.grace_started_at,
      profile: { ...who, publishedAt: row.published_at, record },
    }, 200, cors);
  }

  if (body.action === 'publish' || body.action === 'refresh_card') {
    const row = await getRow();
    if (!row) return json({ error: 'enable your profile first' }, 400, cors);
    if (body.action === 'refresh_card' && !row.published) return json({ error: 'profile is not published' }, 400, cors);

    if (body.action === 'publish') {
      // The three gates, in the order the athlete can fix them.
      if (await isProvableMinor(svc, uid) && !(await hasGuardianConsent(svc, uid))) {
        return json({ error: 'guardian consent required' }, 403, cors);
      }
      if (REQUIRES_PLAN && !(await hasPremium(svc, uid))) {
        return json({ error: 'verified profile requires a plan' }, 402, cors);
      }
      const record = await buildRecord(svc, uid, row.enabled_at);
      if (record.daysOnRecord < MIN_DAYS_TO_PUBLISH) {
        return json({ error: `needs ${MIN_DAYS_TO_PUBLISH} days on record`, daysOnRecord: record.daysOnRecord }, 400, cors);
      }
    }

    // The unfurl card is rendered client-side by the ONE share-card renderer and stored under the
    // caller's own slug; a card is required to publish because the tweet preview IS the page's
    // first impression. Validated as a real PNG before it touches a public bucket.
    const bytes = decodeCard(body.card);
    if (!bytes) return json({ error: 'card image required' }, 400, cors);
    if (!(await uploadCard(svc, row.slug, bytes))) return json({ error: 'could not store card' }, 500, cors);

    const patch: Record<string, unknown> = { card_path: cardPathFor(row.slug), updated_at: new Date().toISOString() };
    if (body.action === 'publish') {
      patch.published = true; patch.grace_started_at = null;
      if (!row.published_at) patch.published_at = new Date().toISOString();
    }
    const { error } = await svc.from('verified_profiles').update(patch).eq('athlete_id', uid);
    if (error) return json({ error: 'could not publish' }, 500, cors);
    return json({ ok: true, slug: row.slug, url: `https://onstandard.app/v/${row.slug}`, cardUrl: publicCardUrl(row.slug) }, 200, cors);
  }

  if (body.action === 'unpublish') {
    const row = await getRow();
    if (!row) return json({ ok: true }, 200, cors);
    const { error } = await svc.from('verified_profiles')
      .update({ published: false, grace_started_at: null, updated_at: new Date().toISOString() }).eq('athlete_id', uid);
    if (error) return json({ error: 'could not unpublish' }, 500, cors);
    // Remove the card too: an unpublished page must not keep unfurling in old tweets.
    await svc.storage.from(BUCKET).remove([cardPathFor(row.slug)]).catch(() => {});
    return json({ ok: true }, 200, cors);
  }

  return json({ error: 'unknown action' }, 400, cors);
});
