// OnStandard — Command Center · Home section. The original single-page dashboard, relocated verbatim
// into a section module: briefing hero + "since your last visit" movers + the actionable attention
// queue + the business panel grid + drill-downs + "Ask the business". Behavior is unchanged from the
// shipped v2 dashboard; only the markup is now built into the section's #view container by render().
import { evaluateFlags, briefing, movers, forecast } from '../attention.js';
import { rpc, PROJECT_REF } from '../api.js';
import {
  $, num, numN, one, usd4, usd2, pct, ago, todayStr,
  h, toast, sparkline, row, card, deltaOf, tbl, openModal, closeModal,
} from '../ui.js';

// ---------- data ----------
const STATE = { bundle: null, prev: null, attn: {}, days: 14 };

async function loadAll(opts = {}) {
  if (!opts.silent) { const e = $('err'); if (e) e.textContent = ''; }
  try {
    const D = STATE.days;
    const [overview, daily, aicost, byfn, verify, quality, funnel, health, revenue, events, audit, attnState, snaps] = await Promise.all([
      rpc('admin_overview'), rpc('admin_daily_activity', { p_days: D }), rpc('admin_ai_cost', { p_days: D }),
      rpc('admin_ai_cost_by_fn', { p_days: D }), rpc('admin_ai_verify', { p_days: D }), rpc('admin_meal_quality_metrics', { p_days: D }),
      rpc('admin_onboarding_funnel', { p_days: D }), rpc('admin_system_health', { p_days: 7 }), rpc('admin_revenue'),
      rpc('admin_event_counts', { p_days: D }), rpc('admin_recent_audit', { p_limit: 12 }),
      rpc('admin_list_attention_state'), rpc('admin_list_brief_snapshots', { p_limit: 40 }),
    ]);

    const ov = one(overview), q = one(quality), fn = one(funnel), rev = one(revenue), vf = one(verify);
    const dailyRows = daily || [], costRows = aicost || [];
    const tdy = todayStr();
    const costAll = costRows.map((r) => num(r.cost_per_meal_usd)).filter((x) => x > 0);
    const cost7 = costAll.slice(0, 7);
    const errRows = (events || []).filter((e) => e.name === 'app_error');
    const errToday = errRows.filter((e) => String(e.day).slice(0, 10) === tdy).reduce((a, e) => a + num(e.events), 0);
    const err7 = errRows.slice(0, 7);
    const errAvg = err7.length ? err7.reduce((a, e) => a + num(e.events), 0) / err7.length : 0;

    const bundle = {
      activeToday: num(ov.active_today),
      activeTodayPrev: num((dailyRows[7] || {}).active_athletes),
      costPerMeal: costRows.length ? numN(costRows[0].cost_per_meal_usd) : null,
      costPerMealAvg7: cost7.length ? cost7.reduce((a, b) => a + b, 0) / cost7.length : null,
      calls: costRows.reduce((a, r) => a + num(r.meal_calls), 0),
      medianDelta: q.median_delta == null ? null : num(q.median_delta),
      deltaEvents: num(q.score_delta_events),
      textConflictRate: q.text_conflict_rate == null ? null : num(q.text_conflict_rate),
      verifyFired: num(vf.verify_calls), verifyChanged: num(vf.changed),
      funnel: { opens: num(fn.opens), rolePicked: num(fn.roles_picked), goalPicked: num(fn.goals_picked), completed: num(fn.completed) },
      aiOkByFn: (health || []).map((r) => ({ fn: r.fn, okRate: num(r.ok_rate), calls: num(r.calls) })),
      appErrorsToday: errToday, appErrors7dAvg: errAvg, subs: num(rev.active_subs),
      // PRIOR-days baselines (exclude today) for anomaly z-scores
      costSeries: costRows.filter((r) => String(r.day).slice(0, 10) !== tdy).map((r) => num(r.cost_per_meal_usd)).filter((x) => x > 0),
      activeSeries: dailyRows.filter((r) => String(r.day).slice(0, 10) !== tdy).map((r) => num(r.active_athletes)),
      errorSeries: errRows.filter((e) => String(e.day).slice(0, 10) !== tdy).map((e) => num(e.events)),
    };
    STATE.bundle = bundle;
    STATE._costTotals = costRows.map((r) => num(r.meal_cost_usd)).filter((x) => x >= 0).reverse();
    STATE.attn = {}; for (const s of (attnState || [])) STATE.attn[s.flag_key] = s;

    // "Since your last visit" — the most recent snapshot that existed before this load.
    const snapshots = snaps || [];
    STATE.prev = snapshots[0] || null;

    const flags = evaluateFlags(bundle);
    const warnCount = flags.filter((f) => f.level === 'warn').length;
    const noteCount = flags.filter((f) => f.level === 'note').length;

    paint(bundle, {
      ov, dailyRows, costRows, byfn: byfn || [], vf, q, fn, health: health || [], rev,
      audit: audit || [], snapshots, flags, tdy,
    });
    notify(flags);

    // Throttled snapshot: only anchor a new baseline if the last is >25m old, so rapid refreshes
    // don't reset the "since last visit" window.
    if (!STATE.prev || (Date.now() - new Date(STATE.prev.created_at).getTime()) > 25 * 60 * 1000) {
      const scalars = { activeToday: bundle.activeToday, costPerMeal: bundle.costPerMeal, calls: bundle.calls, subs: bundle.subs, appErrorsToday: bundle.appErrorsToday, medianDelta: bundle.medianDelta };
      rpc('admin_save_brief_snapshot', {
        p_warn: warnCount, p_note: noteCount, p_active: bundle.activeToday,
        p_cpm: bundle.costPerMeal, p_meals: num(ov.meal_loggers_today), p_subs: bundle.subs, p_metrics: scalars,
      }).catch(() => {});
    }
    const st = $('stamp'); if (st) { st.textContent = ''; st.appendChild(h('span', {}, ['updated ', h('b', { text: 'now' })])); }
  } catch (e) {
    if (!opts.silent) { const el = $('err'); if (el) el.textContent = 'Not authorized or unavailable: ' + e.message; }
  }
}

