/* Home's teaching slot (goals and eating plan, phase D, 2026-09-26): the assigned lesson card, the
 * team challenge, and the weekly focus, in one slot (#wf-slot).
 *
 * THE PRIORITY (lessons-model.js homeCards, tested): an assigned lesson sits on top as one compact
 * card ("From Coach Grinch: Carbs are fuel · 1 min", with the due date) until it is done. Under it,
 * a running team challenge REPLACES the personal weekly focus, so there are never two focus cards.
 * An athlete the challenge's habit is not part of (the snack where their standard has none) keeps
 * their own focus card.
 *
 * The challenge's numbers are the SERVER's (0256 my_learning), computed from the stored day rows:
 * the athlete's own days and the team as a count, never a name. Deterministic text the app writes,
 * never signed as Nia. Lazy: home.js imports this by dynamic import; athletes only.
 */
import { S } from './state.js';
import { DAY } from './day.js';
import { esc } from './components.js';
import { icon } from './icons.js';
import * as WF from './weekly-focus.js';
import { learning, doneIds, loadLearning } from './learn-data.js';
import { openAssignments, assignedCardCopy, homeCards, lessonForFocus } from './lessons-model.js';
import { habitTitle, habitRule, trackerStates, teamLine, myLine, isRunning } from './challenge-model.js';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STATE_WORD = { hit: 'done', miss: 'missed', unknown: 'not read yet', open: 'today, not yet', future: 'still to come', na: 'not part of it' };

/** The next assigned lesson still to do, or null. */
export function nextAssigned() {
  const d = learning();
  if (!d) return null;
  const open = openAssignments(d.assignments, doneIds());
  return open.length ? { row: open[0], more: open.length - 1 } : null;
}

/** A team challenge running today that this athlete is part of, or null. */
export function runningChallenge() {
  const d = learning();
  const c = d && d.challenge;
  if (!c || !isRunning(c, String(DAY.date)) || !c.mine || !c.mine.eligible) return null;
  return c;
}

export function lessonCardHtml() {
  const n = nextAssigned();
  if (!n) return '';
  const c = assignedCardCopy(n.row, String(DAY.date));
  if (!c) return '';
  const meta = n.more > 0 ? `${c.meta} · ${n.more} more in Learn` : c.meta;
  return `<button type="button" class="lnh" data-go="lesson/${esc(n.row.lesson_id)}" aria-label="${esc(`${c.from}: ${c.title}, ${meta}`)}">
    <span class="lnh-ic" aria-hidden="true">${icon('fileText', 18)}</span>
    <span class="lnh-tx"><span class="lnh-from">${esc(c.from)}</span><span class="lnh-t">${esc(c.title)}</span><span class="lnh-m">${esc(meta)}</span></span>
    <span class="lnh-go" aria-hidden="true">Start${icon('chevron', 13)}</span>
  </button>`;
}

/** The lesson a focus or habit points at, as a quiet link row (the weekly focus's own row). */
export const learnLinkHtml = (key) => WF.learnRow(lessonForFocus(key));

export function challengeHtml() {
  const c = runningChallenge();
  if (!c) return '';
  const numbers = !!(S.planStyle && S.planStyle.showMacros);
  const days = trackerStates(c.mine.days, String(DAY.date));
  const rows = days.length > 7 ? ' two' : '';
  return `<section class="tch" aria-label="Team challenge">
    <div class="wf-eb">Team challenge</div>
    <div class="wf-t">${esc(habitTitle(c.habit, numbers))}</div>
    <p class="wf-why">${esc(`${habitRule(c.habit, numbers)} Goal: ${c.goal_days} of ${days.length} days.`)}</p>
    <ol class="wf-trk${rows}" aria-label="Your days">
      ${days.map((d) => `<li class="wf-d ${d.state}" aria-label="${esc(`${DAY_NAMES[(new Date(`${d.date}T12:00:00Z`).getUTCDay() + 6) % 7]}, ${STATE_WORD[d.state]}`)}"><span class="wf-dot" aria-hidden="true">${d.state === 'hit' ? icon('check', 13) : ''}</span><span class="wf-dl" aria-hidden="true">${esc(d.label)}</span></li>`).join('')}
    </ol>
    <div class="tch-row">
      <span class="tch-me">${esc(myLine({ hits: c.mine.hits, goal: c.goal_days }))}</span>
      <span class="tch-team">${icon('users', 14)}${esc(teamLine({ onTrack: c.team_on_track, total: c.team_total }))}</span>
    </div>
    ${learnLinkHtml(c.habit)}
  </section>`;
}

/** The whole slot, in priority order. The name home.js calls. */
export function focusHtml() {
  if (!WF.isAthleteView()) return '';
  let lesson = '';
  let challenge = '';
  try { lesson = lessonCardHtml(); } catch { lesson = ''; }
  try { challenge = challengeHtml(); } catch { challenge = ''; }
  return homeCards({ lesson: !!lesson, challenge: !!challenge, focus: true })
    .map((k) => (k === 'lesson' ? lesson : k === 'challenge' ? challenge : WF.focusHtml()))
    .join('');
}

/* A logged meal can move today's hit: the read is refreshed when Home paints a day whose meals
   changed since the last one (the server needs the day row first, which pushDay sends). */
let SEEN_MEALS = null;
const mealsKey = () => JSON.stringify(DAY.meals || {}) + String(DAY.date);

function repaint(root) {
  const slot = root && root.isConnected && root.querySelector('#wf-slot');
  if (!slot) return;
  slot.innerHTML = focusHtml();
  wireFocus(root, false);
}

/** Wire the slot inside `root` (Home's mount, every render) and refresh the read when due. */
export function wireFocus(root, warm = true) {
  WF.setSlotPainter(repaint);
  WF.wireFocus(root, warm);
  if (!warm || !WF.isAthleteView()) return;
  const k = mealsKey();
  const force = SEEN_MEALS !== null && SEEN_MEALS !== k;
  SEEN_MEALS = k;
  // A changed day waits a beat so its row reaches the server before the read.
  const go = () => loadLearning(force).then((changed) => { if (changed) repaint(root); }, () => {});
  if (force) setTimeout(go, 2500); else void go();
}
