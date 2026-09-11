import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { morningSummary, wakeClock, WAKEUP_TYPE } from '../wakeup-morning.js';
import { VC, loadBoard } from '../commitment-data.js';
import { CD, bookId, loadBook } from '../coach-data.js';
import * as roles from '../roles.js';

/* The coach's morning, in one card.
 *
 * Founder ruling: a coach is asleep at 5:45 too, so the surface this feature is built around is
 * the summary when the window SHUTS, not the live widget. The live board already exists on coach
 * Home; this is the thing they actually open at breakfast.
 *
 * Every number comes from wakeup-morning.js, so this screen and the athlete's squad list can
 * never disagree about the same morning. Nothing here re-derives a verdict: the server stamps
 * those (rollcall_verdict, 0212) and the client's job is to render them.
 *
 * There is no snooze column, and there will not be one until the app owns a real alarm. The roll
 * call can only tell us that an athlete answered on time, answered late, or never answered.
 */

function instanceOf() {
  return (VC.board || []).find((i) => i.type === WAKEUP_TYPE) || null;
}

function needRow(r) {
  const why = r.verdict === 'missed' ? 'Never answered' : `${r.lateMin} minutes late`;
  const cls = r.verdict === 'missed' ? 'r' : 'a';
  const initials = (r.name || '?').split(' ').map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
  return `
  <div class="lrow wk-need">
    <div class="lic">${esc(initials)}</div>
    <div class="lm"><div class="lt">${esc(r.name)}</div><div class="ls wk-why ${cls}">${esc(why)}</div></div>
    <button type="button" class="btn ghost xs wk-nudge" data-nudge="${esc(r.athleteId || '')}">Nudge</button>
  </div>`;
}

export default {
  nav: 'coach', tab: 'home',
  render() {
    const inst = instanceOf();
    if (!inst) {
      return `${backHead('This morning', '', 'coach-home')}
      <div class="sidebox">
        <div class="req-icon muted s38">${icon('clock', 17)}</div>
        <div><div class="tt">No wake-up was set</div>
        <div class="ts">Set one from the create menu and this fills in the next morning.</div></div>
      </div>
      <div class="wk-gap"></div>`;
    }
    const s = morningSummary(inst);
    const pct = s.total ? Math.round((s.onTime / s.total) * 100) : 0;
    return `
    ${backHead('This morning', `${esc(inst.title || 'Team wake-up')} · ${esc(inst.audience_label || 'Everyone')}`, 'coach-home')}

    <section class="wk-pulse">
      <div class="wk-k">Up on time</div>
      <div class="wk-num"><span class="wk-big">${s.onTime}</span><span class="wk-of">/${s.total}</span></div>
      <div class="wk-bar" role="img" aria-label="${s.onTime} up on time, ${s.late} late, ${s.missed} never answered">
        ${/* The proportions are set in mount() with style.setProperty, not as an inline style
              attribute: a new proto file has an inline-style ceiling of zero, and a flex weight
              that varies per roster cannot be a class. Same seam the perfect-plate particles use. */''}
        ${s.onTime ? `<span class="wk-seg g" data-flex="${s.onTime}"></span>` : ''}
        ${s.late ? `<span class="wk-seg a" data-flex="${s.late}"></span>` : ''}
        ${s.missed ? `<span class="wk-seg r" data-flex="${s.missed}"></span>` : ''}
      </div>
      ${s.firstUp ? `<div class="wk-cap">${esc(s.firstUp.name)} was first up at ${esc(wakeClock(s.firstUp.atMin))}.</div>` : ''}
    </section>

    ${s.needsYou.length ? `
    <h2 class="eyebrow">Needs you</h2>
    <section class="card rows">${s.needsYou.map(needRow).join('')}</section>` : `
    <div class="wk-gap"></div>
    <div class="sidebox">
      <div class="req-icon g s38">${icon('check', 17)}</div>
      <div><div class="tt">Everyone answered</div>
      <div class="ts">${pct}% of the roster was up inside the window.</div></div>
    </div>`}

    <div class="wk-gap"></div>
    `;
  },
  async mount(root) {
    const sizeBar = () => root.querySelectorAll('.wk-seg[data-flex]').forEach((el) => {
      el.style.setProperty('flex', el.getAttribute('data-flex'));
    });
    sizeBar();
    /* Load the operator book FIRST. On direct entry — a relaunch restoring this hash — bookId()
       is null until the book lands, and without this the screen would render "no wake-up was
       set" to a coach who has one. book-arrival.test.mjs is the gate that caught it. */
    if (!bookId()) { await loadBook(false, CD.kind); }
    const id = bookId();
    if (id) {
      await loadBoard(id, CD.kind);
      if (root.isConnected) window.__render();
      sizeBar();
    }
    /* Delegated on the screen root: #view is replaced on every paint, so a listener bound to a
       row would die with the repaint the load above triggers. */
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-nudge]');
      if (!b || b.disabled) return;
      const who = b.getAttribute('data-nudge');
      if (!who) return;
      b.disabled = true;
      b.textContent = 'Sending';
      const r = await roles.nudgePush(who, 'Morning', 'Your coach noticed you missed roll call.');
      b.textContent = (r && r.ok !== false) ? 'Sent' : 'Try again';
      if (!r || r.ok === false) b.disabled = false;
    });
  },
};