// ---------- render ----------
function paint(m, d) {
  // Briefing (bold the leading count for signature emphasis)
  const bText = briefing(m);
  const brief = $('brief'); brief.textContent = '';
  const mBold = bText.match(/^(\d+)( athletes.*)$/);
  if (mBold) { brief.appendChild(h('b', { text: mBold[1] })); brief.appendChild(document.createTextNode(mBold[2])); }
  else brief.textContent = bText;

  // Since last visit + movers
  const since = $('since'); since.textContent = '';
  const moversEl = $('movers'); moversEl.textContent = '';
  if (STATE.prev) {
    const prevMetrics = STATE.prev && STATE.prev.metrics ? STATE.prev.metrics
      : STATE.prev ? { activeToday: STATE.prev.active_today, costPerMeal: STATE.prev.cost_per_meal, subs: STATE.prev.subs } : null;
    since.appendChild(h('span', { text: `since your last look · ${ago(STATE.prev.created_at)}` }));
    const mv = movers(m, prevMetrics || {}).slice(0, 5);
    for (const x of mv) {
      const cls = `chip ${x.dir}-${x.good ? 'good' : 'bad'}`;
      moversEl.appendChild(h('span', { class: cls }, [
        h('span', { text: x.label }),
        h('span', { class: 'arw', text: x.dir === 'up' ? '▲' : '▼' }),
        h('span', { class: 'mv', text: `${x.from}→${x.to}` }),
      ]));
    }
    if (!mv.length) moversEl.appendChild(h('span', { class: 'chip', text: 'no material change' }));
  } else {
    since.appendChild(h('span', { text: 'first look — a baseline is being recorded for next time' }));
  }

  renderAttention(d.flags);
  renderPanels(m, d);

  $('foot').textContent = 'Estimated subscription value is from plan prices, not collected revenue. Evidence buttons copy a ready-to-run query and open Supabase Studio. Attention items you resolve/snooze are audited. A daily cron snapshot keeps the trend complete even when you don\'t visit.';
}

