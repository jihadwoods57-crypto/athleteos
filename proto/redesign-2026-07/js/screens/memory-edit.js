/* Memory edit — the ONE manual door into Food Memory (0192). Memory is built passively from
   normal logging; this sheet exists so manual control is always possible, never required:
   add a usual meal/order/supplement by hand, or fix a saved one's name, place, or numbers.
   Route: #memory-edit/new or #memory-edit/<itemId>. */
import { RT, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { foodMemory } from '../food-memory-data.js';

const KINDS = [['meal', 'Meal'], ['order', 'Order'], ['food', 'Food'], ['supplement', 'Supplement']];

function itemFor(sub) {
  if (!sub || sub === 'new') return null;
  const fm = foodMemory(RT.userId);
  return (fm && fm.items.find((x) => x.id === sub)) || null;
}

export default {
  tab: 'plan',
  transient: true,
  hideTabs: true,
  render({ sub }) {
    const it = itemFor(sub);
    const fm = foodMemory(RT.userId);
    const place = it && it.place_id && fm ? (fm.places || []).find((p) => p.id === it.place_id) : null;
    const numField = 'width:100%;height:52px;border-radius:14px;background:var(--surface-1);border:1.5px solid var(--hairline);color:var(--text);font-size:17px;font-weight:800;text-align:center;font-variant-numeric:tabular-nums';
    const textField = 'width:100%;height:52px;border-radius:14px;background:var(--surface-1);border:1.5px solid var(--hairline);color:var(--text);font-size:15px;font-weight:700;padding:0 14px';
    const v = (x) => (x == null ? '' : esc(String(x)));
    return `
    ${backHead(it ? 'Edit saved meal' : 'Save a usual meal', it ? 'Fix the name, place, or numbers' : 'Log it in one tap from Plan', 'plan')}

    <div class="eyebrow">What is it?</div>
    <section class="card pad">
      <div class="bk" style="margin-bottom:6px">Name</div>
      <input id="me-name" type="text" maxlength="120" placeholder="e.g. Usual Subway order" value="${it ? v(it.name) : ''}" style="${textField}" />
      <div class="bk" style="margin:12px 0 6px">Type</div>
      <div class="chip-row" id="me-kind" data-toggle-group>
        ${KINDS.map(([k, l]) => `<span class="chp ${((it && it.kind) || 'meal') === k ? 'on' : ''}" data-k="${k}">${l}</span>`).join('')}
      </div>
      <div class="bk" style="margin:12px 0 6px">Place (optional)</div>
      <input id="me-place" type="text" maxlength="80" placeholder="e.g. Subway, campus dining, home" value="${place ? v(place.name) : ''}" style="${textField}" />
    </section>

    <div class="eyebrow">The numbers</div>
    <section class="card pad">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><div class="bk" style="margin-bottom:6px">Calories</div><input id="me-kcal" type="number" inputmode="numeric" placeholder="0" value="${it ? v(it.kcal) : ''}" style="${numField}" /></div>
        <div><div class="bk" style="margin-bottom:6px">Protein (g)</div><input id="me-p" type="number" inputmode="numeric" placeholder="0" value="${it ? v(it.protein) : ''}" style="${numField};color:var(--green-bright)" /></div>
        <div><div class="bk" style="margin-bottom:6px">Carbs (g)</div><input id="me-c" type="number" inputmode="numeric" placeholder="0" value="${it ? v(it.carbs) : ''}" style="${numField}" /></div>
        <div><div class="bk" style="margin-bottom:6px">Fat (g)</div><input id="me-f" type="number" inputmode="numeric" placeholder="0" value="${it ? v(it.fat) : ''}" style="${numField}" /></div>
      </div>
    </section>

    <div id="me-err" style="color:var(--red-bright);font-size:13px;font-weight:600;min-height:18px;margin-top:12px;text-align:center"></div>
    <button class="btn primary" id="me-save">${icon('check', 19)} ${it ? 'Save changes' : 'Save to Food Memory'}</button>
    ${it ? `<div style="height:8px"></div>
    <button class="btn ghost" id="me-forget" style="color:var(--red-bright);border-color:var(--red-border)">Forget this meal</button>` : ''}
    <div style="height:10px"></div>`;
  },
  async mount(root, { sub }) {
    const { wireToggles } = await import('./settings.js');
    wireToggles(root);
    const it = itemFor(sub);
    let kind = (it && it.kind) || 'meal';
    root.querySelectorAll('#me-kind .chp').forEach((ch) => ch.addEventListener('click', () => { kind = ch.dataset.k || 'meal'; }));
    const err = root.querySelector('#me-err');
    const btn = root.querySelector('#me-save');
    /* Force-refresh the shared cache BEFORE leaving: Plan repaints from the cache on arrival,
       and its once-per-load repaint guard (the freeze fix) will not fire again for data that
       merely changed — so going back with a stale cache would show the pre-edit list. */
    const refreshMemory = async () => {
      const roles = await import('../roles.js');
      const fmd = await import('../food-memory-data.js');
      await fmd.warmFoodMemory(roles, RT.userId, true).catch(() => {});
    };
    if (btn) btn.addEventListener('click', async () => {
      const val = (id) => root.querySelector('#' + id).value;
      const name = String(val('me-name') || '').trim();
      if (!name) { err.textContent = 'Give it a name you’ll recognize.'; return; }
      const p = Math.max(0, parseFloat(val('me-p')) || 0);
      const kcal = Math.max(0, parseFloat(val('me-kcal')) || 0);
      if (p <= 0 && kcal <= 0) { err.textContent = 'Enter at least the calories or protein.'; return; }
      btn.disabled = true; err.textContent = '';
      const ok = await act.saveMemoryForm({
        ...(it ? { id: it.id } : {}),
        name, kind,
        placeName: String(val('me-place') || '').trim() || null,
        protein: p, kcal, carbs: parseFloat(val('me-c')) || 0, fat: parseFloat(val('me-f')) || 0,
      });
      if (!ok) { btn.disabled = false; err.textContent = 'Couldn’t save right now. Check your connection and try again.'; return; }
      await refreshMemory();
      window.__back('plan');
    });
    // Destructive action, separated from Save and behind its own two-tap confirm. "Forget"
    // archives (recoverable), never deletes — the copy stays honest about that scope.
    const forget = root.querySelector('#me-forget');
    if (forget && it) forget.addEventListener('click', async () => {
      if (forget.dataset.armed !== '1') { forget.dataset.armed = '1'; forget.textContent = 'Tap again to forget'; return; }
      forget.disabled = true; err.textContent = '';
      const ok = await act.forgetMemoryItem(it.id);
      if (!ok) { forget.disabled = false; forget.dataset.armed = ''; forget.textContent = 'Forget this meal'; err.textContent = 'Couldn’t forget it right now. Check your connection and try again.'; return; }
      await refreshMemory();
      window.__back('plan');
    });
  },
};
