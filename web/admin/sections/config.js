// OnStandard — Command Center · Configuration. Three separated controls (correction #6): typed
// operational CONFIG (budgets/limits/thresholds — versioned + audited), the OnStandard Pay platform FEE
// (reuses pay_platform_config), and FEATURE FLAGS (availability/rollout/kill-switch — folded in from the
// standalone flags.html into the shell's token vocabulary). Every write is behind step-up reauth.
import { rpc } from '../api.js';
import { $, h, card, toast, emptyState, withReauth } from '../ui.js';

async function load() {
  const g = $('config-grid'); if (!g) return;
  g.textContent = ''; g.appendChild(emptyState('Loading…'));
  try {
    const [cfg, fee, flags] = await Promise.all([
      rpc('admin_get_config'),
      rpc('admin_get_platform_fee').catch(() => null),
      rpc('admin_list_flags').catch(() => []),
    ]);
    g.textContent = '';
    g.appendChild(renderConfigCard(cfg || []));
    g.appendChild(renderFeeCard(fee));
    g.appendChild(renderFlagsCard(flags || []));
  } catch (e) { g.textContent = ''; g.appendChild(emptyState('Error: ' + e.message)); }
}

function renderConfigCard(cfg) {
  const nodes = [h('p', { class: 'cap', text: 'Budgets, limits, thresholds — typed, versioned, audited. Not feature flags.' })];
  for (const c of cfg) {
    const input = h('input', { type: c.value_type === 'number' ? 'number' : 'text', style: 'max-width:150px' });
    input.value = String(c.value);
    const saveBtn = h('button', { class: 'btn sm', text: 'Save', onclick: () => {
      const v = c.value_type === 'number' ? Number(input.value)
        : c.value_type === 'boolean' ? (input.value === 'true') : input.value;
      withReauth('config', async () => {
        try { await rpc('admin_set_config', { p_key: c.key, p_value: v }); toast(`${c.key} saved · version bumped · audited`); load(); }
        catch (e) { toast('Failed: ' + e.message, true); }
      });
    } });
    nodes.push(h('div', { class: 'row' }, [
      h('span', { class: 'k', text: c.key, title: c.description }),
      h('span', { class: 'v', style: 'display:flex; gap:6px; align-items:center' }, [input, saveBtn, h('span', { class: 'cap', text: 'v' + c.version })]),
    ]));
  }
  return card('Operational config', nodes);
}

function renderFeeCard(fee) {
  if (fee == null) return card('OnStandard Pay — platform fee', [emptyState('Pay fee config unavailable (deploy OnStandard Pay).')]);
  const input = h('input', { type: 'number', style: 'max-width:100px' }); input.value = String(fee);
  const save = h('button', { class: 'btn sm', text: 'Save', onclick: () => withReauth('config', async () => {
    try { await rpc('admin_set_platform_fee', { p_fee_percent: Number(input.value) }); toast('Platform fee updated · audited'); load(); }
    catch (e) { toast('Failed: ' + e.message, true); }
  }) });
  return card('OnStandard Pay — platform fee', [
    h('p', { class: 'cap', text: 'The % OnStandard takes from each trainer→client payment (reuses pay_platform_config).' }),
    h('div', { class: 'row' }, [h('span', { class: 'k', text: 'Fee %' }), h('span', { class: 'v', style: 'display:flex; gap:6px' }, [input, save])]),
  ]);
}

function renderFlagsCard(flags) {
  const nodes = [h('p', { class: 'cap', text: 'Feature availability, rollout, kill-switches. Not operational config.' })];
  if (!flags.length) nodes.push(emptyState('No flags.'));
  for (const f of flags) {
    const onBtn = h('button', { class: 'btn sm' + (f.default_on ? ' pri' : ''), text: f.default_on ? 'on' : 'off', onclick: () => setFlag(f, { default_on: !f.default_on }) });
    const killBtn = h('button', { class: 'btn sm ghost', text: f.kill_switch ? 'KILLED' : 'kill', onclick: () => setFlag(f, { kill_switch: !f.kill_switch }) });
    if (f.kill_switch) { killBtn.style.borderColor = 'var(--warn)'; killBtn.style.color = 'var(--warn)'; }
    nodes.push(h('div', { class: 'row' }, [
      h('span', { class: 'k', text: f.name, title: f.description }),
      h('span', { class: 'v', style: 'display:flex; gap:6px' }, [onBtn, killBtn]),
    ]));
  }
  return card('Feature flags', nodes);
}

function setFlag(f, patch) {
  withReauth('config', async () => {
    try {
      await rpc('admin_set_flag', {
        p_name: f.name, p_description: f.description || '',
        p_default_on: patch.default_on != null ? patch.default_on : f.default_on,
        p_kill_switch: patch.kill_switch != null ? patch.kill_switch : f.kill_switch,
        p_enabled_user_ids: f.enabled_user_ids || [], p_enabled_roles: f.enabled_roles || [], p_enabled_org_ids: f.enabled_org_ids || [],
      });
      toast(`${f.name} updated · audited`); load();
    } catch (e) { toast('Failed: ' + e.message, true); }
  });
}

function mount(view) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'Configuration' }), h('span', { class: 'line' })]));
  view.appendChild(h('div', { class: 'grid', id: 'config-grid' }));
  load();
}

export default { id: 'config', title: 'Configuration', rail: 'Trust', render(view) { mount(view); } };