function studioSqlUrl() { return `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`; }
function linkToSql(link) {
  if (!link) return null;
  if (link === 'ai_call_costs') return 'select fn, model, user_id, cost_usd, created_at from ai_call_costs order by created_at desc limit 50;';
  if (link === 'ai_verify_effectiveness') return 'select * from ai_verify_effectiveness order by day desc limit 30;';
  if (link === 'admin_onboarding_funnel') return 'select * from admin_onboarding_funnel(14);';
  if (link === 'admin_daily_activity') return 'select * from admin_daily_activity(14);';
  const ev = link.match(/^analytics_events\?name=(.+)$/);
  if (ev) return `select session_id, props, created_at from analytics_events where name='${ev[1]}' order by created_at desc limit 50;`;
  const ai = link.match(/^ai_calls\?fn=(.+)$/);
  if (ai) return `select fn, mode, error_code, created_at from ai_calls where fn='${ai[1]}' and ok=false order by created_at desc limit 50;`;
  return `-- ${link}`;
}

function renderAttention(flags) {
  const el = $('attn'); el.textContent = '';
  const active = [], handled = [];
  for (const f of flags) {
    const st = STATE.attn[f.key];
    const isSnoozed = st && st.status === 'snoozed' && st.snoozed_until && new Date(st.snoozed_until) > new Date();
    const isResolved = st && st.status === 'resolved';
    (isSnoozed || isResolved ? handled : active).push({ f, st, isSnoozed, isResolved });
  }
  $('attn-count').textContent = String(active.length);

  if (!active.length) {
    el.appendChild(h('div', { class: 'allclear' }, [h('span', { text: '✓' }), h('span', { text: handled.length ? 'All clear — nothing over threshold (handled items below).' : 'All clear — nothing over threshold.' })]));
  }
  for (const { f } of active) el.appendChild(attnItem(f, false));
  if (handled.length) {
    el.appendChild(h('div', { class: 'sec-h', style: 'margin:14px 2px 8px' }, [h('h2', { text: 'Handled' }), h('span', { class: 'line' })]));
    for (const { f, st, isSnoozed } of handled) el.appendChild(attnItem(f, true, st, isSnoozed));
  }
}

function attnItem(f, handled, st, isSnoozed) {
  const acts = h('div', { class: 'acts' });
  const sql = linkToSql(f.link);
  if (sql) acts.appendChild(h('button', {
    class: 'btn sm ghost', text: 'Evidence', title: 'Copy query + open Studio',
    onclick: async () => { try { await navigator.clipboard.writeText(sql); toast('Query copied — paste in Studio SQL editor'); } catch { toast('Open Studio and run: ' + sql); } window.open(studioSqlUrl(), '_blank', 'noopener'); },
  }));
  if (!handled) {
    acts.appendChild(h('button', { class: 'btn sm', text: 'Snooze 3d', onclick: () => setAttn(f.key, 'snoozed', 3) }));
    acts.appendChild(h('button', { class: 'btn sm pri', text: 'Resolve', onclick: () => setAttn(f.key, 'resolved', 0) }));
  } else {
    acts.appendChild(h('button', { class: 'btn sm', text: 'Reopen', onclick: () => setAttn(f.key, 'open', 0) }));
  }
  const lbl = h('div', { class: 'lbl' }, [f.label]);
  if (f.sigma != null && !handled) lbl.appendChild(h('span', { class: 'sigma', text: `${f.sigma > 0 ? '+' : ''}${f.sigma}σ` }));
  const valTxt = handled ? `${f.value}${isSnoozed && st.snoozed_until ? ` · snoozed till ${new Date(st.snoozed_until).toLocaleDateString()}` : ' · resolved'}` : f.value;
  return h('div', { class: `item ${f.level}${handled ? ' handled' : ''}` }, [
    h('div', { class: 'dot' }), h('div', { class: 'body' }, [lbl, h('div', { class: 'val', text: valTxt })]), acts,
  ]);
}

async function setAttn(key, status, days) {
  try {
    await rpc('admin_set_attention_state', { p_flag_key: key, p_status: status, p_snooze_days: days || 0, p_note: null });
    toast(status === 'resolved' ? 'Resolved · audited' : status === 'snoozed' ? `Snoozed ${days}d · audited` : 'Reopened');
    await loadAll({ silent: true });
  } catch (e) { toast('Action failed: ' + e.message, true); }
}

