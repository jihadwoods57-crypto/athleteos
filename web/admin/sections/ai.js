// OnStandard — Command Center · AI Operations. Reuses the shipped AI telemetry RPCs (admin_ai_cost,
// admin_ai_cost_by_fn, admin_ai_verify, admin_system_health, admin_meal_quality_metrics) — no new
// instrumentation. Budgets / rate-limits are typed config (Phase 1B), labeled here.
import { rpc, PROJECT_REF } from '../api.js';
import { forecast } from '../attention.js';
import { $, h, num, numN, one, usd4, usd2, pct, ago, card, row, tbl, sparkline, openModal, toast, emptyState } from '../ui.js';

async function load() {
  const g = $('ai-grid'); if (!g) return;
  g.textContent = ''; g.appendChild(emptyState('Loading…'));
  try {
    const [cost, byfn, verify, quality, health] = await Promise.all([
      rpc('admin_ai_cost', { p_days: 14 }), rpc('admin_ai_cost_by_fn', { p_days: 14 }),
      rpc('admin_ai_verify', { p_days: 14 }), rpc('admin_meal_quality_metrics', { p_days: 14 }),
      rpc('admin_system_health', { p_days: 7 }),
    ]);
    const costRows = cost || [], vf = one(verify), q = one(quality);
    const cpm = costRows.length ? numN(costRows[0].cost_per_meal_usd) : null;
    const cost7 = costRows.map((r) => num(r.cost_per_meal_usd)).filter((x) => x > 0).slice(0, 7);
    const avg7 = cost7.length ? cost7.reduce((a, b) => a + b, 0) / cost7.length : null;
    const fc = forecast(costRows.map((r) => num(r.meal_cost_usd)).filter((x) => x >= 0).reverse());

    g.textContent = '';
    g.appendChild(card('Cost / meal', [
      h('div', { class: 'big num sig', text: usd4(cpm) }),
      h('div', { class: 'cap', text: 'latest day' }),
      row('7-day average', usd4(avg7)),
      row('Meal calls · 14d', costRows.reduce((a, r) => a + num(r.meal_calls), 0)),
      row('Projected month-end', fc ? usd2(fc.monthlyProjection) : '—'),
      sparkline(costRows.map((r) => num(r.cost_per_meal_usd)).reverse()),
    ], { text: 'Top spenders →', onclick: openTopSpenders }));

    g.appendChild(card('Spend by function · 14d', (byfn || []).length
      ? [tbl(['fn', 'model', { t: 'calls', num: 1 }, { t: '$', num: 1 }],
          byfn.slice(0, 8).map((r) => [r.fn, r.model, num(r.calls), num(r.cost_usd).toFixed(4)]))]
      : [emptyState('No AI spend in the window.')]));

    g.appendChild(card('Quality · 14d', [
      row('Median score delta', q.median_delta == null ? '—' : num(q.median_delta)),
      row('Text-conflict rate', pct(q.text_conflict_rate)),
      row('Correction rate', pct(q.correction_rate)),
      row('Verify calls', num(vf.verify_calls)),
      row('Verify changed-rate', pct(vf.changed_rate)),
    ]));

    g.appendChild(card('Per-function ok-rate · 7d', (health || []).length
      ? [tbl(['fn', { t: 'calls', num: 1 }, { t: 'ok %', num: 1 }],
          health.map((r) => [r.fn, num(r.calls), (num(r.ok_rate) * 100).toFixed(1)]))]
      : [emptyState('No AI calls in the window.')]));

    g.appendChild(card('Budgets & rate limits', [
      emptyState('Per-user / per-plan rate limits, daily & monthly budgets, and model routing become typed, versioned config in Phase 1B. Emergency shutdown reuses the existing kill-switch (Configuration → Flags).'),
    ]));
  } catch (e) { g.textContent = ''; g.appendChild(emptyState('Error: ' + e.message)); }
}

async function openTopSpenders() {
  openModal('Top AI spenders · 14d', [emptyState('Loading…')]);
  try {
    const rows = await rpc('admin_top_cost_athletes', { p_days: 14, p_limit: 15 });
    if (!(rows || []).length) { openModal('Top AI spenders · 14d', [emptyState('No AI spend in the window yet.')]); return; }
    const t = tbl([{ t: 'athlete', num: 0 }, { t: 'cost', num: 1 }, { t: 'calls', num: 1 }, { t: 'meals', num: 1 }, { t: 'last', num: 0 }],
      rows.map((r) => [String(r.user_id).slice(0, 8) + '…', '$' + num(r.cost_usd).toFixed(4), num(r.calls), num(r.meals), ago(r.last_call)]));
    t.querySelectorAll('tbody tr').forEach((tr, i) => { tr.className = 'click'; tr.addEventListener('click', () => openAthlete(rows[i].user_id)); });
    openModal('Top AI spenders · 14d', [h('p', { class: 'cap', text: 'Click a row for the athlete profile.' }), t]);
  } catch (e) { openModal('Top AI spenders', [emptyState(e.message)]); }
}

async function openAthlete(uid) {
  openModal('Athlete', [emptyState('Loading…')]);
  try {
    const p = one(await rpc('admin_athlete_profile', { p_user: uid }));
    openModal('Athlete profile', [
      row('Name', p.full_name || '—'), row('Role', p.primary_role || '—'),
      row('Meals · total', num(p.meals_total)), row('AI cost · 30d', usd4(p.ai_cost_30d)),
      row('Subscription', `${p.sub_tier || 'none'}${p.sub_status ? ' · ' + p.sub_status : ''}`),
    ]);
  } catch (e) { openModal('Athlete', [emptyState(e.message)]); }
}

function mount(view) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'AI Operations' }), h('span', { class: 'line' })]));
  view.appendChild(h('div', { class: 'grid', id: 'ai-grid' }));
  load();
}

export default { id: 'ai', title: 'AI Operations', rail: 'Money & AI', render(view) { mount(view); }, poll() { load(); } };
