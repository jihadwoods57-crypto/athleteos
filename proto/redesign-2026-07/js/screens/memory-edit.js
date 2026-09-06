/* Memory edit — the ONE manual door into Food Memory (0192). Memory is built passively from
   normal logging; this sheet exists so manual control is always possible, never required:
   add a usual meal/order/supplement by hand, or fix a saved one's name, place, or numbers.
   Route: #memory-edit/new or #memory-edit/<itemId>. */
import { RT, S, act } from '../state.js';
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
    // INTUITIVE (0142): opening a saved meal must not read its stored calories back to the
    // athlete — every other surface hides these numbers, and this pre-filled form was the last
    // one that didn't. Per FIELD: the macro inputs ride showMacros, the calorie input rides
    // showCalories (a professional can hide calories alone). Editing without a field keeps
    // that stored number exactly as it is (mount sends it through untouched). A NEW manual
    // save still shows every field on every style: those numbers come off a label or menu the
    // athlete is holding — the one typed fallback the red line allows — and an item with no
    // numbers at all can't score fueling.
    const showMacroFields = S.planStyle.showMacros || !it;
    const showKcalField = S.planStyle.showCalories || !it;
    const showNums = showMacroFields || showKcalField;
    const fm = foodMemory(RT.userId);
    const place = it && it.place_id && fm ? (fm.places || []).find((p) => p.id === it.place_id) : null;
    const numField = 'width:100%;height:52px;border-radius:var(--r-card-sm);background:var(--surface-1);border:1.5px solid var(--hairline);color:var(--text);font-size:17px;font-weight:800;text-align:center;font-variant-numeric:tabular-nums';
    const textField = 'width:100%;height:52px;border-radius:var(--r-card-sm);background:var(--surface-1);border:1.5px solid var(--hairline);color:var(--text);font-size:15px;font-weight:700;padding:0 14px';
    const v = (x) => (x == null ? '' : esc(String(x)));
    return `
    ${backHead(it ? 'Edit saved meal' : 'Save a usual meal', it ? (showNums ? 'Fix the name, place, or numbers' : 'Fix the name or place') : 'Log it in one tap from Plan', 'plan')}

    <h2 class="eyebrow">What is it?</h2>
    <section class="card pad">
      <label class="bk" for="me-name" style="display:block;margin-bottom:6px">Name</label>
      <input id="me-name" type="text" maxlength="120" placeholder="e.g. Usual Subway order" value="${it ? v(it.name) : ''}" style="${textField}" />
      <div class="bk" id="me-kind-l" style="margin:12px 0 6px">Type</div>
      <div class="chip-row" id="me-kind" data-toggle-group aria-labelledby="me-kind-l">
        ${KINDS.map(([k, l]) => `<span class="chip ${((it && it.kind) || 'meal') === k ? 'on' : ''}" data-k="${k}">${l}</span>`).join('')}
      </div>
      <label class="bk" for="me-place" style="display:block;margin:12px 0 6px">Place (optional)</label>
      <input id="me-place" type="text" maxlength="80" placeholder="e.g. Subway, campus dining, home" value="${place ? v(place.name) : ''}" style="${textField}" />
    </section>

    ${showNums ? `<h2 class="eyebrow">The numbers</h2>
    <section class="card pad">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${showKcalField ? `<div><label class="bk" for="me-kcal" style="display:block;margin-bottom:6px">Calories</label><input id="me-kcal" type="number" inputmode="numeric" placeholder="0" value="${it ? v(it.kcal) : ''}" style="${numField}" /></div>` : ''}
        ${showMacroFields ? `
        <div><label class="bk" for="me-p" style="display:block;margin-bottom:6px">Protein (g)</label><input id="me-p" type="number" inputmode="numeric" placeholder="0" value="${it ? v(it.protein) : ''}" style="${numField};color:var(--green-bright)" /></div>
        <div><label class="bk" for="me-c" style="display:block;margin-bottom:6px">Carbs (g)</label><input id="me-c" type="number" inputmode="numeric" placeholder="0" value="${it ? v(it.carbs) : ''}" style="${numField}" /></div>
        <div><label class="bk" for="me-f" style="display:block;margin-bottom:6px">Fat (g)</label><input id="me-f" type="number" inputmode="numeric" placeholder="0" value="${it ? v(it.fat) : ''}" style="${numField}" /></div>` : ''}
      </div>
    </section>` : ''}

    <div id="me-err" role="alert" style="color:var(--red-bright);font-size:13px;font-weight:600;min-height:18px;margin-top:12px;text-align:center"></div>
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
    root.querySelectorAll('#me-kind .chip').forEach((ch) => ch.addEventListener('click', () => { kind = ch.dataset.k || 'meal'; }));
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
      // A number field may not be in the DOM (a style or professional override hides it —
      // per field: macros and calories each ride their own flag when editing a saved item).
      // Ask the DOM rather than the style so this click always matches what THIS render
      // showed; a hidden field's stored number passes through unchanged — hiding is
      // presentation, never data.
      const kcalShown = !!root.querySelector('#me-kcal');
      const macrosShown = !!root.querySelector('#me-p');
      // A hidden field means render had a saved item to fall back on. If the cache was
      // force-refreshed between render and this click and the item is gone (archived
      // elsewhere), refusing beats inserting a nameless duplicate with zeros in the hidden
      // columns — the exact row no fueling score survives.
      if ((!kcalShown || !macrosShown) && !it) { err.textContent = 'This saved meal is gone. Go back to Plan and try again.'; return; }
      const stored = (k) => Math.max(0, Number(it && it[k]) || 0);
      const p = macrosShown ? Math.max(0, parseFloat(val('me-p')) || 0) : stored('protein');
      const kcal = kcalShown ? Math.max(0, parseFloat(val('me-kcal')) || 0) : stored('kcal');
      if (p <= 0 && kcal <= 0 && (kcalShown || macrosShown)) {
        err.textContent = kcalShown && macrosShown ? 'Enter at least the calories or protein.'
          : kcalShown ? 'Enter the calories.' : 'Enter the protein.';
        return;
      }
      btn.disabled = true; err.textContent = '';
      const ok = await act.saveMemoryForm({
        ...(it ? { id: it.id } : {}),
        name, kind,
        placeName: String(val('me-place') || '').trim() || null,
        protein: p, kcal,
        carbs: macrosShown ? parseFloat(val('me-c')) || 0 : stored('carbs'),
        fat: macrosShown ? parseFloat(val('me-f')) || 0 : stored('fat'),
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
