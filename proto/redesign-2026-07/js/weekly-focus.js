/* Home: this week's focus, and the Sunday recap under it (goals and eating plan, A2, 2026-09-25).
 *
 * ONE calm card: "This week's focus" in the goal teal, the focus, one line on why with a real
 * number, a Monday to Sunday tracker, three tips the athlete can tick off, and "Ask Nia why this
 * matters", which types the question into the nutrition chat and leaves it unsent (and is not drawn
 * when there is no chat to open: never a detour to Plan > Ask, which asks on arrival). On Sunday, and
 * Monday until noon, one quiet line recaps the week.
 *
 * LAZY ON PURPOSE: screens/home.js is in the boot graph, so this arrives by dynamic import the
 * first time Home mounts and draws into #wf-slot. The rules live in weekly-focus-model.js and
 * what-works-model.js (tested in Node); this file reads the live day and draws. Deterministic text
 * the app writes: nothing here is signed as Nia and nothing calls a model. Athletes only: a coach,
 * a trainer or a guardian never gets the card.
 */
import { S, RT, slotTitle } from './state.js';
import { DAY, slotDeadline, slotGrace, minutesNow } from './day.js';
import { esc } from './components.js';
import { icon } from './icons.js';
import { slotOrder } from './plan-today-model.js';
import { recentRows, warmRecent } from './recent-meals.js';
import {
  WINDOW_DAYS, addDays, dayFacts, resolveFocus, candidateStats, focusCopy, focusTips, askQuestion,
  tracker, recapDue, recapLine, loggedDays, slotShare,
} from './weekly-focus-model.js';
import { FIELDS, findPatterns, topInsights, isStrong, insightText } from './what-works-model.js';
import { lessonForFocus, lessonById, LESSON_MINUTES } from './lessons-model.js';
import { doneIds } from './learn-data.js';

/* ---------------- the athlete's days, as the models read them ---------------- */
const NOT_ATHLETE = new Set(['coach', 'trainer', 'parent']);
export const isAthleteView = () => !!RT.userId && !NOT_ATHLETE.has(RT.authRole);

export function teachCtx() {
  return { order: slotOrder(RT.stdMeals), target: DAY.proteinTarget, deadline: (k) => slotDeadline(k) + slotGrace(k) };
}
/** Past days from the history rows that carry meals (the 35-day heavy window). */
export function historyFacts(ctx) {
  return (DAY.scoreHistory || [])
    .filter((h) => h && h.date < DAY.date)
    .map((h) => dayFacts({ date: h.date, meals: h.meals, checkin: h.checkin, score: h.score }, ctx))
    .filter(Boolean);
}
function todayFacts(ctx) {
  return dayFacts({
    date: DAY.date, meals: DAY.meals, score: null,
    checkin: { ...DAY.ci, submitted: DAY.ciSubmitted, slotMacros: DAY.slotMacros, mealLoggedAt: DAY.mealLoggedAt },
  }, ctx);
}
/** The check-in fields this athlete is actually asked: an unasked one still stores its default. */
export const askedFields = () => Object.keys(FIELDS).filter((f) => DAY.ciConfig && DAY.ciConfig[f]);
export const titleOf = (k) => slotTitle(k);

/* ---------------- this phone's record of the week: the focus and the ticked tips ---------------- */
const KEY = (uid) => `os.weekFocus.${uid}`;
function readStore() {
  try { const j = JSON.parse(window.localStorage.getItem(KEY(RT.userId)) || 'null'); return j && typeof j === 'object' ? j : null; } catch { return null; }
}
function writeStore(v) {
  try { window.localStorage.setItem(KEY(RT.userId), JSON.stringify(v)); } catch { /* quota: the focus is recomputed, the ticks are lost */ }
}

