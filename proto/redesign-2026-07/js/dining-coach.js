/* The coach Home door to dining halls (goals and eating plan, phase C, 2026-09-26).
 *
 * Painted into #dh-slot on operator Home by dynamic import, the season control's seam
 * (season-coach.js): nothing here is in the boot graph and a slow read never delays the queue.
 * Renders only for staff who edit the team's standard on a team whose plan is live
 * (dining-staff-model.js canManageDining; 0255 enforces the same on every write). Fails CLOSED
 * while the role loads: view-only staff never see it, not even for a frame.
 */
import { CD, bookId, loadBook } from './coach-data.js';
import { icon } from './icons.js';
import { esc } from './components.js';
import { canManageDining } from './dining-staff-model.js';

const TTL = 60000;
let STATE = { team: null, halls: null, live: 0, drafts: 0, at: 0 };

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function showDiningControl() {
  if (CD.kind !== 'team' || !CD.roster || !bookId()) return false;
  return !!(CD.extras && canManageDining(CD.extras.myRole, CD.caps, CD.kind));
}

/** The control's value line, from what was read. */
export function diningValue({ halls, live, drafts }) {
  if (!halls) return { text: 'Add your dining hall menus', unset: true, go: 'Set up' };
  const h = `${halls} hall${halls === 1 ? '' : 's'}`;
  if (live) return { text: `${h} · Today's menu is live`, unset: false, go: 'Open' };
  if (drafts) return { text: `${h} · A draft is waiting`, unset: false, go: 'Review' };
  return { text: `${h} · No menu for today`, unset: false, go: 'Upload' };
}

async function read(force) {
  const team = bookId();
  const sb = window.sb;
  if (!team || !sb) return false;
  if (!force && STATE.team === team && STATE.halls !== null && Date.now() - STATE.at < TTL) return false;
  try {
    const [h, m] = await Promise.all([
      sb.from('dining_halls').select('id').eq('team_id', team),
      sb.from('dining_menus').select('status').eq('team_id', team).eq('menu_date', localToday()),
    ]);
    if (h.error) return false;
    const rows = Array.isArray(m.data) ? m.data : [];
    STATE = { team, halls: (h.data || []).length, live: rows.filter((r) => r.status === 'published').length, drafts: rows.filter((r) => r.status === 'draft').length, at: Date.now() };
    return true;
  } catch { return false; }
}

export function diningControlHtml() {
  if (!showDiningControl() || STATE.team !== bookId() || STATE.halls === null) return '';
  const v = diningValue(STATE);
  return `<button type="button" class="sp-ctl dh-ctl" data-go="dining-halls">
    <span class="sp-ic dh-ic">${icon('utensils', 18)}</span>
    <span class="sp-tx"><span class="sp-k">Dining halls</span><span class="sp-v${v.unset ? ' unset' : ''}">${esc(v.text)}</span></span>
    <span class="sp-go">${esc(v.go)}${icon('chevron', 13)}</span>
  </button>`;
}

export function paintDining(root) {
  const slot = root.querySelector('#dh-slot');
  if (!slot) return;
  const paint = () => { if (slot.isConnected) slot.innerHTML = diningControlHtml(); };
  paint();
  const go = () => { if (showDiningControl()) void read(false).then(paint); };
  if (CD.kind === 'team' && !CD.extras) void Promise.resolve(loadBook(false, 'team')).then(go);
  else go();
}

/* Tests only. */
export function _seedDiningControl(s) { STATE = { team: bookId(), at: Date.now(), live: 0, drafts: 0, ...s }; }
