// OnStandard — dining-menu Edge Function (Supabase / Deno). Goals and eating plan, phase C.
//
// Reads ONE uploaded dining hall menu (photos, a PDF or pasted text; a dining_menu_uploads row,
// 0255) with ONE model call and writes it as DRAFT menus for staff to review. It never publishes:
// staff do, with publish_dining_day. The rules, the prompt, the timing budget and the order of every
// guard live in parse.mjs (tested in Node); this file wires them to Supabase and Anthropic.
//
// THE READ RUNS IN THE BACKGROUND (review round 2026-09-26). The request answers 202 right after
// the claim and the model call continues under EdgeRuntime.waitUntil; the staff screen polls the
// upload row's status. The call has no retries and a hard timeout (parse.mjs MODEL_TIMEOUT_MS) so
// it ends inside the edge limits, and every paid call is metered in a `finally`, success or failure.
// Where waitUntil is missing (a local runtime), the read runs inline: the same timeout still keeps it
// inside the 150 s request limit.
//
// Deploy:
//   supabase functions deploy dining-menu            (verify_jwt stays on; see config.toml)
// Secrets it reads (all already set for the other AI functions): ANTHROPIC_API_KEY,
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Optional knobs:
//   ANTHROPIC_MODEL_DINING   the vision model for photos and PDFs (default ANTHROPIC_MODEL, then claude-sonnet-5)
//   ANTHROPIC_TEXT_MODEL     the model for pasted text (default claude-haiku-4-5-20251001)
//   DINING_MENU_DAILY_CAP    paid reads per team per day (default 6)
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { recordAiCall, usageFrom } from '../_shared/ai-telemetry.ts';
import { checkSpend } from '../_shared/spend-gate.ts';
import { trackAuthedAiSpend } from '../_shared/ai-tier-budget.ts';
import { missingConsent } from '../_shared/ai-consent.mjs';
import { clientIpFrom } from '../_shared/client-ip.ts';
import {
  MENU_TOOL, MENU_SYSTEM, MAX_UPLOAD_BYTES, MAX_TOKENS, MODEL_TIMEOUT_MS, MAX_PDF_PAGES, STUCK_MINUTES,
  menuRequest, sniffMime, toBase64, menuUserContent, runUpload, capFrom, countPdfPages,
} from './parse.mjs';

const MODEL = Deno.env.get('ANTHROPIC_MODEL_DINING') ?? Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';
const TEXT_MODEL = Deno.env.get('ANTHROPIC_TEXT_MODEL') ?? 'claude-haiku-4-5-20251001';
const TEAM_CAP = capFrom(Deno.env.get('DINING_MENU_DAILY_CAP'), 6);
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

/** Supabase's background-task hook (hosted Edge Runtime). Absent elsewhere. */
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const waitUntil = (p: Promise<unknown>): boolean => {
  try {
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime && typeof EdgeRuntime.waitUntil === 'function') { EdgeRuntime.waitUntil(p); return true; }
  } catch { /* not this runtime */ }
  return false;
};

// CORS: the analyze-meal / plan-generate allowlist (a native app sends no Origin).
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

// Best-effort per-IP limit (the plan-generate pattern): blunts a single hammering client. The real
// ceilings are the per-team daily cap and the dollar gate.
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '20');
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request): boolean {
  const ip = clientIpFrom(req);
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) { rlHits.set(ip, { count: 1, resetAt: now + 60_000 }); return false; }
  e.count++;
  return e.count > RL_MAX;
}

type Upload = {
  id: string; team_id: string; hall_id: string; kind: 'photo' | 'pdf' | 'text';
  paths: string[] | null; text_body: string | null; starts_on: string; status: string;
};
type Prepared = { files: { mime: string; b64: string }[]; images: number; pages: number };

class ReadError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

