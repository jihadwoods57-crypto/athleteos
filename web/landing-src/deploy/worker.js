// OnStandard site worker: serves the static landing page and handles the
// early-access waitlist (POST /api/waitlist -> KV) plus a secret-gated
// leads view (/api/leads). Everything else falls through to assets.
//
// AUTH CHANGED 2026-07-30 (security audit, finding #9). /api/leads used to authenticate on
// `?key=<ADMIN_KEY>` in the query string. Query strings end up in Cloudflare request logs, in
// browser history, and in the Referer header of any link clicked from the page — and worse, the
// signup notification email below EMBEDDED that key in a clickable link, so the credential
// guarding the entire lead database (emails, names, notes, IPs, user-agents) sat in plaintext in
// every notification the founder had ever received. It is now a header (`x-admin-key`) compared
// in constant time, the email carries a bare link, and the HTML view no longer re-emits the key
// into its own CSV download link.
//
// Fetch it with:  curl -H "x-admin-key: $ADMIN_KEY" https://onstandard.app/api/leads

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

/** Constant-time compare, so a wrong key leaks nothing through response timing. */
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(String(a ?? ''));
  const bb = enc.encode(String(b ?? ''));
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** Admin gate for /api/leads. Header only — never the query string. */
function adminOk(request, env) {
  if (!env.ADMIN_KEY) return false;
  return safeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_KEY);
}

/** Per-IP hourly cap on the PUBLIC signup endpoint, backed by the KV namespace already bound
 *  here. /api/waitlist had a honeypot but no rate limit, so anyone could flood KV and trigger
 *  unbounded outbound email through the send_email binding (finding #9). Fails OPEN: a KV hiccup
 *  must never cost a real signup, which is the thing this whole endpoint exists to capture. */
async function signupRateLimited(request, env) {
  try {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const hour = new Date().toISOString().slice(0, 13); // yyyy-mm-ddThh
    const key = `rl:${ip}:${hour}`;
    const n = Number(await env.WAITLIST.get(key)) || 0;
    if (n >= 5) return true;
    await env.WAITLIST.put(key, String(n + 1), { expirationTtl: 3600 });
    return false;
  } catch {
    return false;
  }
}

