import { RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, skeletonRows } from '../components.js';
import { morningSummary, wakeClock, WAKEUP_TYPE } from '../wakeup-morning.js';
import { VC, loadBoard } from '../commitment-data.js';
import { boardRoute, ROLLCALL_OFF } from '../commitments.js';
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
    <button type="button" class="btn ghost xs wk-nudge" data-nudge="${esc(r.athleteId || '')}" data-verdict="${esc(r.verdict || '')}">Ping</button>
  </div>`;
}

/* The book's own home: a trainer's practice lands on #trainer, a coach's team on #coach-home.
   Written here rather than imported from coach-connected.js (bookBack) so this screen has no
   import from the connected-standards module. */
const homeOf = () => (RT.authRole === 'trainer' ? 'trainer' : 'coach-home');

/* Which book today's board has answered for, so a cold open says "loading" rather than "no wake-up
   was set" to a coach who has one. Keyed by the book (final review M-2): a module-global boolean
   survived a sign-out, so the NEXT coach in the same session got "No wake-up was set" with no
   repaint. '' = settled with no book at all, which is an answer too (never a skeleton forever). */
let LOADED_FOR = null;
const loadedNow = () => LOADED_FOR !== null && LOADED_FOR === (bookId() || '');

export default {
  // 'operator', not 'coach': the router admits coach AND trainer under 'operator', and the Home
  // card hands every operator here once the window shuts. Under 'coach' a trainer got the
  // not-permitted screen for their own roll call's summary.
  nav: 'operator', tab: 'home',
  /* RETIRED AS A DESTINATION (roll call rebuilt, 2026-09-23). The team board is the morning's
     summary once the window shuts: first up, the split, and the Missed group with a nudge on
     every face. Old links (a restored hash, an old build's Home card) land there, opened on the
     misses, before this screen paints (router.js redirect). What stays below is the honest
     empty state for a book with no wake-up today, and the loading state before the board
     answers. */
  redirect() {
    // Switched off (commitments.js, 2026-09-24): the operator's Home, never this summary.
    if (ROLLCALL_OFF) return RT.authRole === 'trainer' ? 'trainer' : 'coach-home';
    const inst = instanceOf();
    return inst ? boardRoute(inst.instance_id, 'missed') : null;
  },
  render() {
    const inst = instanceOf();
    if (!inst && !loadedNow()) return `${backHead('Roll call', 'Loading…', homeOf())}${skeletonRows(4, 'Loading this morning')}`;
    if (!inst) {
      return `${backHead('This morning', '', homeOf())}
      <div class="sidebox">
        <div class="req-icon muted s38">${icon('clock', 17)}</div>
        <div><div class="tt">No wake-up was set</div>
        <div class="ts">Set one up and this fills in the next morning.</div></div>
      </div>
      <div class="wk-gap"></div>
      <button class="btn primary" data-go="rollcall-new">Set a roll call</button>`;
    }
    const s = morningSummary(inst);
    const pct = s.total ? Math.round((s.onTime / s.total) * 100) : 0;
    return `
    ${backHead('This morning', `${esc(inst.title || 'Roll call')} · ${esc(inst.audience_label || 'Everyone')}`, homeOf())}

    ${/* No pulse on an empty roster (2026-09-22): a display-size "0/0 UP ON TIME" above
          "Nobody was on this roll call" read as a failed morning before the sentence explained it. */''}
    ${s.total ? `<section class="wk-pulse">
      <div class="wk-k">Up on time</div>
      <div class="wk-num"><span class="wk-big">${s.onTime}</span><span class="wk-of">/${s.total}</span></div>
      <div class="wk-bar" role="img" aria-label="${s.total ? `${s.onTime} up on time, ${s.late} late, ${s.missed} never answered` : 'Nobody was scheduled'}">
        ${/* The proportions are set in mount() with style.setProperty, not as an inline style
              attribute: a new proto file has an inline-style ceiling of zero, and a flex weight
              that varies per roster cannot be a class. Same seam the perfect-plate particles use. */''}
        ${s.onTime ? `<span class="wk-seg g" data-flex="${s.onTime}"></span>` : ''}
        ${s.late ? `<span class="wk-seg a" data-flex="${s.late}"></span>` : ''}
        ${s.missed ? `<span class="wk-seg r" data-flex="${s.missed}"></span>` : ''}
      </div>
      ${s.firstUp ? `<div class="wk-cap">${esc(s.firstUp.name)} was first up at ${esc(wakeClock(s.firstUp.atMin))}.</div>` : ''}
    </section>` : ''}

    ${/* NOBODY SCHEDULED IS NOT EVERYONE ANSWERING (founder audit 2026-09-14). With a total of 0
          this congratulated the coach with "Everyone answered" and then, one line down, "0% of the
          roster was up inside the window" - a success claim and its own contradiction, stacked.
          An empty roster reports empty, the same way commitments.js and connected-standards.js
          report null rather than a fake zero. */''}
    ${!s.total ? `
    <div class="sidebox">
      <div class="req-icon muted s38">${icon('clock', 17)}</div>
      <div><div class="tt">Nobody was on this roll call</div>
      <div class="ts">No one was scheduled for this morning, so there is nothing to report. Check who it goes to on the full roll call.</div></div>
    </div>` : s.needsYou.length ? `
    <h2 class="eyebrow">Needs you</h2>
    <section class="card rows">${s.needsYou.map(needRow).join('')}</section>` : `
    <div class="wk-gap"></div>
    <div class="sidebox">
      <div class="req-icon g s38">${icon('check', 17)}</div>
      <div><div class="tt">Everyone answered</div>
      <div class="ts">${pct}% of the roster was up inside the window.</div></div>
    </div>`}

    ${/* The live board is where overrides, excuses and recent mornings live. Before 2026-09-14
          the operator-Home card opened that board in every phase and this screen had no door at
          all; now the closed phase opens here instead, so the board has to stay one tap away or
          the swap would have taken something away. */''}
    <div class="wk-gap"></div>
    <section class="card rows">
      <div class="lrow" data-go="coach-commitments/${esc(inst.instance_id)}" role="button" tabindex="0">
        <div class="lic">${icon('clock', 15)}</div>
        <div class="lm"><div class="lt">Open the full roll call</div>
          <div class="ls">Overrides, excuses, and recent mornings</div></div>
        ${icon('chevron', 14, 'class="ic-chevron"')}
      </div>
    </section>

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
    if (id) await loadBoard(id, CD.kind);
    const key = id || '';
    const first = LOADED_FOR !== key;
    LOADED_FOR = key;
    // The first answer for THIS book repaints, once: it turns the skeleton into the board (the
    // redirect) or into the honest empty state. Every later mount would otherwise repaint into itself.
    if (root.isConnected && first) window.__render();
    sizeBar();
    /* Delegated on the screen root: #view is replaced on every paint, so a listener bound to a
       row would die with the repaint the load above triggers. */
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-nudge]');
      if (!b || b.disabled) return;
      const who = b.getAttribute('data-nudge');
      if (!who) return;
      b.disabled = true;
      b.textContent = 'Sending';
      // A late athlete answered; telling them they "missed" is wrong twice, once as a fact and
      // once as a coach. The verdict rides the button.
      const late = b.getAttribute('data-verdict') === 'late';
      const r = await roles.nudgePush(who, 'Morning', late ? 'Your coach noticed you were late to roll call.' : 'Your coach noticed you missed roll call.');
      b.textContent = (r && r.ok !== false) ? 'Sent' : 'Try again';
      if (!r || r.ok === false) b.disabled = false;
    });
  },
};