/** Everything the card draws, or null for no card. `gentle` = too little data yet. */
export function focusView() {
  if (!isAthleteView() || !DAY.date) return null;
  const ctx = teachCtx();
  const past = historyFacts(ctx);
  const window14 = past.filter((d) => d.date >= addDays(DAY.date, -WINDOW_DAYS));
  const stored = readStore();
  const r = resolveFocus({ stored, days: window14, ctx, todayISO: DAY.date });
  if (r.stored && JSON.stringify(r.stored) !== JSON.stringify(stored)) writeStore(r.stored);
  if (!r.key) return loggedDays(window14) > 0 ? { gentle: true } : null;
  const numbers = !!S.planStyle.showMacros;
  const stats = candidateStats(r.key, window14, ctx);
  const copy = focusCopy(stats, { numbers, titleOf });
  const today = todayFacts(ctx);
  const byDate = Object.fromEntries(past.map((d) => [d.date, d]));
  if (today) byDate[today.date] = today;
  const ticks = Array.isArray(r.stored && r.stored.tips) ? r.stored.tips : [];
  let recap = '';
  let insight = '';
  if (recapDue(DAY.date, minutesNow())) {
    const adult = !(S.consent && S.consent.minor);
    recap = recapLine(byDate, { ...ctx, todayISO: DAY.date, numbers, titleOf, weightPace: adult && numbers ? S.weight.pace : null });
    // The strongest "what works" pattern rides the recap when it is strong (A2 part 4).
    const top = topInsights(findPatterns(past, { ...ctx, fields: askedFields() }).patterns, 1)[0];
    if (recap && isStrong(top)) insight = insightText(top, { numbers, share: slotShare(ctx.target, ctx.order), titleOf });
  }
  return {
    key: r.key, numbers, ...copy,
    track: tracker(r.key, byDate, { ...ctx, todayISO: DAY.date }),
    tips: focusTips(r.key).map((t, i) => ({ text: t, done: !!ticks[i] })),
    ask: canAsk() ? askQuestion(stats, { numbers, titleOf }) : null,
    // D: the 60-second lesson that teaches this focus, when one does.
    lesson: lessonForFocus(r.key),
    recap, insight,
  };
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STATE_WORD = { hit: 'done', miss: 'missed', unknown: 'not read yet', open: 'today, not yet', future: 'still to come' };

/** The card's markup ('' for none). */
export function focusHtml() {
  let v;
  try { v = focusView(); } catch { return ''; }
  if (!v) return '';
  if (v.gentle) return '<p class="wf-gentle">Log a few more days and your weekly focus shows up here.</p>';
  return `<section class="wf" aria-label="This week's focus">
    <div class="wf-eb">This week's focus</div>
    <div class="wf-t">${esc(v.title)}</div>
    <p class="wf-why">${esc(v.why)}</p>
    <ol class="wf-trk" aria-label="This week">
      ${v.track.map((d, i) => `<li class="wf-d ${d.state}" aria-label="${esc(`${DAY_NAMES[i]}, ${STATE_WORD[d.state]}`)}"><span class="wf-dot" aria-hidden="true">${d.state === 'hit' ? icon('check', 13) : ''}</span><span class="wf-dl" aria-hidden="true">${esc(d.label)}</span></li>`).join('')}
    </ol>
    <ul class="wf-tips">
      ${v.tips.map((t, i) => `<li><button type="button" class="wf-tip${t.done ? ' on' : ''}" aria-pressed="${t.done ? 'true' : 'false'}" data-wf-tip="${i}"><span class="wf-box" aria-hidden="true">${icon('check', 12)}</span><span>${esc(t.text)}</span></button></li>`).join('')}
    </ul>
    ${learnRow(v.lesson)}
    ${v.ask ? `<button type="button" class="wf-ask" data-wf-ask="${esc(v.ask)}">${icon('sparkle', 15)}Ask Nia why this matters</button>` : ''}
    ${v.recap ? `<p class="wf-recap">${esc(v.recap.replace(/ · /g, '\u00a0· '))}</p>` : ''}
    ${v.insight ? `<p class="wf-recap">${esc(v.insight)}</p>` : ''}
  </section>`;
}

/** The lesson link under the tips (phase D): "Learn: A breakfast that holds up · 1 min". */
export function learnRow(id) {
  const l = id && lessonById(id);
  if (!l) return '';
  let done = false;
  try { done = doneIds().includes(id); } catch { done = false; }
  return `<button type="button" class="wf-learn" data-go="lesson/${esc(id)}">${icon('fileText', 15)}<span class="wf-learn-t">${esc(`Learn: ${l.title}`)}</span><span class="wf-learn-m">${done ? 'Done' : `${LESSON_MINUTES} min`}</span></button>`;
}

/* THE ASK ONLY EVER PREFILLS (review 2026-09-26). The nutrition chat hangs a message on a meal,
   so it can open only with a recent meal on file; without one the button is not drawn at all. It
   used to fall back to Plan > Ask, which ASKS on arrival: a tap that was meant to type a question
   sent it. */
const canAsk = () => { const r = recentRows(RT.userId); return !!(r && r.length); };

/** The nutrition chat with the question typed and NOT sent. Nothing when it cannot open. */
export async function askNia(q) {
  if (!canAsk()) return false;
  const { seedComposer } = await import('./screens/nutrition-chat.js');
  seedComposer(q);
  window.__go('nutrition-chat');
  return true;
}

/** Recent meals not read yet this session: read them once, then redraw the card with the ask. */
function warmAsk(root) {
  if (recentRows(RT.userId) !== null || !RT.userId) return;
  const uid = RT.userId;
  void import('./roles.js').then((roles) => warmRecent(roles, uid)).then(() => {
    if (RT.userId !== uid || !canAsk()) return;
    if (SLOT_PAINTER) { SLOT_PAINTER(root); return; }
    const slot = root && root.isConnected && root.querySelector('#wf-slot');
    if (slot) { slot.innerHTML = focusHtml(); wireFocus(root, false); }
  }, () => {});
}

/* The slot's owner (home-teach.js, phase D) draws more than this card, so a repaint from here goes
   through it: redrawing only the focus card would wipe the lesson card above it. */
let SLOT_PAINTER = null;
export function setSlotPainter(fn) { SLOT_PAINTER = typeof fn === 'function' ? fn : null; }

/** Wire the card inside `root` (Home's mount, every render). Ticks flip in place. */
export function wireFocus(root, warm = true) {
  const card = root && root.querySelector('.wf');
  if (!card) return;
  if (warm) warmAsk(root);
  card.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const tip = t.closest('[data-wf-tip]');
    if (tip) {
      const i = Number(tip.dataset.wfTip);
      const s = readStore();
      if (!s) return;
      const tips = Array.isArray(s.tips) ? s.tips.slice(0, 3) : [];
      tips[i] = !tips[i];
      writeStore({ ...s, tips });
      tip.classList.toggle('on', !!tips[i]);
      tip.setAttribute('aria-pressed', tips[i] ? 'true' : 'false');
      return;
    }
    const ask = t.closest('[data-wf-ask]');
    if (ask) void askNia(ask.dataset.wfAsk || '');
  });
}