function renderPanels(m, d) {
  const g = $('grid'); g.textContent = '';
  const prev = STATE.prev && STATE.prev.metrics ? STATE.prev.metrics : {};

  // Activity
  g.appendChild(card('Activity', [
    h('div', { class: 'big num', text: String(m.activeToday) }),
    h('div', { class: 'cap', text: 'athletes active today' }),
    row('Active · 7d', num(d.ov.active_7d)),
    row('Meal loggers today', num(d.ov.meal_loggers_today)),
    row('New athletes · 7d', num(d.ov.new_athletes_7d)),
    row('Total athletes', num(d.ov.total_athletes)),
    sparkline(d.dailyRows.map((r) => num(r.active_athletes)).reverse()),
  ]));

  // Growth funnel with conversions
  const opens = num(d.fn.opens), rp = num(d.fn.roles_picked), gp = num(d.fn.goals_picked), cp = num(d.fn.completed);
  const conv = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
  g.appendChild(card('Growth funnel · 14d', [
    row('Opens', opens),
    row('Picked a role', `${rp}`), h('div', { class: 'cap', text: `role→goal ${conv(gp, rp)} · goal→done ${conv(cp, gp)}` }),
    row('Chose a goal', gp),
    row('Completed', cp),
    row('Age-blocked', num(d.fn.age_blocked)),
  ]));

  // AI cost + forecast + drill-down
  const fc = forecast(d.costRows.map((r) => num(r.meal_cost_usd)).filter((x) => x >= 0).reverse());
  g.appendChild(card('AI cost & margin', [
    h('div', { class: 'big num sig', text: usd4(m.costPerMeal) }),
    h('div', { class: 'cap', text: 'cost / meal · latest day' }),
    row('7-day average', usd4(m.costPerMealAvg7)),
    row('Meal calls · 14d', m.calls),
    row('Projected month-end', fc ? usd2(fc.monthlyProjection) : '—'),
    sparkline(d.costRows.map((r) => num(r.cost_per_meal_usd)).reverse()),
    ...(d.byfn.length ? [tbl(['fn', 'model', { t: 'calls', num: 1 }, { t: '$', num: 1 }],
      d.byfn.slice(0, 6).map((r) => [r.fn, r.model, num(r.calls), num(r.cost_usd).toFixed(4)]))] : []),
  ], { text: 'Top spenders →', onclick: openTopSpenders }));

  // AI quality
  g.appendChild(card('AI quality · 14d', [
    row('Median score delta', d.q.median_delta == null ? '—' : num(d.q.median_delta)),
    row('Text-conflict rate', pct(d.q.text_conflict_rate)),
    row('Correction rate', pct(d.q.correction_rate)),
    row('Verify calls', num(d.vf.verify_calls)),
    row('Verify changed-rate', pct(d.vf.changed_rate)),
  ]));

  // Revenue (estimated subscription value — from plan prices, not collected revenue)
  g.appendChild(card('Revenue', [
    h('div', { class: 'big num sig', text: usd2(num(d.rev.estimated_subscription_value_usd)) }),
    h('div', { class: 'cap', text: 'est. subscription value · from plan prices' }),
    row('Active subscriptions', num(d.rev.active_subs), deltaOf(num(d.rev.active_subs), numN(prev.subs), true)),
    row('Team', num(d.rev.team_subs)),
    row('Consumer', num(d.rev.consumer_subs)),
    row('Seats used', num(d.rev.seats_used)),
  ]));

  // System health
  const healthNodes = d.health.length
    ? [tbl(['fn', { t: 'calls', num: 1 }, { t: 'ok %', num: 1 }], d.health.map((r) => [r.fn, num(r.calls), (num(r.ok_rate) * 100).toFixed(1)]))]
    : [h('div', { class: 'empty', text: 'No AI calls in the window.' })];
  g.appendChild(card('System health · 7d', [
    row('Client errors today', m.appErrorsToday, deltaOf(m.appErrorsToday, numN(prev.appErrorsToday), false)),
    row('Errors/day · 7d avg', m.appErrors7dAvg.toFixed(1)),
    ...healthNodes,
  ]));

  // Pulse (snapshot heartbeat)
  const snapAsc = [...d.snapshots].reverse();
  g.appendChild(card('Pulse · snapshots', [
    h('div', { class: 'cap', text: `${d.snapshots.length} snapshots · active-athletes trend` }),
    sparkline(snapAsc.map((s) => num(s.active_today))),
    h('div', { class: 'cap', style: 'margin-top:10px', text: 'attention items over time' }),
    sparkline(snapAsc.map((s) => num(s.warn_count))),
  ]));

  // Recent founder actions
  const auditNodes = d.audit.length
    ? [tbl(['when', 'action', 'target'], d.audit.slice(0, 8).map((r) => [ago(r.created_at), String(r.action), String(r.target || '').slice(0, 20)]))]
    : [h('div', { class: 'empty', text: 'No founder actions yet.' })];
  g.appendChild(card('Recent founder actions', auditNodes));
}

