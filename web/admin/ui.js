// OnStandard — Command Center shared UI vocabulary. Pure DOM + formatting helpers, extracted from the
// original single-file admin.js so every section reuses the SAME primitives. All dynamic values go
// through textContent (the 'html' key in h() is intentionally a no-op) — no data path can inject markup.
import { sb, rpc } from './api.js';

export const $ = (id) => document.getElementById(id);
export const show = (el, on) => el && el.classList.toggle('hidden', !on);
export const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
export const numN = (v) => { if (v == null) return null; const x = Number(v); return isFinite(x) ? x : null; };
export const one = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : {});
export const usd4 = (v) => (v == null ? '—' : `$${num(v).toFixed(4)}`);
export const usd2 = (v) => `$${num(v).toFixed(2)}`;
export const pct = (v) => (v == null ? '—' : `${(num(v) * 100).toFixed(1)}%`);
export const iso = () => new Date().toISOString();
export const todayStr = () => new Date().toISOString().slice(0, 10);
export function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function h(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'text') e.textContent = attrs[k];
    else if (k === 'html') { /* never */ }
    else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of [].concat(children || [])) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

export function toast(msg, isErr) {
  const t = h('div', { class: 'toast' + (isErr ? ' err' : ''), text: msg });
  $('toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, isErr ? 5200 : 3400);
}

// blue→teal sparkline with an area wash + last-point dot. Coordinates only (safe).
export function sparkline(values, opts = {}) {
  const w = opts.w || 280, ht = opts.h || 38;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'spark'); svg.setAttribute('viewBox', `0 0 ${w} ${ht}`); svg.setAttribute('preserveAspectRatio', 'none');
  const nums = (values || []).map(num).filter((x) => isFinite(x));
  if (nums.length < 2) { svg.appendChild(h('text', {})); return svg; }
  const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
  const step = w / (nums.length - 1);
  const xy = (v, i) => [i * step, ht - 3 - ((v - min) / span) * (ht - 6)];
  const pts = nums.map(xy);
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const lg = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  lg.setAttribute('id', id); lg.setAttribute('x1', '0'); lg.setAttribute('x2', '1'); lg.setAttribute('y1', '0'); lg.setAttribute('y2', '0');
  [['0', '#3b82f6'], ['1', '#33c6d6']].forEach(([o, c]) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'stop'); s.setAttribute('offset', o); s.setAttribute('stop-color', c); lg.appendChild(s); });
  defs.appendChild(lg); svg.appendChild(defs);
  const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  area.setAttribute('d', `M0,${ht} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${w},${ht} Z`);
  area.setAttribute('fill', `url(#${id})`); area.setAttribute('opacity', '0.08'); svg.appendChild(area);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
  line.setAttribute('fill', 'none'); line.setAttribute('stroke', `url(#${id})`); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-linejoin', 'round'); line.setAttribute('stroke-linecap', 'round');
  svg.appendChild(line);
  const last = pts[pts.length - 1];
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', last[0].toFixed(1)); dot.setAttribute('cy', last[1].toFixed(1)); dot.setAttribute('r', '2.6'); dot.setAttribute('fill', '#33c6d6');
  svg.appendChild(dot);
  return svg;
}

export function row(k, v, delta) {
  const vv = h('span', { class: 'v num' }, [String(v)]);
  if (delta) vv.appendChild(h('span', { class: 'd ' + delta.cls, text: ' ' + delta.txt }));
  return h('div', { class: 'row' }, [h('span', { class: 'k', text: k }), vv]);
}
export function card(title, nodes, headLink) {
  const hd = h('div', { class: 'hd' }, [h('h3', { text: title })]);
  if (headLink) hd.appendChild(h('span', { class: 'link', text: headLink.text, onclick: headLink.onclick, role: 'button', tabindex: '0' }));
  return h('div', { class: 'card' }, [hd, ...nodes]);
}
export function deltaOf(cur, prev, goodUp = true) {
  if (prev == null || cur == null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return { cls: 'flat', txt: '·' };
  const good = d > 0 ? goodUp : !goodUp;
  return { cls: good ? 'up' : 'down', txt: (d > 0 ? '+' : '') + (Math.abs(d) < 1 ? d.toFixed(3) : Math.round(d)) };
}

export function tbl(headers, rows) {
  const thead = h('tr', {}, headers.map((x) => typeof x === 'object' ? h('th', { class: x.num ? 'num' : '', text: x.t }) : h('th', { text: x })));
  const body = rows.map((r) => h('tr', {}, r.map((c, i) => {
    const isNum = typeof headers[i] === 'object' && headers[i].num;
    return h('td', { class: isNum ? 'num' : '', text: String(c) });
  })));
  return h('table', {}, [h('thead', {}, [thead]), h('tbody', {}, body)]);
}

// small pill for status/role/minor/guardian markers; kind ∈ 'warn'|'note'|'ok'|'' (styled in index.html)
export function badge(text, kind) {
  return h('span', { class: 'badge' + (kind ? ' ' + kind : ''), text });
}
export function emptyState(text) {
  return h('div', { class: 'empty', text });
}

// ---------- modal ----------
export function openModal(title, bodyNodes) {
  closeModal();
  const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) closeModal(); } });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'mh' }, [h('h3', { text: title }), h('button', { class: 'btn ghost sm', text: 'Close', onclick: closeModal })]),
    h('div', { class: 'mb' }, bodyNodes),
  ]);
  scrim.appendChild(modal);
  $('modal-root').appendChild(scrim);
  document.addEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
export function closeModal() { $('modal-root').textContent = ''; document.removeEventListener('keydown', escClose); }

// ---------- step-up reauth ----------
let _identityEmail = null;
export function setIdentity(email) { _identityEmail = email; }

// Gate a sensitive action behind SERVER-VERIFIED step-up: re-enter password (fresh amr) → open a grant
// (single-use for financial) → run the action. The server enforces the grant; this is the UX for it.
// Resolves only on success; on failure it keeps the modal open. Closing the modal simply cancels.
export function withReauth(scope, actionFn, opts = {}) {
  return new Promise((resolve) => {
    const pw = h('input', { type: 'password', placeholder: 'Re-enter your password', autocomplete: 'current-password' });
    const err = h('p', { class: 'err' });
    let busy = false;
    const confirm = h('button', { class: 'btn pri', text: opts.label || 'Confirm', onclick: async () => {
      if (busy) return; busy = true; err.textContent = '';
      try {
        const { error: e1 } = await sb.auth.signInWithPassword({ email: _identityEmail, password: pw.value });
        if (e1) { err.textContent = 'Re-authentication failed: ' + e1.message; busy = false; return; }
        await rpc('admin_open_sensitive_window', { p_scope: scope, p_single_use: !!opts.single });
        closeModal();
        resolve(await actionFn());
      } catch (e) { err.textContent = String((e && e.message) || e); busy = false; }
    } });
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm.click(); });
    openModal('Confirm your identity', [
      h('p', { class: 'cap', text: `This ${scope.replace(/_/g, ' ')} action needs you to re-enter your password.` }),
      h('label', { class: 'fld', text: 'Password' }), pw, err,
      h('div', { style: 'height:12px' }), confirm,
    ]);
    setTimeout(() => { try { pw.focus(); } catch (_) { /* noop */ } }, 60);
  });
}
