/* ============================================================
   OB2 engine — adaptive narrative onboarding (2026-07).
   One engine, six role flows. A flow is an ordered list of
   steps grouped into 5 chapters; the engine turns it into a
   router screen: hash sub = step id, progress = chapter fill,
   next/back respect conditional `when` branching.

   All answers land in RT.ob via act.captureOb — the SAME keys
   the persistence layer already reads (name, dob, sport, goal,
   join:{kind,code}, standard, committedAt, email…), so account
   creation, join-code redemption, and COPPA handling keep
   working unchanged. New discovery keys ride alongside; the
   persist functions ignore extras.
   ============================================================ */
import { RT, act } from './state.js';
import { icon } from './icons.js';
import { esc } from './components.js';
import { track, EVENTS } from './analytics.js';

export const CHAPTERS = ['Discover', 'See it', 'Your plan', 'Commit', 'Start'];

export const ob = () => RT.ob || {};
export const capture = (patch) => act.captureOb(patch);

/* ---------- chapter progress (5 segments, WEIGHTED by step count) ----------
   Equal-width segments made the bar move at wildly different speeds per chapter
   (athlete ch0 is ~8 steps, ch2 is 2), so progress visibly stalled in exactly the
   long discovery block where drop-off is worst. Each segment now flexes to its own
   step count, so one step always advances the bar by the same distance. */
function chapterProgress(steps, idx) {
  const cur = steps[idx].ch;
  const counts = CHAPTERS.map((_, c) => steps.filter((s) => s.ch === c).length);
  const inCh = steps.filter((s) => s.ch === cur);
  const pos = inCh.indexOf(steps[idx]) + 1;
  const pct = Math.round((pos / inCh.length) * 100);
  const total = steps.length;
  const doneSteps = steps.slice(0, idx + 1).length;
  const segs = CHAPTERS.map((_, c) => {
    /* flex-grow = steps in this chapter; empty chapters keep a hairline presence */
    const w = ` style="flex:${counts[c] || 0.001}"`;
    if (c < cur) return `<div class="seg done"${w}><i></i></div>`;
    if (c === cur) return `<div class="seg"${w}><i style="width:${pct}%"></i></div>`;
    return `<div class="seg"${w}><i></i></div>`;
  }).join('');
  return `<div class="ob2-prog" role="progressbar" aria-label="Step ${doneSteps} of ${total} — ${CHAPTERS[cur]}" aria-valuenow="${doneSteps}" aria-valuemin="0" aria-valuemax="${total}">${segs}</div><div class="ob2-ch-label">${CHAPTERS[cur]}</div>`;
}

/* ---------- step-view funnel ----------
   Fired once per step ARRIVAL for every flow. Deduped on (route, step) because
   several steps call window.__render() to repaint after a selection, which
   re-runs mount() — without this, those screens would double-count and read as
   the funnel's healthiest. */
let lastStepKey = null;
export function trackStep(route, step, ch) {
  const key = `${route}/${step}`;
  if (key === lastStepKey) return;
  lastStepKey = key;
  track(EVENTS.ONBOARDING_STEP, { route, step, ch });
}

