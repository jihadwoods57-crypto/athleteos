// OnStandard — Command Center dashboard. Uses ONLY the anon key + the founder's login JWT; every
// read is a platform-admin-gated RPC (0037/0052/0107/0109/0111). All dynamic values are set via
// textContent (never innerHTML), so no data path can inject markup. The decision logic lives in the
// pure, jest-tested attention.js — this file only fetches, assembles the metrics bundle, and renders.
//
// SETUP (founder): fill SUPABASE_URL + SUPABASE_ANON_KEY. The anon (publishable) key is safe here;
// the service-role key must NEVER appear on this page.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { evaluateFlags, briefing } from './attention.js';

const SUPABASE_URL = ''; // TODO(founder): project URL
const SUPABASE_ANON_KEY = ''; // TODO(founder): anon / publishable key — NOT the service role key
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const show = (el, on) => el.classList.toggle('hidden', !on);
const n = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
const usd = (v) => (v == null ? '—' : `$${n(v).toFixed(4)}`);
const today = () => new Date().toISOString().slice(0, 10);

// ---- tiny DOM builder (textContent only) ----
function h(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'text') e.textContent = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of children || []) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}
function kv(k, v, deltaCls, deltaTxt) {
  const kids = [h('span', { class: 'k', text: k }), h('span', { class: 'v', text: String(v) })];
  if (deltaTxt) kids[1].appendChild(h('span', { class: 'delta ' + (deltaCls || ''), text: '  ' + deltaTxt }));
  return h('div', { class: 'row' }, kids);
}
// Inline SVG sparkline from a numeric series (safe: coordinates only).
function sparkline(values, w = 260, ht = 34) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', ht); svg.setAttribute('viewBox', `0 0 ${w} ${ht}`);
  const nums = values.map(n).filter((x) => isFinite(x));
  if (nums.length < 2) return svg;
  const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
  const step = w / (nums.length - 1);
  const pts = nums.map((v, i) => `${(i * step).toFixed(1)},${(ht - 2 - ((v - min) / span) * (ht - 4)).toFixed(1)}`).join(' ');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', pts); poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', '#2fb6c4'); poly.setAttribute('stroke-width', '1.6');
  svg.appendChild(poly);
  return svg;
}
function card(title, nodes) {
  return h('div', { class: 'card' }, [h('h2', { text: title }), ...nodes]);
}

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}
const one = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : {});

async function load() {
  $('err').textContent = '';
  try {
    const [overview, daily, aicost, byfn, verify, quality, funnel, health, revenue, events, audit] = await Promise.all([
      rpc('admin_overview'),
      rpc('admin_daily_activity', { p_days: 14 }),
      rpc('admin_ai_cost', { p_days: 14 }),
      rpc('admin_ai_cost_by_fn', { p_days: 14 }),
      rpc('admin_ai_verify', { p_days: 14 }),
      rpc('admin_meal_quality_metrics', { p_days: 14 }),
      rpc('admin_onboarding_funnel', { p_days: 14 }),
      rpc('admin_system_health', { p_days: 7 }),
      rpc('admin_revenue'),
      rpc('admin_event_counts', { p_days: 14 }),
      rpc('admin_recent_audit', { p_limit: 25 }),
    ]);

    const ov = one(overview), q = one(quality), fn = one(funnel), rev = one(revenue), vf = one(verify);
    const dailyRows = daily || [];
    const costRows = aicost || [];
    const cost7 = costRows.slice(0, 7).map((r) => n(r.cost_per_meal_usd)).filter((x) => x > 0);
    const errRows = (events || []).filter((e) => e.name === 'app_error');
    const errToday = errRows.filter((e) => String(e.day).slice(0, 10) === today()).reduce((a, e) => a + n(e.events), 0);
    const err7 = errRows.slice(0, 7);
    const errAvg = err7.length ? err7.reduce((a, e) => a + n(e.events), 0) / err7.length : 0;

    // Assemble the metrics bundle for the pure decision system (coerce every numeric — PostgREST
    // returns `numeric` as strings, which attention.js would otherwise skip).
    const metrics = {
      activeToday: n(ov.active_today),
      activeTodayPrev: n((dailyRows[7] || {}).active_athletes),
      costPerMeal: costRows.length ? n(costRows[0].cost_per_meal_usd) : null,
      costPerMealAvg7: cost7.length ? cost7.reduce((a, b) => a + b, 0) / cost7.length : null,
      calls: costRows.reduce((a, r) => a + n(r.meal_calls), 0),
      medianDelta: q.median_delta == null ? null : n(q.median_delta),
      deltaEvents: n(q.score_delta_events),
      textConflictRate: q.text_conflict_rate == null ? null : n(q.text_conflict_rate),
      verifyFired: n(vf.verify_calls),
      verifyChanged: n(vf.changed),
      funnel: { opens: n(fn.opens), rolePicked: n(fn.roles_picked), goalPicked: n(fn.goals_picked), completed: n(fn.completed) },
      aiOkByFn: (health || []).map((r) => ({ fn: r.fn, okRate: n(r.ok_rate), calls: n(r.calls) })),
      appErrorsToday: errToday,
      appErrors7dAvg: errAvg,
      subs: n(rev.active_subs),
    };

    render(metrics, { ov, dailyRows, costRows, byfn: byfn || [], vf, q, fn, health: health || [], rev, audit: audit || [] });
  } catch (e) {
    $('err').textContent = 'Not authorized or unavailable: ' + e.message;
    $('brief').textContent = '';
    $('attn').textContent = '';
    $('grid').textContent = '';
  }
}