Deno.serve(async (request) => {
  const cors = corsFor(request);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  if (rateLimited(request)) return json(429, { error: 'rate_limited' });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json(503, { error: 'unavailable' });

  let ask: { uploadId: string } | null = null;
  try { ask = menuRequest(await request.json()); } catch { ask = null; }
  if (!ask) return json(400, { error: 'bad_request' });

  // The caller's own client: every authorization question is asked WITH THEIR JWT, so the one
  // predicate the database enforces (can_set_team_phase) is the one this function trusts.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: request.headers.get('authorization') ?? '' } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId: string | null = userData?.user?.id ?? null;
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let hallName = '';

  const result = await runUpload({ uploadId: ask.uploadId, userId }, {
    // A read the platform killed mid-call leaves its row 'parsing'. Past STUCK_MINUTES it reads as
    // failed (timeout), so staff can upload again.
    sweep: async () => {
      try {
        await service.from('dining_menu_uploads').update({ status: 'failed', error: 'timeout', parsed_at: new Date().toISOString() })
          .eq('status', 'parsing').lt('claimed_at', new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString());
      } catch { /* the next request sweeps */ }
    },
    loadUpload: async (id: string) => {
      const { data, error } = await service.from('dining_menu_uploads')
        .select('id, team_id, hall_id, kind, paths, text_body, starts_on, status, dining_halls(name)').eq('id', id).maybeSingle();
      if (error || !data) return null;
      const h = (data as { dining_halls?: { name?: string } | { name?: string }[] }).dining_halls;
      hallName = String((Array.isArray(h) ? h[0]?.name : h?.name) ?? '');
      return data as Upload;
    },
    canEdit: async (teamId: string) => {
      const { data, error } = await userClient.rpc('can_set_team_phase', { t: teamId });
      return !error && data === true;
    },
    consentMissing: async () => (await missingConsent(service, [userId])) !== null,
    entitled: async (teamId: string) => {
      // 0223: a lapsed plan keeps its data readable and loses its writes; a paid read is a write.
      // Unknown answers fail OPEN, the book_access convention (a bad id is a bug, not a lockout).
      try {
        const { data, error } = await userClient.rpc('book_access', { p_kind: 'team', p_book: teamId });
        if (error || !data) return true;
        return (data as { entitled?: boolean }).entitled !== false;
      } catch { return true; }
    },
    // Download and check everything BEFORE any money moves: the real type of each file, the total
    // size, and a PDF's page count (more than MAX_PDF_PAGES, or a count we cannot read, is refused).
    prepare: async (up: Upload): Promise<Prepared> => {
      if (up.kind === 'text') return { files: [], images: 0, pages: 0 };
      const files: { mime: string; b64: string }[] = [];
      let total = 0;
      let pages = 0;
      for (const path of (up.paths ?? []).slice(0, 6)) {
        const { data, error } = await service.storage.from('dining-menus').download(path);
        if (error || !data) throw new ReadError('bad_file');
        const bytes = new Uint8Array(await data.arrayBuffer());
        total += bytes.length;
        if (total > MAX_UPLOAD_BYTES) throw new ReadError('too_large');
        const mime = sniffMime(bytes);
        if (!mime || (up.kind === 'pdf') !== (mime === 'application/pdf')) throw new ReadError('bad_file');
        if (mime === 'application/pdf') {
          const n = await countPdfPages(bytes);
          if (n === null) throw new ReadError('pages_unknown');
          if (n > MAX_PDF_PAGES) throw new ReadError('too_many_pages');
          pages += n;
        }
        files.push({ mime, b64: toBase64(bytes) });
      }
      if (!files.length) throw new ReadError('bad_file');
      return { files, images: up.kind === 'photo' ? files.length : 0, pages };
    },
    spendAllowed: async (estimate: number) => {
      const v = await checkSpend(estimate);
      if (!v.allowed) console.log(JSON.stringify({ evt: 'ai_spend_block', fn: 'dining-menu', reason: v.reason }));
      return v.allowed;
    },
    claim: async (id: string) => {
      const { data, error } = await service.from('dining_menu_uploads')
        .update({ status: 'parsing', claimed_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending').select('id');
      return !error && Array.isArray(data) && data.length === 1;
    },
    unclaim: async (id: string) => {
      await service.from('dining_menu_uploads').update({ status: 'pending', claimed_at: null }).eq('id', id).eq('status', 'parsing');
    },
    teamCap: async (teamId: string) => {
      // Fail CLOSED: unlike a meal log, nothing an athlete needs right now waits on this.
      try {
        const { data, error } = await service.rpc('claim_ai_usage_key', { p_key: `dining_menu:${teamId}`, p_limit: TEAM_CAP });
        if (error) return false;
        const row = Array.isArray(data) ? data[0] : data;
        return row?.allowed === true;
      } catch { return false; }
    },
    background: async (fn: () => Promise<void>) => {
      const p = fn().catch((e) => console.error('dining-menu background error:', String((e as Error)?.message ?? e).slice(0, 200)));
      if (!waitUntil(p)) await p;
    },
    readModel: async (up: Upload, prep: Prepared) => {
      void trackAuthedAiSpend(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId!, 'dining-menu');
      const content = up.kind === 'text'
        ? menuUserContent({ startDate: up.starts_on, hallName, text: String(up.text_body ?? '') })
        : menuUserContent({ startDate: up.starts_on, hallName, files: prep.files });
      const model = up.kind === 'text' ? TEXT_MODEL : MODEL;
      const t0 = Date.now();
      let msg: Anthropic.Message | null = null;
      let errorCode: string | null = 'upstream_error';
      try {
        msg = await new Anthropic({ apiKey, maxRetries: 0, timeout: MODEL_TIMEOUT_MS }).messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system: [{ type: 'text', text: MENU_SYSTEM, cache_control: { type: 'ephemeral' } }],
          tools: [{ ...MENU_TOOL, cache_control: { type: 'ephemeral' } }] as unknown as Anthropic.Tool[],
          tool_choice: { type: 'tool', name: MENU_TOOL.name },
          messages: [{ role: 'user', content: content as Anthropic.MessageParam['content'] }],
        });
        errorCode = msg.stop_reason === 'max_tokens' ? 'max_tokens' : null;
      } catch (e) {
        const timedOut = e instanceof Anthropic.APIConnectionTimeoutError || Date.now() - t0 >= MODEL_TIMEOUT_MS - 1000;
        errorCode = timedOut ? 'timeout' : 'upstream_error';
        console.error('dining-menu upstream error:', String((e as Error)?.message ?? e).slice(0, 200));
      } finally {
        await recordAiCall({
          fn: 'dining-menu', mode: up.kind, userId, model: msg?.model ?? model, ...(msg ? usageFrom(msg.usage) : {}),
          latencyMs: Date.now() - t0, ok: errorCode === null, errorCode,
        });
      }
      if (!msg) throw new ReadError(errorCode === 'timeout' ? 'timeout' : 'upstream');
      if (errorCode === 'max_tokens') throw new ReadError('truncated');
      const tool = msg.content.find((b) => b.type === 'tool_use') as { input?: unknown } | undefined;
      return { input: tool?.input ?? null };
    },
    writeDrafts: async (rows: Record<string, unknown>[]) => {
      // A new upload REPLACES the draft for the same day and period; a published menu is untouched
      // until staff publish again.
      const { error } = await service.from('dining_menus').upsert(rows, { onConflict: 'hall_id,menu_date,period,status' });
      if (error) console.error('dining-menu save error:', error.message);
      return !error;
    },
    finish: async (id: string, n: number) => {
      await service.from('dining_menu_uploads').update({ status: 'parsed', entries: n, parsed_at: new Date().toISOString(), error: null }).eq('id', id).eq('status', 'parsing');
    },
    fail: async (id: string, code: string) => {
      await service.from('dining_menu_uploads').update({ status: 'failed', error: code, parsed_at: new Date().toISOString() }).eq('id', id).eq('status', 'parsing');
    },
  });

  return json(result.status, result.body);
});