/* ---------- flow factory → router screen module ---------- */
export function defineFlow({ route, steps }) {
  const visible = () => steps.filter((s) => !s.when || s.when(ob()));
  const resolve = (sub) => {
    const vis = visible();
    const i = vis.findIndex((s) => s.id === sub);
    return { vis, idx: i >= 0 ? i : 0 };
  };
  const nextRoute = (vis, idx) => {
    const s = vis[idx];
    const n = s.next ? s.next(ob()) : (vis[idx + 1] && vis[idx + 1].id);
    return n ? `${route}/${n}` : null;
  };
  const backRoute = (vis, idx) => {
    const s = vis[idx];
    if (s.back) return s.back;
    return idx > 0 ? `${route}/${vis[idx - 1].id}` : 'role';
  };
  return {
    hideTabs: true,
    render({ sub }) {
      const { vis, idx } = resolve(sub);
      const s = vis[idx];
      const o = ob();
      const next = nextRoute(vis, idx);
      const foot = s.noFoot ? '' : `
        <div class="ob-foot">
          <button class="btn ${s.green ? 'green' : 'primary'}" id="ob2-next" ${next ? `data-go="${next}"` : ''}>${s.cta || 'Continue'}</button>
          ${s.skip ? `<div class="ob-textlink" data-go="${next}">Skip for now</div>` : ''}
        </div>`;
      return `
      <div class="ob">
        <div class="ob-nav"><div class="ob-back" data-go="${backRoute(vis, idx)}" aria-label="Back">${icon('chevron', 18)}</div>${chapterProgress(vis, idx)}</div>
        ${s.title ? `<div class="ob-title">${s.title(o) || ''}</div>` : ''}
        ${s.sub ? `<div class="ob-sub">${s.sub(o) || ''}</div>` : ''}
        <div class="ob-body">${s.body ? s.body(o) : ''}</div>
        ${foot}
      </div>`;
    },
    mount(root, { sub }) {
      const { vis, idx } = resolve(sub);
      const s = vis[idx];
      trackStep(route, s.id, s.ch);
      /* Resume crumb: where this person actually got to. Read by the role screen so a
         drop-out returns to their own step instead of re-walking the whole flow.
         Cleared by act.persistOnboarding* once the account exists. */
      if (!RT.userId) capture({ obResume: `${route}/${s.id}` });
      const ctx = {
        ob: ob(), capture,
        nextRoute: nextRoute(vis, idx),
        go: (r) => window.__navigate(r),
        next: () => { const n = nextRoute(vis, idx); if (n) window.__navigate(n); },
      };
      wireChoices(root);
      animateMeters(root);
      if (s.mount) s.mount(root, ctx);
      gateCta(root);
    },
  };
}

/* ---------- declarative answer capture ----------
   <div class="choice-grid" data-obkey="goal" data-req>…<div class="choice" data-val="gain">…
   single-select; data-obkey-multi stores an array; .ob2-scale works the same.
   data-req groups gate the engine CTA until they hold a selection. */
export function wireChoices(root) {
  root.querySelectorAll('[data-obkey]').forEach((g) => {
    const key = g.getAttribute('data-obkey');
    g.querySelectorAll('[data-val]').forEach((el) => el.addEventListener('click', () => {
      g.querySelectorAll('[data-val]').forEach((x) => x.classList.remove('on'));
      el.classList.add('on');
      let v = el.getAttribute('data-val');
      if (/^-?\d+$/.test(v)) v = Number(v);
      capture({ [key]: v });
      gateCta(root);
    }));
  });
  root.querySelectorAll('[data-obkey-multi]').forEach((g) => {
    const key = g.getAttribute('data-obkey-multi');
    g.querySelectorAll('[data-val]').forEach((el) => el.addEventListener('click', () => {
      el.classList.toggle('on');
      const vals = [...g.querySelectorAll('[data-val].on')].map((x) => x.getAttribute('data-val'));
      capture({ [key]: vals });
      gateCta(root);
    }));
  });
}
export function gateCta(root) {
  const btn = root.querySelector('#ob2-next');
  if (!btn) return;
  const groups = [...root.querySelectorAll('[data-req]')];
  const extra = btn.getAttribute('data-gate-extra');
  const extraOk = !extra || !!root.querySelector(extra);
  btn.disabled = !extraOk || groups.some((g) => !g.querySelector('.on'));
}

