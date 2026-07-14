// OnStandard site worker: serves the static landing page and handles the
// early-access waitlist (POST /api/waitlist -> KV) plus a secret-gated
// leads view (/api/leads?key=...). Everything else falls through to assets.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- capture an early-access signup ---
    if (url.pathname === '/api/waitlist' && request.method === 'POST') {
      try {
        const ct = request.headers.get('content-type') || '';
        const body = ct.includes('application/json')
          ? await request.json()
          : Object.fromEntries(await request.formData());
        const clean = (v, n) => (v == null ? '' : String(v)).trim().slice(0, n);
        const name = clean(body.name, 120);
        const email = clean(body.email, 200);
        const role = clean(body.role, 40);
        const note = clean(body.note, 600);
        if (body.company) return json({ ok: true }); // honeypot: pretend success
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return json({ ok: false, error: 'Enter a valid email address.' }, 400);
        }
        const ts = new Date().toISOString();
        const id = crypto.randomUUID();
        const rec = {
          id, name, email, role, note, ts,
          country: (request.cf && request.cf.country) || '',
          ref: request.headers.get('referer') || '',
          ua: request.headers.get('user-agent') || '',
        };
        await env.WAITLIST.put(`signup:${ts}:${id}`, JSON.stringify(rec), {
          metadata: { email, role },
        });
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
      }
    }

    // --- secret-gated leads view (HTML or ?format=csv) ---
    if (url.pathname === '/api/leads') {
      const key = url.searchParams.get('key') || '';
      if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return new Response('Not found', { status: 404 });

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
        const csv = ['when,email,name,role,country,note',
          ...out.map((r) => [r.ts, r.email, r.name, r.role, r.country, (r.note || '').replace(/[\r\n]+/g, ' ')].map(cell).join(','))].join('\n');
        return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' } });
      }
      const rows = out.map((r) => `<tr><td>${esc(r.ts.slice(0, 16).replace('T', ' '))}</td><td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td><td>${esc(r.name)}</td><td>${esc(r.role)}</td><td>${esc(r.country)}</td><td>${esc(r.note)}</td></tr>`).join('');
      const html = `<!doctype html><html lang=en><head><meta charset=utf-8><title>OnStandard — early access</title><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content="noindex"><style>body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:#070B14;color:#EEF3FB;margin:0;padding:28px}h1{font-size:21px;letter-spacing:-.02em;margin:0 0 4px}p{color:#9AA9C2;margin:0 0 22px;font-size:14px}a{color:#60A5FA}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid rgba(148,176,224,.14);vertical-align:top}th{color:#60A5FA;text-transform:uppercase;font-size:11px;letter-spacing:.08em}tr:hover td{background:rgba(148,176,224,.05)}td:nth-child(1){white-space:nowrap;color:#7C8BA6}</style></head><body><h1>Early access &middot; ${out.length} ${out.length === 1 ? 'signup' : 'signups'}</h1><p>Newest first. <a href="?key=${encodeURIComponent(key)}&format=csv">Download CSV</a></p><table><thead><tr><th>When (UTC)</th><th>Email</th><th>Name</th><th>Role</th><th>Loc</th><th>Note</th></tr></thead><tbody>${rows || '<tr><td colspan=6 style="color:#7C8BA6;padding:20px 12px">No signups yet.</td></tr>'}</tbody></table></body></html>`;
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }

    // --- everything else: the static site ---
    return env.ASSETS.fetch(request);
  },
};