function render(m, d) {
  $('brief').textContent = briefing(m);

  // Attention list
  const attn = $('attn'); attn.textContent = '';
  const flags = evaluateFlags(m);
  if (!flags.length) attn.appendChild(h('li', { class: 'note' }, [h('span', { class: 'lbl', text: 'All clear' }), h('span', { class: 'val', text: 'nothing over threshold' })]));
  for (const f of flags) {
    attn.appendChild(h('li', { class: f.level }, [
      h('span', { class: 'lbl', text: f.label }),
      h('span', { class: 'val', text: f.value }),
      h('span', { class: 'lnk', text: '→ ' + f.link }),
    ]));
  }

  const g = $('grid'); g.textContent = '';
  const dActive = m.activeToday - m.activeTodayPrev;

  // Activity
  g.appendChild(card('Activity / user health', [
    kv('Athletes active today', m.activeToday, dActive >= 0 ? 'up' : 'down', (dActive >= 0 ? '+' : '') + dActive + ' vs wk'),
    kv('Active (7d)', n(d.ov.active_7d)),
    kv('Meal loggers today', n(d.ov.meal_loggers_today)),
    kv('New athletes (7d)', n(d.ov.new_athletes_7d)),
    kv('Total athletes', n(d.ov.total_athletes)),
    sparkline(d.dailyRows.map((r) => n(r.active_athletes)).reverse()),
  ]));

  // Growth funnel
  g.appendChild(card('Growth funnel (14d)', [
    kv('Opens', n(d.fn.opens)),
    kv('Picked a role', n(d.fn.roles_picked)),
    kv('Chose a goal', n(d.fn.goals_picked)),
    kv('Completed', n(d.fn.completed)),
    kv('Age-blocked', n(d.fn.age_blocked)),
  ]));

  // AI cost & margin
  const cpm = m.costPerMeal, avg = m.costPerMealAvg7;
  g.appendChild(card('AI cost & margin', [
    kv('Cost / meal (latest)', usd(cpm)),
    kv('Cost / meal (7d avg)', usd(avg)),
    kv('Meal calls (14d)', m.calls),
    kv('Margin after AI', 'rev − AI cost'),
    sparkline(d.costRows.map((r) => n(r.cost_per_meal_usd)).reverse()),
    ...(d.byfn.length ? [buildTable(['fn', 'model', 'calls', '$'], d.byfn.slice(0, 6).map((r) => [r.fn, r.model, n(r.calls), n(r.cost_usd).toFixed(4)]))] : []),
  ]));

  // AI quality
  g.appendChild(card('AI quality (14d)', [
    kv('Median score delta', d.q.median_delta == null ? '—' : n(d.q.median_delta)),
    kv('Text-conflict rate', d.q.text_conflict_rate == null ? '—' : (n(d.q.text_conflict_rate) * 100).toFixed(1) + '%'),
    kv('Correction rate', d.q.correction_rate == null ? '—' : (n(d.q.correction_rate) * 100).toFixed(1) + '%'),
    kv('Verify calls', n(d.vf.verify_calls)),
    kv('Verify changed-rate', d.vf.changed_rate == null ? '—' : (n(d.vf.changed_rate) * 100).toFixed(1) + '%'),
  ]));

  // Revenue
  g.appendChild(card('Revenue', [
    kv('Active subscriptions', n(d.rev.active_subs)),
    kv('Team', n(d.rev.team_subs)),
    kv('Consumer', n(d.rev.consumer_subs)),
    kv('Seats used', n(d.rev.seats_used)),
    kv('MRR (estimate*)', '$' + n(d.rev.mrr_estimate_usd).toFixed(2)),
  ]));

  // System health
  const healthNodes = d.health.length
    ? [buildTable(['fn', 'calls', 'ok %'], d.health.map((r) => [r.fn, n(r.calls), (n(r.ok_rate) * 100).toFixed(1)]))]
    : [h('div', { class: 'row' }, [h('span', { class: 'k', text: 'No AI calls in window' })])];
  g.appendChild(card('System health (7d)', [
    kv('Client errors today', m.appErrorsToday),
    kv('Errors/day (7d avg)', m.appErrors7dAvg.toFixed(1)),
    ...healthNodes,
  ]));

  // Recent audit
  const auditNodes = d.audit.length
    ? [buildTable(['when', 'action', 'target'], d.audit.slice(0, 10).map((r) => [String(r.created_at).slice(0, 16).replace('T', ' '), r.action, r.target || '']))]
    : [h('div', { class: 'row' }, [h('span', { class: 'k', text: 'No admin actions yet' })])];
  g.appendChild(card('Recent founder actions', auditNodes));

  $('foot').textContent = '*MRR estimate uses placeholder per-tier rates (sync with plans.ts). Evidence links point to the source table/view in Supabase Studio. Read-only dashboard.';
}

function buildTable(headers, rows) {
  const thead = h('tr', null, headers.map((x) => h('th', { text: String(x) })));
  const body = rows.map((r) => h('tr', null, r.map((c) => h('td', { text: String(c) }))));
  return h('table', null, [thead, ...body]);
}

// ---- auth gate ----
async function gate() {
  const { data } = await sb.auth.getSession();
  const signedIn = !!data.session;
  show($('login'), !signedIn);
  show($('app'), signedIn);
  if (signedIn) load();
}
$('signin').onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value, password: $('pw').value });
  if (error) { $('loginerr').textContent = error.message; return; }
  gate();
};
$('signout').onclick = async () => { await sb.auth.signOut(); gate(); };
$('refresh').onclick = () => load();
gate();