/* ---------- selection markup helpers ---------- */
export function choiceGrid(key, opts, { multi = false, req = true, current = null } = {}) {
  const cur = current != null ? current : ob()[key];
  const on = (v) => (multi ? (Array.isArray(cur) && cur.map(String).includes(String(v))) : String(cur) === String(v));
  return `<div class="choice-grid" ${multi ? 'data-obkey-multi' : 'data-obkey'}="${key}" ${req ? 'data-req' : ''}>${opts.map((o) => `
    <div class="choice ${on(o.v) ? 'on' : ''}" data-val="${esc(o.v)}" role="button" aria-label="${esc(o.t)}">
      ${o.ic ? `<div class="cic" style="background:${o.tint || 'var(--blue-surface)'};color:${o.color || 'var(--blue-bright)'}">${icon(o.ic, 18)}</div>` : ''}
      <div class="ct">${esc(o.t)}</div>${o.s ? `<div class="cs">${esc(o.s)}</div>` : ''}
    </div>`).join('')}</div>`;
}
export function chipRow(key, opts, { multi = false, req = true } = {}) {
  const cur = ob()[key];
  const on = (v) => (multi ? (Array.isArray(cur) && cur.map(String).includes(String(v))) : String(cur) === String(v));
  return `<div class="chip-row" ${multi ? 'data-obkey-multi' : 'data-obkey'}="${key}" ${req ? 'data-req' : ''}>${opts.map((o) => {
    const v = typeof o === 'string' ? o : o.v; const t = typeof o === 'string' ? o : o.t;
    return `<div class="chp ${on(v) ? 'on' : ''}" data-val="${esc(v)}" role="button">${esc(t)}</div>`;
  }).join('')}</div>`;
}
/* `lo`/`hi` label the ends of the scale. They default to the original wording, but a scale
   measuring something other than intensity (e.g. "does anyone notice?") needs its own
   anchors or the numbers mean nothing. `label` names the scale when two share a screen. */
export function scale10(key, { lo = 'Not close', hi = 'All the way', label = '' } = {}) {
  const cur = ob()[key];
  return `${label ? `<div class="eyebrow" style="margin:0 2px 10px">${esc(label)}</div>` : ''}
  <div class="ob2-scale" data-obkey="${key}" data-req role="group" aria-label="${esc(label || 'Rate from 1 to 10')}">${
    Array.from({ length: 10 }, (_, i) => `<div class="sc ${cur === i + 1 ? 'on' : ''}" data-val="${i + 1}" role="button" aria-label="${i + 1}">${i + 1}</div>`).join('')
  }</div><div class="ob2-scale-keys"><span>${esc(lo)}</span><span>${esc(hi)}</span></div>`;
}

/* ---------- shared "save your progress" step (every flow, right after commit) ----------
   Until now the ONLY email capture was the final account screen, so anyone who dropped at
   screen 18 of 26 was unrecoverable — no address, no way back. This sits at peak intent
   (they just held a button to commit) and writes RT.ob.email, which `accountBody` already
   reads and prefills, so it pays for itself immediately even before any send rail exists.

   COPY DISCIPLINE: it must NOT promise "we'll email you a link to finish" — there is no
   abandoned-onboarding send rail yet, and this flow never promises what can't happen. When
   that rail ships, this is the address it uses, and the sub-copy can make the promise then. */
export function saveProgressStep(ch = 3) {
  return {
    id: 'save', ch, cta: 'Save it', skip: true,
    title: () => 'Where should we save this?',
    sub: () => 'Add your email now and your account is one password away.',
    body: (o) => `
      <input id="ob2-email" class="ob-input" type="email" inputmode="email" autocapitalize="none"
        autocorrect="off" spellcheck="false" placeholder="Email" aria-label="Email" value="${esc(o.email || '')}" />
      <div class="ob2-scan-note" style="text-align:left">Skip it if you'd rather — nothing is lost. Your answers stay on this device either way.</div>`,
    mount(root) {
      const el = root.querySelector('#ob2-email');
      const btn = root.querySelector('#ob2-next');
      if (!el) return;
      if (btn) btn.setAttribute('data-gate-extra', '#ob2-email.ok');
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      const sync = () => {
        const v = el.value.trim();
        const ok = EMAIL_RE.test(v);
        capture({ email: ok ? v : '' });
        el.classList.toggle('ok', ok);
        if (btn) btn.disabled = !ok;
      };
      el.addEventListener('input', sync);
      sync();
    },
  };
}