// Best-effort signup alert via Cloudflare Email Routing's send_email binding.
// Sends only to the verified NOTIFY_EMAIL. Any failure is swallowed by the caller
// so a signup is never lost or blocked by a mail hiccup.
async function notifySignup(env, rec) {
  if (!env.NOTIFY || !env.NOTIFY_EMAIL || !env.NOTIFY_FROM) return;
  const { EmailMessage } = await import('cloudflare:email');
  const to = env.NOTIFY_EMAIL;
  const from = env.NOTIFY_FROM;
  // A BARE link — the admin key must never travel in an email body or a URL (finding #9).
  // Opening it needs the x-admin-key header, which the founder supplies deliberately.
  const leads = 'https://onstandard.app/api/leads';
  const body = [
    'New early-access signup on onstandard.app',
    '',
    `Email:   ${rec.email}`,
    `Name:    ${rec.name || '(none)'}`,
    `Role:    ${rec.role || '(none)'}`,
    `Note:    ${rec.note || '(none)'}`,
    `Country: ${rec.country || '(unknown)'}`,
    `Time:    ${rec.ts}`,
    '',
    `All signups: ${leads}`,
  ].join('\r\n');
  const raw = [
    `From: OnStandard <${from}>`,
    `To: ${to}`,
    `Reply-To: ${rec.email}`,
    `Subject: New early-access signup: ${rec.email}`,
    `Message-ID: <${rec.id}@onstandard.app>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
  await env.NOTIFY.send(new EmailMessage(from, to, raw));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- capture an early-access signup ---
    if (url.pathname === '/api/waitlist' && request.method === 'POST') {
      try {
        const ct = request.headers.get('content-type') || '';
        const body = ct.includes('application/json')
          ? await request.json()
          : Object.fromEntries(await request.formData());
        if (await signupRateLimited(request, env)) {
          return json({ ok: false, error: 'Too many signups from this connection. Try again later.' }, 429);
        }
        const clean = (v, n) => (v == null ? '' : String(v)).trim().slice(0, n);
        const name = clean(body.name, 120);
        const email = clean(body.email, 200);
        const role = clean(body.role, 40);
        const note = clean(body.note, 600);
        const intent = clean(body.intent, 24);
        if (body.company) return json({ ok: true }); // honeypot: pretend success
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return json({ ok: false, error: 'Enter a valid email address.' }, 400);
        }
        const ts = new Date().toISOString();
        const id = crypto.randomUUID();
        const rec = {
          id, name, email, role, note, intent, ts,
          country: (request.cf && request.cf.country) || '',
          ref: request.headers.get('referer') || '',
          ua: request.headers.get('user-agent') || '',
        };
        await env.WAITLIST.put(`signup:${ts}:${id}`, JSON.stringify(rec), {
          metadata: { email, role },
        });
        // Fire the alert after responding; never let it block or fail the signup.
        ctx.waitUntil(notifySignup(env, rec).catch(() => {}));
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
      }
    }

    // --- /api/testmail: REMOVED 2026-07-30 (security audit, finding #9).
    // It was labelled "temporary: diagnose the email-send path", authenticated on ?key= like
    // /api/leads did, and returned e.message + 400 chars of stack to the caller. The send path it
    // was written to diagnose has been working for months. A permanent temporary endpoint that
    // leaks stack traces is not worth keeping for a one-off. ---

    // --- admin-gated leads view (HTML or ?format=csv). Auth is the x-admin-key HEADER. ---
    if (url.pathname === '/api/leads') {
      // 404, not 401 — an unauthenticated caller should not learn the endpoint exists.
      if (!adminOk(request, env)) return new Response('Not found', { status: 404 });

      // Safe cleanup: remove only obvious test rows (@example.com). Never touches real signups.
      if (url.searchParams.get('purge') === 'tests') {
        let removed = 0, cur;
        do {
          const page = await env.WAITLIST.list({ prefix: 'signup:', limit: 1000, cursor: cur });
          for (const k of page.keys) {
            const v = await env.WAITLIST.get(k.name);
            if (v && /@example\.com"/.test(v)) { await env.WAITLIST.delete(k.name); removed++; }
          }
          cur = page.list_complete ? null : page.cursor;
        } while (cur);
        return json({ ok: true, removed });
      }

      const out = [];
      let cursor;
      do {
        const page = await env.WAITLIST.list({ prefix: 'signup:', limit: 1000, cursor });
        for (const k of page.keys) {
          const v = await env.WAITLIST.get(k.name);
          if (v) out.push(JSON.parse(v));
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      out.sort((a, b) => b.ts.localeCompare(a.ts));

      if ((url.searchParams.get('format') || '') === 'csv') {
        const cell = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
        const csv = ['when,email,name,role,intent,country,note',
          ...out.map((r) => [r.ts, r.email, r.name, r.role, r.intent || '', r.country, (r.note || '').replace(/[\r\n]+/g, ' ')].map(cell).join(','))].join('\n');
        return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' } });
      }
      const rows = out.map((r) => `<tr><td>${esc(r.ts.slice(0, 16).replace('T', ' '))}</td><td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td><td>${esc(r.name)}</td><td>${esc(r.role)}</td><td>${esc(r.intent || '')}</td><td>${esc(r.country)}</td><td>${esc(r.note)}</td></tr>`).join('');
      const html = `<!doctype html><html lang=en><head><meta charset=utf-8><title>OnStandard — early access</title><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content="noindex"><style>body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:#070B14;color:#EEF3FB;margin:0;padding:28px}h1{font-size:21px;letter-spacing:-.02em;margin:0 0 4px}p{color:#9AA9C2;margin:0 0 22px;font-size:14px}a{color:#60A5FA}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid rgba(148,176,224,.14);vertical-align:top}th{color:#60A5FA;text-transform:uppercase;font-size:11px;letter-spacing:.08em}tr:hover td{background:rgba(148,176,224,.05)}td:nth-child(1){white-space:nowrap;color:#7C8BA6}</style></head><body><h1>Early access &middot; ${out.length} ${out.length === 1 ? 'signup' : 'signups'}</h1><p>Newest first. CSV: <code>curl -H "x-admin-key: &lt;key&gt;" https://onstandard.app/api/leads?format=csv</code></p><table><thead><tr><th>When (UTC)</th><th>Email</th><th>Name</th><th>Role</th><th>Intent</th><th>Loc</th><th>Note</th></tr></thead><tbody>${rows || '<tr><td colspan=7 style="color:#7C8BA6;padding:20px 12px">No signups yet.</td></tr>'}</tbody></table></body></html>`;
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }

    // --- pretty trainer acquisition link: /t/<slug> ---
    // Serves the SPA (t.html) rather than duplicating any rendering here: t.html's own slug
    // reader already recognizes a /t/<slug> path segment (in addition to ?t=/#), so the SAME
    // already-verified client code renders the trainer's page and posts applications. This adds
    // no new Supabase calls, secrets, or HTML-building logic to the Worker.
    //
    // Fetch the EXTENSIONLESS clean URL (/t), matching how /privacy and /terms already resolve —
    // NOT /t.html: static-asset clean-URL handling 307s a .html request to its extensionless
    // form, and building a fresh Request for that redirect target drops the original /t/<slug>
    // path (the slug lives only in THIS request's URL, never in the one we hand to ASSETS).
    const tMatch = url.pathname.match(/^\/t\/[a-f0-9]{8,64}\/?$/);
    if (tMatch) {
      return env.ASSETS.fetch(new Request(new URL('/t', url), request));
    }

    // --- everything else: the static site ---
    return env.ASSETS.fetch(request);
  },
};
