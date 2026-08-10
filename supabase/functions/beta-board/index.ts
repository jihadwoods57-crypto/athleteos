// OnStandard — beta-board Edge Function (Supabase / Deno).
//
// The whole server side of the Beta Feedback Board (web/landing/beta.html, migration 0191): the
// page shipped to external TestFlight testers so their reports arrive already sorted instead of as
// a pile of duplicate tickets.
//
// Four actions, all POST:
//   list        -> the ranked board (themes + the raw posts inside them)
//   submit      -> save a report, then ONE forced-tool Anthropic call folds it into a theme
//   vote        -> "me too" on a theme, deduped per browser
//   set_status  -> founder-only: open / fixing / shipped / wontdo, and a severity override
//
// AUTH — there is no Supabase session here. The visitor is an anonymous browser holding a URL
// token, so this function is the entire wall:
//   * every action requires ?k= matching BETA_BOARD_KEY (constant-time compare)
//   * set_status additionally requires BETA_ADMIN_KEY
//   * all DB work runs through the service-role client, because 0191's tables are RLS-on with no
//     policies and no anon/authenticated grants (deliberate — see that migration's header)
// verify_jwt MUST be pinned false in config.toml or the platform 401s before any of this runs.
//
// COST — a submission spends real money, so it is gated three ways: an in-memory per-IP window,
// a durable per-IP daily claim, and the dollar-denominated checkSpend. A post is NEVER lost to an
// AI failure: if the model is unavailable, gated, or names a theme that does not exist, the report
// still saves into the Unsorted theme. The tester's words matter more than the clustering.
//
// Deploy:
//   supabase secrets set BETA_BOARD_KEY=<token> BETA_ADMIN_KEY=<token>
//   supabase functions deploy beta-board --no-verify-jwt
// Origins default to the onstandard.app pair; override with BETA_ALLOWED_ORIGINS (comma-separated)
// only if the board ever moves. Do NOT reuse the shared ALLOWED_ORIGINS secret here — see below.
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { clientIpFrom } from '../_shared/client-ip.ts';
import { checkSpend, EST_USD } from '../_shared/spend-gate.ts';
import { recordAiCall, usageFrom } from '../_shared/ai-telemetry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';
const BOARD_KEY = Deno.env.get('BETA_BOARD_KEY') ?? '';
const ADMIN_KEY = Deno.env.get('BETA_ADMIN_KEY') ?? '';

// Deliberately NOT the shared ALLOWED_ORIGINS secret. That one is read by food-lookup,
// public-offer-checkout and others; overwriting it to add the board's origin would silently change
// the CORS posture of functions that take money. This function owns its own list, with the real
// site origins as the default so a fresh deploy works before any secret is set.
// (Noted 2026-08-06: the shared ALLOWED_ORIGINS currently returns no ACAO for any onstandard.app
// origin, which is worth a look on the trainer checkout page — but it is not this feature's to fix.)
const DEFAULT_ORIGINS = ['https://onstandard.app', 'https://www.onstandard.app'];
const ALLOWED_ORIGINS = (() => {
  const raw = (Deno.env.get('BETA_ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return raw.length ? raw : DEFAULT_ORIGINS;
})();
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

// Constant-time string compare. A plain `a === b` on a secret leaks its prefix through timing;
// cheap to do right, and this is the only thing standing between a forwarded link and the board.
function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // Length is not secret (and differing lengths can't match) but keep the loop fixed-width anyway.
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// Best-effort per-IP window, same in-memory pattern as the other public functions. Per-instance
// and therefore not a real wall — the durable daily claim below is. This just blunts a fast loop.
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '20');
const RL_WINDOW_MS = 60_000;
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) {
    rlHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  e.count++;
  return e.count > RL_MAX;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const UNSORTED_TITLE = 'Unsorted — needs triage';

const TRIAGE_TOOL = {
  name: 'triage_feedback',
  description:
    'Decide whether a new beta report is the SAME issue as an existing theme, or a new one. ' +
    'Match only when a fix for the existing theme would also fix this report — two reports about ' +
    'the same screen are not the same issue unless the underlying problem is the same.',
  input_schema: {
    type: 'object' as const,
    properties: {
      decision: { type: 'string', enum: ['match', 'new'], description: 'match an existing theme, or start a new one' },
      match_theme_id: { type: 'string', description: 'Required when decision is "match": the exact id from the list.' },
      new_theme: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description:
              'Short and specific, in the tester\'s own terms. Max ~60 chars. Not "App issue", and not ' +
              'analyst-speak like "strong retention hook" — say the actual thing.',
          },
          summary: {
            type: 'string',
            description:
              'One plain sentence: what happens and where. Write the way one person tells another, not ' +
              'like a product report — no "the user did not understand", no "drives engagement". ' +
              'Say "the number in the ring isn\'t explained anywhere", not "user failed to comprehend the metric".',
          },
          kind: { type: 'string', enum: ['bug', 'confusing', 'idea', 'praise'] },
          severity: {
            type: 'integer',
            description: '5 crash/data loss, 4 blocks a core task, 3 works but wrong, 2 annoying, 1 cosmetic. Praise and ideas are 1-2.',
          },
        },
        required: ['title', 'summary', 'kind', 'severity'],
      },
    },
    required: ['decision'],
  },
};

