// OnStandard — Command Center · Bugs & Incidents (Phase 1A slice). Client app_error trend (from
// admin_event_counts) + per-function AI ok-rate (admin_system_health). HONEST LIMITATION, labeled
// prominently: native RN crashes are NOT captured (no Sentry/Crashlytics; ErrorBoundary reports nothing;
// app_error is anonymous with no stack/device). Full incident lifecycle + native crash reporting = Phase 2.
import { rpc, PROJECT_REF } from '../api.js';
import { $, h, num, card, row, tbl, sparkline, toast, todayStr, emptyState } from '../ui.js';

const studioSql = () => `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`;
const ERR_QUERY = "select session_id, props, created_at from analytics_events where name='app_error' order by created_at desc limit 100;";

async function load() {
  const g = $('err-grid'); if (!g) return;
  g.textContent = ''; g.appendChild(emptyState('Loading…'));
  try {
    const [events, health] = await Promise.all([
      rpc('admin_event_counts', { p_days: 14 }), rpc('admin_system_health', { p_days: 7 }),
    ]);
    const errRows = (events || []).filter((e) => e.name === 'app_error');
    const tdy = todayStr();
    const errToday = errRows.filter((e) => String(e.day).slice(0, 10) === tdy).reduce((a, e) => a + num(e.events), 0);
    const err7 = errRows.slice(0, 7);
    const errAvg = err7.length ? err7.reduce((a, e) => a + num(e.events), 0) / err7.length : 0;

    g.textContent = '';
    const evidence = h('button', {
      class: 'btn sm ghost', text: 'Evidence',
      onclick: async () => { try { await navigator.clipboard.writeText(ERR_QUERY); toast('Query copied — paste in Studio SQL editor'); } catch { toast('Run in Studio: ' + ERR_QUERY); } window.open(studioSql(), '_blank', 'noopener'); },
    });
    const clientCard = card('Client errors (app_error)', [
      h('div', { class: 'big num', text: String(errToday) }),
      h('div', { class: 'cap', text: 'client errors today' }),
      row('Errors/day · 7d avg', errAvg.toFixed(1)),
      sparkline(errRows.map((e) => num(e.events)).reverse()),
    ]);
    clientCard.querySelector('.hd').appendChild(evidence);
    g.appendChild(clientCard);

    g.appendChild(card('AI function health · 7d', (health || []).length
      ? [tbl(['fn', { t: 'calls', num: 1 }, { t: 'ok %', num: 1 }],
          health.map((r) => [r.fn, num(r.calls), (num(r.ok_rate) * 100).toFixed(1)]))]
      : [emptyState('No AI calls in the window.')]));

    const gap = card('Native crash coverage', [
      emptyState('Native app crashes are NOT captured. There is no Sentry/Crashlytics; the RN ErrorBoundary reports nothing; app_error is anonymous with no stack, device, or user. This view UNDERSTATES real crash volume — native crash reporting + full incident lifecycle land in Phase 2.'),
    ]);
    gap.querySelector('.hd h3').textContent = 'Native crash coverage — incomplete';
    g.appendChild(gap);
  } catch (e) { g.textContent = ''; g.appendChild(emptyState('Error: ' + e.message)); }
}

function mount(view) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'Bugs & Incidents' }), h('span', { class: 'line' })]));
  view.appendChild(h('div', { class: 'grid', id: 'err-grid' }));
  load();
}

export default { id: 'errors', title: 'Bugs & Incidents', rail: 'Ops', render(view) { mount(view); }, poll() { load(); } };
