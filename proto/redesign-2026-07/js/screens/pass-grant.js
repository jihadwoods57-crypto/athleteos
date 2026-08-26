/* Grant a Trust Pass (0196): a coach OR trainer reward, a camera-free meal credit stash or a
   date window, credited from the athlete's own trailing median. Route: pass-grant/:athleteId.
   Structured like sponsor.js — the closest existing single-purpose operator form: module-level
   UI state, a render() that reads it, a mount(root) that wires listeners and re-renders. */
import { S, RT } from '../state.js';
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { CD } from '../coach-data.js';

function athleteName(athleteId) {
  const r = CD.roster && CD.roster.rows && CD.roster.rows.find((x) => x.athleteId === athleteId);
  return r ? r.name : (CD.kind === 'practice' ? 'this client' : 'this athlete');
}

const policy = () => RT.passPolicy || { default_credits: 3, default_window_days: 2, eligibility_days: 7, max_credits: 5 };

function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
/** "Sat, Aug 29", never raw ISO: this line is what a coach reads aloud to the athlete. Parsed at
 *  local midnight so a negative-offset timezone can't shift the weekday back a day. */
function fmtDay(iso) {
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  catch { return String(iso); }
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
/** The coming Saturday (today if today IS Saturday) through the following Sunday. */
function comingWeekend() {
  const now = new Date();
  const dow = now.getDay(); // 0 = Sun .. 6 = Sat
  const toSat = (6 - dow + 7) % 7;
  const sat = addDays(now, toSat);
  return { from: isoDate(sat), until: isoDate(addDays(sat, 1)) };
}

let UI = { shape: 'credits', credits: null, windowDays: null, expiresDays: 14, note: '', busy: false, error: null };
let resetForId = null;

function resetIfNewAthlete(athleteId) {
  if (resetForId === athleteId) return;
  resetForId = athleteId;
  const p = policy();
  UI = { shape: 'credits', credits: p.default_credits, windowDays: p.default_window_days, expiresDays: 14, note: '', busy: false, error: null };
}

/** UI state -> the concrete args grantPass sends. Presets set shape + amount together; this only
 *  ever reads UI, so a preset tap and a manual edit go through the exact same path. */
function resolveArgs() {
  const p = policy();
  if (UI.shape === 'window') {
    const from = UI.from || comingWeekend().from;
    const until = UI.until || comingWeekend().until;
    return { credits: null, from, until, expires: until, note: UI.note.trim() || null };
  }
  const credits = Math.max(1, Math.min(p.max_credits, UI.credits || p.default_credits));
  const expires = isoDate(addDays(new Date(), UI.expiresDays || 14));
  return { credits, from: null, until: null, expires, note: UI.note.trim() || null };
}

export default {
  nav: 'operator',
  render({ sub }) {
    const athleteId = sub;
    const p = policy();
    if (!athleteId) return `${backHead('Give a pass', 'No athlete selected', CD.kind === 'practice' ? 'trainer-roster' : 'coach-roster')}`;
    resetIfNewAthlete(athleteId);
    const name = athleteName(athleteId);
    const isWindow = UI.shape === 'window';
    const wknd = comingWeekend();

    return `
    ${backHead('Give a pass', `A reward for ${esc(name)}`, `coach-athlete/${esc(athleteId)}`)}

    <div class="eyebrow">Shape</div>
    <section class="card pad">
      <div class="seg" style="width:100%">
        <button data-shape="credits" class="${!isWindow ? 'on' : ''}">Meals</button>
        <button data-shape="window" class="${isWindow ? 'on' : ''}">Window</button>
      </div>
    </section>

    ${!isWindow ? `
    <div class="eyebrow">Meal credits</div>
    <section class="card pad">
      <div class="lrow" style="cursor:default">
        <div class="lm"><div class="lt">${UI.credits || p.default_credits} camera-free meals</div><div class="ls">Max ${p.max_credits} per grant</div></div>
        <div class="seg" style="width:104px" data-stepper="credits">
          <button data-step="-1" aria-label="Fewer credits">-</button>
          <button data-step="1" aria-label="More credits">+</button>
        </div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lm"><div class="lt">Expires in ${UI.expiresDays} days</div><div class="ls">Unused credits stop working after this</div></div>
        <div class="seg" style="width:104px" data-stepper="expiresDays">
          <button data-step="-1" aria-label="Sooner">-</button>
          <button data-step="1" aria-label="Later">+</button>
        </div>
      </div>
    </section>` : `
    <div class="eyebrow">Window</div>
    <section class="card pad">
      <div class="lrow" style="cursor:default">
        <div class="lm"><div class="lt">${esc(fmtDay(UI.from || wknd.from))} through ${esc(fmtDay(UI.until || wknd.until))}</div><div class="ls">Every meal in range is covered, nothing to spend</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <div style="flex:1"><label for="pg-from" style="display:block;font-size:var(--t-xs);font-weight:700;color:var(--text-2);margin-bottom:4px">From</label><input class="ob-input" type="date" id="pg-from" value="${esc(UI.from || wknd.from)}" /></div>
        <div style="flex:1"><label for="pg-until" style="display:block;font-size:var(--t-xs);font-weight:700;color:var(--text-2);margin-bottom:4px">Until</label><input class="ob-input" type="date" id="pg-until" value="${esc(UI.until || wknd.until)}" /></div>
      </div>
    </section>`}

    <div class="eyebrow">Presets</div>
    <section class="card pad">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn ghost xs" data-preset="weekend" style="width:auto">Weekend</button>
        <button class="btn ghost xs" data-preset="travel" style="width:auto">Travel</button>
        <button class="btn ghost xs" data-preset="rest" style="width:auto">Rest day</button>
      </div>
    </section>

    <div class="eyebrow">Note (optional)</div>
    <section class="card pad">
      <input class="ob-input" id="pg-note" maxlength="140" value="${esc(UI.note)}" placeholder="e.g. Great week" />
      <div style="font-size:11px;font-weight:600;color:var(--text-3);margin-top:4px">${esc(String(UI.note.length))}/140 · shows to ${esc(name)} with the grant</div>
    </section>

    <div id="pg-err" style="color:var(--red);font-size:13px;font-weight:600;min-height:18px;padding:0 4px">${UI.error ? esc(UI.error) : ''}</div>
    <button class="btn primary" id="pg-submit" ${UI.busy ? 'disabled style="opacity:.6"' : ''}>${icon('shield', 18)} ${UI.busy ? 'Granting…' : 'Give the pass'}</button>

    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
      <div><div class="tt">Server-checked every time</div><div class="ts">Needs ${p.eligibility_days} photo-logged days on record. A pass can never be earned from nothing.</div></div></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    const athleteId = sub;
    if (!athleteId) return;

    root.querySelectorAll('[data-shape]').forEach((b) => b.addEventListener('click', () => {
      UI.shape = b.getAttribute('data-shape');
      UI.error = null;
      if (window.__render) window.__render();
    }));

    root.querySelectorAll('[data-stepper]').forEach((seg) => {
      const key = seg.getAttribute('data-stepper');
      const bounds = key === 'credits' ? [1, policy().max_credits] : [1, 60];
      seg.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
        const [lo, hi] = bounds;
        const cur = key === 'credits' ? (UI.credits || policy().default_credits) : UI.expiresDays;
        const next = Math.max(lo, Math.min(hi, cur + Number(b.getAttribute('data-step'))));
        if (key === 'credits') UI.credits = next; else UI.expiresDays = next;
        if (window.__render) window.__render();
      }));
    });

    root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const which = b.getAttribute('data-preset');
      const wknd = comingWeekend();
      if (which === 'weekend') {
        UI.shape = 'window'; UI.from = wknd.from; UI.until = wknd.until;
      } else if (which === 'travel') {
        UI.shape = 'credits'; UI.credits = policy().default_credits; UI.expiresDays = 14;
      } else if (which === 'rest') {
        const tmr = addDays(new Date(), 1);
        UI.shape = 'window'; UI.from = isoDate(tmr); UI.until = isoDate(tmr);
      }
      UI.error = null;
      if (window.__render) window.__render();
    }));

    // Native date inputs bound to the window. The presets stay: they write the same UI.from and
    // UI.until fields, so a preset tap and a hand-picked date render identically.
    const wireDate = (id, key) => {
      const el = root.querySelector('#' + id);
      if (!el) return;
      el.addEventListener('change', () => {
        const w = comingWeekend();
        if (!UI.from) UI.from = w.from;
        if (!UI.until) UI.until = w.until;
        if (el.value) UI[key] = el.value;
        // Keep the window ordered: an until before from would grant a window covering nothing.
        if (UI.until < UI.from) { if (key === 'from') UI.until = UI.from; else UI.from = UI.until; }
        UI.error = null;
        if (window.__render) window.__render();
      });
    };
    wireDate('pg-from', 'from');
    wireDate('pg-until', 'until');

    const noteEl = root.querySelector('#pg-note');
    if (noteEl) noteEl.addEventListener('input', () => { UI.note = noteEl.value.slice(0, 140); });

    const submit = root.querySelector('#pg-submit');
    if (submit) submit.addEventListener('click', async () => {
      UI.busy = true; UI.error = null; if (window.__render) window.__render();
      const args = resolveArgs();
      const r = await roles.grantPass(athleteId, args);
      UI.busy = false;
      if (!r.ok) {
        // The server's message already names the shortfall ("athlete not eligible: 3 of 7
        // photo-logged days"). Rewriting it client-side would just let the two drift.
        UI.error = r.error || 'Could not grant it. Try again.';
        if (window.__render) window.__render();
        return;
      }
      resetForId = null; // next open of this or another athlete starts from policy defaults
      location.hash = `#coach-athlete/${athleteId}`;
    });
  },
};