const SYSTEM = [
  'You triage beta feedback for OnStandard, a daily-accountability app for athletes and their coaches.',
  'You are given one new tester note and the themes already on the board.',
  'The board takes ALL feedback, not just bugs: a broken thing (bug), something that worked but was',
  'hard to find or understand (confusing), a suggestion or feature request (idea), and what someone',
  'liked (praise). Ideas and praise are first-class here — classify them as what they are rather than',
  'forcing them into "bug". A feature request is an idea, not a defect.',
  'Return exactly one tool call: either match the note to an existing theme, or open a new one.',
  'Prefer matching — a board of near-duplicates is useless. But never merge two genuinely different',
  'things just because they touch the same screen, and never merge an idea into a bug.',
  'Titles are written for the founder scanning the board: specific, concrete, no filler.',
].join(' ');

type ThemeRow = { id: string; title: string; summary: string; kind: string; severity: number; status: string };

Deno.serve(async (request) => {
  const cors = corsFor(request);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Unconfigured is 503, never a throw at import — a missing secret must not 500 every request.
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !BOARD_KEY) return json({ error: 'unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // The wall. Every action, including list.
  if (!safeEqual(str(body.k, 200), BOARD_KEY)) return json({ error: 'forbidden' }, 403);

  const action = str(body.action, 20);
  const ip = clientIpFrom(request);
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ---------------------------------------------------------------- list: the ranked board
  if (action === 'list') {
    const { data: themes, error: tErr } = await sb
      .from('beta_themes')
      .select('id,title,summary,kind,severity,status,post_count,vote_count,created_at');
    if (tErr) return json({ error: 'unavailable' }, 503);

    const { data: posts } = await sb
      .from('beta_posts')
      .select('id,theme_id,author_name,body,app_version,tester_set,created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    // Ranking. The board carries two different kinds of thing and they CANNOT share one ordering:
    //   problems (bug/confusing) — severity first: a crash must outrank a cosmetic bug no matter
    //     how many people mention the cosmetic one.
    //   ideas/praise           — severity is meaningless (the model scores them 1-2 by definition),
    //     so ranking them the same way would bury every good idea under every trivial bug. These
    //     rank purely by how many people back them.
    // Groups stay contiguous so the page can draw a heading when the group changes.
    const done = (s: string) => (s === 'shipped' || s === 'wontdo' ? 1 : 0);
    const group = (k: string) => (k === 'idea' || k === 'praise' ? 1 : 0);
    const heat = (t: { vote_count: number; post_count: number }) => 2 * (t.vote_count ?? 0) + (t.post_count ?? 0);
    const ranked = (themes ?? []).sort((a, b) =>
      done(a.status) - done(b.status) ||
      group(a.kind) - group(b.kind) ||
      (group(a.kind) === 0 ? (b.severity ?? 0) - (a.severity ?? 0) : 0) ||
      heat(b) - heat(a) ||
      String(b.created_at).localeCompare(String(a.created_at))
    );

    return json({ themes: ranked, posts: posts ?? [], admin: ADMIN_KEY !== '' && safeEqual(str(body.admin, 200), ADMIN_KEY) });
  }

  // ---------------------------------------------------------------- vote: one per browser
  if (action === 'vote') {
    if (rateLimited(ip)) return json({ error: 'slow down' }, 429);
    const themeId = str(body.theme_id, 40);
    const voterId = str(body.voter_id, 64);
    if (!themeId || !voterId) return json({ error: 'bad request' }, 400);

    // The primary key makes a second vote a no-op rather than an error worth surfacing.
    const { error } = await sb.from('beta_votes').insert({ theme_id: themeId, voter_id: voterId });
    if (error && !String(error.message).includes('duplicate')) return json({ error: 'unavailable' }, 503);
    if (!error) {
      const { count } = await sb.from('beta_votes').select('*', { count: 'exact', head: true }).eq('theme_id', themeId);
      await sb.from('beta_themes').update({ vote_count: count ?? 0, updated_at: new Date().toISOString() }).eq('id', themeId);
    }
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- set_status: founder only
  if (action === 'set_status') {
    if (!ADMIN_KEY || !safeEqual(str(body.admin, 200), ADMIN_KEY)) return json({ error: 'forbidden' }, 403);
    const themeId = str(body.theme_id, 40);
    const status = str(body.status, 12);
    if (!themeId || !['open', 'fixing', 'shipped', 'wontdo'].includes(status)) return json({ error: 'bad request' }, 400);

    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    const sev = Number(body.severity);
    if (Number.isInteger(sev) && sev >= 1 && sev <= 5) patch.severity = sev;

    const { error } = await sb.from('beta_themes').update(patch).eq('id', themeId);
    if (error) return json({ error: 'unavailable' }, 503);
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- submit: save, then triage
  if (action !== 'submit') return json({ error: 'bad request' }, 400);
  if (rateLimited(ip)) return json({ error: 'Slow down a moment — try again shortly.' }, 429);

  const authorName = str(body.author_name, 40) || 'Anonymous';
  const text = str(body.body, 2000);
  const appVersion = str(body.app_version, 40) || null;
  // 1-10 mirrors the tester count scripts/seed-tester-accounts.sql creates. If that seed ever grows
  // (e.g. N=15 testers), this bound must grow with it, or valid tester_set values above 10 get
  // silently nulled out here with no error surfaced anywhere.
  const testerSetRaw = Number(body.tester_set);
  const testerSet = Number.isInteger(testerSetRaw) && testerSetRaw >= 1 && testerSetRaw <= 10 ? testerSetRaw : null;
  if (text.length < 4) return json({ error: 'Tell us a little more than that.' }, 400);

  // Durable per-IP daily cap. The counter returns a boolean and the CALLER decides — a SQL limit
  // that RAISEs rolls back the very increment it just made (see 0170). Fails open: a broken
  // counter must not silence a tester. The dollar gate below is the thing that actually protects
  // the bill.
  try {
    const { data } = await sb.rpc('claim_ai_usage_key', { p_key: `beta:${ip}`, p_limit: Number(Deno.env.get('BETA_DAILY_PER_IP') ?? '40') });
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.allowed === false) return json({ error: "That's a lot of feedback for one day — thank you. Back tomorrow." }, 429);
  } catch {
    // counter is infrastructure, not the wall
  }

  // Save FIRST, cluster second. If everything after this line fails, the report still exists.
  const { data: inserted, error: insErr } = await sb
    .from('beta_posts')
    .insert({ author_name: authorName, body: text, app_version: appVersion, tester_set: testerSet })
    .select('id')
    .single();
  if (insErr || !inserted) return json({ error: 'unavailable' }, 503);
  const postId = inserted.id as string;

  const { data: openThemes } = await sb
    .from('beta_themes')
    .select('id,title,summary,kind,severity,status')
    .neq('status', 'wontdo')
    .limit(80);
  const themes = (openThemes ?? []) as ThemeRow[];
  const candidates = themes.filter((t) => t.title !== UNSORTED_TITLE);

  // Attach the post to a theme and keep the denormalized counters true.
  const attach = async (themeId: string) => {
    await sb.from('beta_posts').update({ theme_id: themeId }).eq('id', postId);
    const { count } = await sb.from('beta_posts').select('*', { count: 'exact', head: true }).eq('theme_id', themeId);
    await sb.from('beta_themes').update({ post_count: count ?? 1, updated_at: new Date().toISOString() }).eq('id', themeId);
  };

  // Every failure path lands here: the post is saved and visible, just not clustered.
  const fallback = async (why: string) => {
    let unsorted = themes.find((t) => t.title === UNSORTED_TITLE);
    if (!unsorted) {
      const { data } = await sb
        .from('beta_themes')
        .insert({ title: UNSORTED_TITLE, summary: 'Reports that arrived while auto-triage was unavailable.', kind: 'bug', severity: 3 })
        .select('id,title,summary,kind,severity,status')
        .single();
      unsorted = (data ?? undefined) as ThemeRow | undefined;
    }
    if (unsorted) await attach(unsorted.id);
    console.log(JSON.stringify({ evt: 'beta_triage_fallback', why }));
    return json({ ok: true, theme_id: unsorted?.id ?? null, clustered: false });
  };

  if (!ANTHROPIC_API_KEY) return await fallback('no_api_key');

  const spend = await checkSpend(EST_USD.text);
  if (!spend.allowed) {
    console.log(JSON.stringify({ evt: 'ai_spend_block', fn: 'beta-board', reason: spend.reason }));
    return await fallback(`spend_${spend.reason}`);
  }

  const userText = [
    candidates.length
      ? `Themes already on the board:\n${candidates.map((t) => `- id=${t.id} [${t.kind}] ${t.title} — ${t.summary}`).join('\n')}`
      : 'The board is empty — there is nothing to match against, so open a new theme.',
    '',
    `New report from ${authorName}${appVersion ? ` (app ${appVersion})` : ''}:`,
    text,
  ].join('\n');

  const t0 = Date.now();
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [{ ...TRIAGE_TOOL, cache_control: { type: 'ephemeral' } }],
      tool_choice: { type: 'tool', name: TRIAGE_TOOL.name },
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    });
    await recordAiCall({
      fn: 'beta-board', mode: 'triage', model: msg.model ?? MODEL,
      ...usageFrom(msg.usage), latencyMs: Date.now() - t0, ok: true,
    });

    const block = msg.content.find((c: { type: string }) => c.type === 'tool_use') as { input?: Record<string, unknown> } | undefined;
    const out = block?.input ?? {};

    if (out.decision === 'match') {
      const id = str(out.match_theme_id, 40);
      // Trust but verify: a hallucinated id would silently orphan the post.
      if (candidates.some((t) => t.id === id)) {
        await attach(id);
        return json({ ok: true, theme_id: id, clustered: true, matched: true });
      }
      return await fallback('bad_theme_id');
    }

    const nt = (out.new_theme ?? {}) as Record<string, unknown>;
    const title = str(nt.title, 80);
    if (!title) return await fallback('empty_title');
    const kind = ['bug', 'confusing', 'idea', 'praise'].includes(String(nt.kind)) ? String(nt.kind) : 'bug';
    const sevRaw = Number(nt.severity);
    const severity = Number.isInteger(sevRaw) && sevRaw >= 1 && sevRaw <= 5 ? sevRaw : 3;

    const { data: created, error: cErr } = await sb
      .from('beta_themes')
      .insert({ title, summary: str(nt.summary, 300), kind, severity })
      .select('id')
      .single();
    if (cErr || !created) return await fallback('theme_insert_failed');
    await attach(created.id as string);
    return json({ ok: true, theme_id: created.id, clustered: true, matched: false });
  } catch (e) {
    await recordAiCall({
      fn: 'beta-board', mode: 'triage', model: MODEL,
      latencyMs: Date.now() - t0, ok: false, errorCode: 'upstream_error',
    });
    console.error('beta-board triage error:', e);
    return await fallback('upstream_error');
  }
});