// ---------- drill-down modals ----------
async function openTopSpenders() {
  openModal('Top AI spenders · 14d', [h('div', { class: 'empty', text: 'Loading…' })]);
  try {
    const rows = await rpc('admin_top_cost_athletes', { p_days: 14, p_limit: 15 });
    const body = (rows || []).length
      ? [tbl([{ t: 'athlete', num: 0 }, { t: 'cost', num: 1 }, { t: 'calls', num: 1 }, { t: 'meals', num: 1 }, { t: 'last', num: 0 }],
          rows.map((r) => [String(r.user_id).slice(0, 8) + '…', '$' + num(r.cost_usd).toFixed(4), num(r.calls), num(r.meals), ago(r.last_call)]))]
      : [h('div', { class: 'empty', text: 'No AI spend in the window yet.' })];
    if ((rows || []).length) {
      const t = body[0].querySelector('tbody');
      Array.from(t.children).forEach((tr, i) => { tr.className = 'click'; tr.addEventListener('click', () => openAthlete(rows[i].user_id)); });
    }
    openModal('Top AI spenders · 14d', [h('p', { class: 'cap', text: 'Click a row for the athlete profile.' }), ...body]);
  } catch (e) { openModal('Top AI spenders', [h('div', { class: 'err', text: e.message })]); }
}