/* ---------- Standard Meter (signature element) ----------
   270° arc, green→teal→blue signature sweep. pct 0–100 fills the arc;
   value/label sit centered. animateMeters() draws it in on mount. */
export function meter(pct, { size = 168, value = '', label = '', uid = 'm', muted = false } = {}) {
  const stroke = Math.max(10, Math.round(size / 14));
  const r = (size - stroke) / 2, c = size / 2;
  const target = Math.max(0, Math.min(100, pct)) * 0.75; /* of pathLength 100 */
  return `
  <div class="ob2-meter" style="position:relative;width:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <defs><linearGradient id="og-${uid}" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="var(--ring-a)"/><stop offset="50%" stop-color="var(--ring-b)"/><stop offset="100%" stop-color="var(--ring-c)"/>
      </linearGradient></defs>
      <circle class="arc-track" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round"
        pathLength="100" stroke-dasharray="75 100" transform="rotate(135 ${c} ${c})"/>
      <circle class="arc-fill" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${muted ? 'var(--text-3)' : `url(#og-${uid})`}" stroke-width="${stroke}" stroke-linecap="round"
        pathLength="100" stroke-dasharray="0 100" data-arc="${target.toFixed(1)}" transform="rotate(135 ${c} ${c})"/>
    </svg>
    <div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center">
      <div><div class="mv">${esc(value)}</div>${label ? `<div class="mk">${esc(label)}</div>` : ''}</div>
    </div>
  </div>`;
}
export function animateMeters(root) {
  const arcs = root.querySelectorAll('.arc-fill[data-arc]');
  if (!arcs.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    arcs.forEach((a) => { a.style.strokeDasharray = `${a.getAttribute('data-arc')} 100`; });
  }));
}

/* ---------- shared narrative components ---------- */
export function simChip(text = 'Simulated preview') {
  return `<div class="ob2-sim"><span class="status-pill muted">${esc(text)}</span></div>`;
}
export function mirrorCard(ic, html) {
  return `<div class="ob2-mirror"><div class="mi">${icon(ic, 17)}</div><div class="mt">${html}</div></div>`;
}
export function countStat(value, caption, math = '') {
  return `<div class="ob2-count"><div class="cv" data-count="${esc(value)}">${esc(value)}</div>
    <div class="ck">${caption}</div>${math ? `<div class="cmath">${esc(math)}</div>` : ''}</div>`;
}
export function chatSim(msgs) {
  const AV = { ai: ['ai', 'AI'], coach: ['coach', 'C'], trainer: ['coach', 'T'], me: ['me', 'You'] };
  return `<div class="ob2-chat">${msgs.map((m, i) => {
    const [cls, init] = AV[m.who] || AV.ai;
    const me = m.who === 'me';
    return `<div class="cm ${me ? 'me' : cls}" style="animation-delay:${i * 140}ms">
      <div class="av ${me ? 'me' : cls}">${esc(m.init || init)}</div>
      <div class="bw"><div class="who">${esc(m.name)}${m.sim ? ` · <span>simulated</span>` : ''}</div>
      <div class="bub">${esc(m.text)}</div></div></div>`;
  }).join('')}</div>`;
}
export function notifCard({ ic = 'bell', tint = 'var(--blue-surface)', color = 'var(--blue-bright)', title, body, time = 'now' }) {
  return `<div class="ob2-notif"><div class="ni" style="background:${tint};color:${color}">${icon(ic, 17)}</div>
    <div class="nb"><div class="nt"><div class="t">${esc(title)}</div><div class="tm">${esc(time)}</div></div>
    <div class="ns">${esc(body)}</div></div></div>`;
}
export function phoneCard(label, inner) {
  return `<div class="ob2-phone">${label ? `<div class="ph-head"><div class="ph-t">${esc(label)}</div></div>` : ''}${inner}</div>`;
}
export function testimonial({ quote, name, role, initials, stat, statKey }) {
  return `<div class="ob2-testi"><div class="tq">${esc(quote)}</div>
    <div class="tw"><div class="ta">${esc(initials || (name || '?')[0])}</div>
    <div><div class="tn">${esc(name)}</div><div class="tr">${esc(role)}</div></div>
    ${stat ? `<div class="ts"><div class="v">${esc(stat)}</div><div class="k">${esc(statKey || '')}</div></div>` : ''}</div></div>`;
}
export function planCard({ id, name, price, per = '/mo', sub, tag, on, cadence, monthly, annual, annualPer, save }) {
  /* Cadence-aware individual plans pass monthly/annual/annualPer/save; legacy pro/org/seat
     plans still pass price/per and render exactly as before. Annual is the framed default. */
  let p = price, u = per, saveLine = '';
  if (annual && cadence) {
    if (cadence === 'annual') { p = annual; u = '/yr'; saveLine = `${annualPer}/mo · ${save}`; }
    else { p = monthly; u = '/mo'; }
  }
  return `<div class="ob2-plan ${on ? 'on' : ''}" data-val="${esc(id)}" role="button" aria-label="${esc(name)}">
    ${tag ? `<div class="pl-tag">${esc(tag)}</div>` : ''}
    <div class="pl-row"><div class="pl-t">${esc(name)}</div><div class="pl-p">${esc(p)}<small>${esc(u)}</small></div></div>
    <div class="pl-s">${esc(sub)}</div>
    ${saveLine ? `<div class="pl-save">${esc(saveLine)}</div>` : ''}
    <div class="pl-check">${icon('check', 16)}</div></div>`;
}

/* ---------- adaptive account/paywall resolution ----------
   Entry context beats role. The billing rail is the honest "free preview" seam
   (nothing charges live yet); selection is captured to RT.ob.plan for go-live. */
export function paywallVariant(role) {
  const o = ob();
  if (o.join && o.join.kind === 'team') return 'team_covered';
  if (o.join && o.join.kind === 'practice') return 'trainer_covered';
  if (role === 'coach') return 'org';
  if (role === 'trainer') return 'pro';
  if (role === 'parent') return 'free';
  if (role === 'nutritionist') return 'seat';
  return 'individual';
}

/* Mirrors src/core/pricing.ts PLAN_CATALOG — display only; the checkout rail
   is go-live gated so these capture intent, they don't charge. */
export const PLANS = {
  individual: [
    { id: 'individual', name: 'Individual', monthly: '$14.99', annual: '$126', annualPer: '$10.50', save: 'Save $54', tag: '7-day free trial',
      sub: 'Daily Score, AI meal analysis, streaks, one connected supporter.' },
    { id: 'individual_plus', name: 'Individual+', monthly: '$24.99', annual: '$210', annualPer: '$17.50', save: 'Save $90',
      sub: 'Everything in Individual plus full history, trends, and unlimited supporters.' },
  ],
  pro: [
    { id: 'pro_solo', name: 'Pro Solo', price: '$49', sub: 'Up to 25 clients. Client codes, AI reviews, your daily queue.', tag: '14-day free trial' },
    { id: 'professional', name: 'Professional', price: '$99', sub: 'Up to 50 clients, then $10 per extra block. Priority support.' },
  ],
  org: [
    { id: 'org_starter', name: 'Team Starter', price: '$99', sub: 'Up to 30 athletes. Rooms, standards, alerts, staff seats.', tag: '14-day free trial' },
    { id: 'org_growth', name: 'Program', price: '$199', sub: 'Up to 75 athletes across teams. Position rooms + insights.' },
    { id: 'org_performance', name: 'Performance', price: '$349', sub: 'Up to 150 athletes. Org-wide standards and analytics.' },
  ],
  seat: [
    { id: 'pro_solo', name: 'Nutrition Pro', price: '$49', sub: 'Up to 25 clients. Review queue, corrections, trends, flags.', tag: '14-day free trial' },
    { id: 'professional', name: 'Practice', price: '$99', sub: 'Up to 50 clients plus team collaboration seats.' },
  ],
};