async function openAthlete(uid) {
  openModal('Athlete', [h('div', { class: 'empty', text: 'Loading…' })]);
  try {
    const p = one(await rpc('admin_athlete_profile', { p_user: uid }));
    const rows = [
      row('Name', p.full_name || '—'), row('Email', p.email || '—'), row('Role', p.primary_role || '—'),
      row('Joined', p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'),
      row('Last active', p.last_active ? String(p.last_active) : '—'),
      row('Meals · total', num(p.meals_total)), row('Meals · 7d', num(p.meals_7d)),
      row('AI cost · 30d', usd4(p.ai_cost_30d)),
      row('Subscription', `${p.sub_tier || 'none'}${p.sub_status ? ' · ' + p.sub_status : ''}`),
    ];
    const tagBtn = h('button', { class: 'btn', text: 'Tag for review', onclick: async () => {
      try { await rpc('admin_tag_user_for_review', { p_user: uid, p_note: 'flagged from command center' }); toast('Tagged for review · audited'); }
      catch (e) { toast('Failed: ' + e.message, true); }
    } });
    openModal('Athlete profile', [...rows, h('div', { style: 'height:14px' }), tagBtn]);
  } catch (e) { openModal('Athlete', [h('div', { class: 'err', text: e.message })]); }
}

// ---------- ask the business ----------
function openAsk() {
  const b = STATE.bundle; if (!b) { toast('Load the dashboard first'); return; }
  const answers = {
    'How many active today vs last week?': () => `${b.activeToday} active today (${b.activeToday - b.activeTodayPrev >= 0 ? '+' : ''}${b.activeToday - b.activeTodayPrev} vs last week).`,
    "What'll AI cost me this month?": () => { const f = forecast((STATE._costTotals || [])); return f ? `~${usd2(f.monthlyProjection)} projected at the current run-rate (${usd2(f.dailyRunRate)}/day).` : 'Not enough AI cost data yet.'; },
    'Where is onboarding leaking?': () => { const f = b.funnel; const rg = f.rolePicked ? f.goalPicked / f.rolePicked : 1, gc = f.goalPicked ? f.completed / f.goalPicked : 1; return rg < gc ? `Worst at role→goal: ${Math.round(rg * 100)}% continue.` : `Worst at goal→complete: ${Math.round(gc * 100)}% finish.`; },
    'Anything erroring?': () => { const bad = (b.aiOkByFn || []).filter((r) => r.okRate < 1 && r.calls >= 5).sort((x, y) => x.okRate - y.okRate)[0]; return bad ? `${bad.fn} at ${(bad.okRate * 100).toFixed(1)}% ok over ${bad.calls} calls.` : `No AI function under 100% ok. Client errors today: ${b.appErrorsToday}.`; },
    'What needs attention right now?': () => { const fl = evaluateFlags(b); return fl.length ? fl.map((f) => `• ${f.label} (${f.value})`).join('\n') : 'Nothing over threshold.'; },
    'Who is my most expensive athlete?': null, // async → drill-down
  };
  const list = h('div', {});
  const answer = h('div', { class: 'cap', style: 'white-space:pre-wrap; margin-top:14px; font-size:14px; color:var(--ink)' });
  const filter = h('input', { type: 'text', placeholder: 'Ask about the business…', oninput: () => renderAsk() });
  function renderAsk() {
    list.textContent = '';
    const q = filter.value.toLowerCase();
    for (const key of Object.keys(answers)) {
      if (q && !key.toLowerCase().includes(q)) continue;
      list.appendChild(h('button', { class: 'btn ghost', style: 'width:100%; justify-content:flex-start; margin:5px 0; text-align:left', text: key, onclick: async () => {
        if (key === 'Who is my most expensive athlete?') { closeModal(); return openTopSpenders(); }
        answer.textContent = answers[key]();
      } }));
    }
  }
  renderAsk();
  openModal('Ask the business', [h('p', { class: 'cap', text: 'Deterministic answers from your live data — no AI guessing.' }), filter, h('div', { style: 'height:8px' }), list, answer]);
}

// ---------- notifications ----------
function notify(flags) {
  const warns = flags.filter((f) => f.level === 'warn');
  const keySet = new Set(warns.map((f) => f.key));
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem('cc.seenWarns') || '[]'); } catch {}
  const fresh = warns.filter((f) => !seen.includes(f.key));
  localStorage.setItem('cc.seenWarns', JSON.stringify([...keySet]));
  if (!fresh.length) return;
  if ('Notification' in window) {
    if (Notification.permission === 'granted') fireNote(fresh);
    else if (Notification.permission === 'default') Notification.requestPermission().then((p) => { if (p === 'granted') fireNote(fresh); });
  }
}
function fireNote(fresh) {
  try {
    const title = fresh.length === 1 ? 'Command Center · attention' : `Command Center · ${fresh.length} new alerts`;
    const body = fresh.map((f) => `${f.label}: ${f.value}`).join('\n');
    new Notification(title, { body, tag: 'onstandard-cc', icon: '' });
  } catch {}
}

// ---------- section markup ----------
function mount(view) {
  view.appendChild(h('p', { id: 'err', class: 'err' }));
  view.appendChild(h('section', { class: 'hero' }, [h('div', { class: 'inner' }, [
    h('div', { class: 'lead', id: 'brief' }, [h('span', { class: 'sk', style: 'display:inline-block;width:70%;height:19px' })]),
    h('div', { class: 'since', id: 'since' }),
    h('div', { class: 'movers', id: 'movers' }),
  ])]));
  view.appendChild(h('div', { class: 'sec-h' }, [
    h('h2', { text: 'Needs attention' }), h('span', { class: 'count', id: 'attn-count', text: '—' }),
    h('span', { class: 'line' }),
    h('button', { class: 'btn ghost sm', text: 'Ask the business', onclick: openAsk }),
  ]));
  view.appendChild(h('div', { class: 'attn', id: 'attn' }));
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'The business' }), h('span', { class: 'line' })]));
  view.appendChild(h('div', { class: 'grid', id: 'grid' }));
  view.appendChild(h('p', { class: 'foot', id: 'foot' }));
}

export default {
  id: 'home', title: 'Home', rail: 'Overview',
  render(view) { mount(view); loadAll(); },
  poll() { loadAll({ silent: true }); },
};
