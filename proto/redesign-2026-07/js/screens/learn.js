/* Learn: the 60-second lessons (goals and eating plan, phase D, 2026-09-26).
 *
 *   #learn                 every lesson, the ones from your coach first, each with a done check
 *   #lesson/<id>           one lesson: tap or swipe through its cards, the quick check, then Done
 *   #coach-lesson/<id>     the same lesson for staff to preview before assigning (nothing recorded)
 *
 * The words come from lessons-content.js, picked for the reader by lessons-model.js: an Intuitive
 * athlete never sees a macro or calorie figure, an athlete under 18 never sees weight talk.
 * OnStandard content, never signed as Nia, no model call. Finishing records a completion through
 * learn-data.js (kept on the phone first, so it is never lost). Lazy (screens/index.js).
 */
import { RT } from '../state.js';
import { DAY } from '../day.js';
import { backHead, esc, emptyState } from '../components.js';
import { icon } from '../icons.js';
import { LESSONS, lessonFor, lessonById, isCorrect, openAssignments, dueLabel, LESSON_MINUTES } from '../lessons-model.js';
import { learning, doneIds, loadLearning, recordCompletion, readerAudience } from '../learn-data.js';

/* ---------------------------------------------------------------- the viewer's place */
/** Where each open lesson is: { id, step, pick }. step 0..cards-1 = a card, cards = the check. */
let VIEW = { id: null, step: 0, pick: null, saved: false };
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const r = (location.hash || '').slice(1).split('/')[0];
    if (r !== 'lesson' && r !== 'coach-lesson') VIEW = { id: null, step: 0, pick: null, saved: false };
  });
}
const repaint = () => { if (window.__render) window.__render(); };
const today = () => String(DAY.date);

/* ================================================================ #learn */
function lessonRow(l, { done, from, due }) {
  const meta = done ? 'Done' : [due, `${LESSON_MINUTES} min`].filter(Boolean).join(' · ');
  return `<button type="button" class="ln-row${done ? ' done' : ''}" data-go="lesson/${esc(l.id)}">
    <span class="ln-row-ic" aria-hidden="true">${done ? icon('check', 16) : icon('fileText', 17)}</span>
    <span class="ln-row-b">
      ${from ? `<span class="ln-row-from">${esc(from)}</span>` : ''}
      <span class="ln-row-t">${esc(l.title)}</span>
      <span class="ln-row-s">${esc(l.summary)}</span>
    </span>
    <span class="ln-row-m${done ? ' ok' : ''}">${esc(meta)}</span>
  </button>`;
}

export const learnList = {
  tab: 'plan',
  render() {
    const done = new Set(doneIds());
    const d = learning();
    const open = d ? openAssignments(d.assignments, [...done]) : [];
    const openIds = new Set(open.map((a) => a.lesson_id));
    const count = LESSONS.filter((l) => done.has(l.id)).length;
    const assigned = open.map((a) => lessonRow(lessonById(a.lesson_id), { done: false, from: `From ${a.from || 'your coach'}`, due: dueLabel(a.due_on, today()) })).join('');
    const rest = LESSONS.filter((l) => !openIds.has(l.id)).map((l) => lessonRow(l, { done: done.has(l.id) })).join('');
    return `${backHead('Learn', '60-second lessons from OnStandard', 'plan')}
    <div class="ln">
      <div class="ln-count" role="status">${icon('checkCircle', 16)}<span>${esc(`${count} of ${LESSONS.length} done`)}</span></div>
      ${assigned ? `<h2 class="eyebrow">From your coach</h2><div class="ln-list">${assigned}</div>` : ''}
      <h2 class="eyebrow">${assigned ? 'All lessons' : 'Lessons'}</h2>
      <div class="ln-list">${rest}</div>
      <p class="ln-foot">General sports nutrition guidance, not medical advice. Your coach, your dietitian and your doctor know your needs best.</p>
    </div>`;
  },
  mount() {
    void loadLearning(false).then((changed) => { if (changed && /^#learn$/.test(location.hash)) repaint(); }, () => {});
  },
};

/* ================================================================ #lesson/<id> */
function place(id) {
  if (VIEW.id !== id) VIEW = { id, step: 0, pick: null, saved: false };
  return VIEW;
}

/** The viewer, shared by the athlete's route and the staff preview. */
function viewerHtml(id, { preview, back }) {
  const aud = preview ? { intuitive: false, minor: false } : readerAudience();
  const l = lessonFor(id, aud);
  if (!l) {
    return `${backHead('Lesson', null, back)}<div class="ln">${emptyState({ icon: 'fileText', title: 'That lesson is not here', body: 'It may have been renamed. Every lesson is in Learn.', action: preview ? null : { label: 'Open Learn', go: 'learn' } })}</div>`;
  }
  const v = place(id);
  const n = l.cards.length;
  const onCheck = v.step >= n;
  const dots = Array.from({ length: n + 1 }, (_, i) => `<i class="lv-dot${i < v.step ? ' past' : i === v.step ? ' on' : ''}"></i>`).join('');
  const sub = onCheck ? 'Quick check' : `${v.step + 1} of ${n}`;
  let body;
  if (!onCheck) {
    body = `<article class="lv-card" id="lv-card" aria-live="polite">
        <p class="lv-text">${esc(l.cards[v.step])}</p>
      </article>
      <div class="lv-nav">
        ${v.step > 0 ? `<button type="button" class="btn ghost" id="lv-prev">${icon('back', 16)}Back</button>` : '<span></span>'}
        <button type="button" class="btn primary" id="lv-next">${v.step === n - 1 ? 'Quick check' : 'Next'}</button>
      </div>`;
  } else {
    const c = l.check;
    const picked = v.pick != null;
    const opts = c.options.map((o, i) => {
      const right = isCorrect(c, i);
      const state = !picked ? '' : right ? ' right' : i === v.pick ? ' wrong' : ' dim';
      const mark = picked && right ? icon('checkCircle', 18) : picked && i === v.pick ? icon('x', 16) : '';
      return `<button type="button" class="lv-opt${state}" data-lv-opt="${i}" aria-pressed="${i === v.pick ? 'true' : 'false'}"${picked ? ' disabled' : ''}><span>${esc(o)}</span>${mark}</button>`;
    }).join('');
    const verdict = !picked ? '' : isCorrect(c, v.pick) ? 'Right.' : 'Not quite.';
    body = `<div class="lv-q" id="lv-q">${esc(c.q)}</div>
      <div class="lv-opts" role="group" aria-labelledby="lv-q">${opts}</div>
      ${picked ? `<p class="lv-why" role="status"><b>${esc(verdict)}</b> ${esc(c.why)}</p>
      <button type="button" class="btn primary lv-done" id="lv-done">Done</button>` : ''}`;
  }
  return `${backHead(l.title, preview ? `Preview · ${sub}` : sub, back)}
    <div class="lv">
      <div class="lv-dots" aria-hidden="true">${dots}</div>
      ${body}
      ${preview ? '<p class="ln-foot">Athletes on Intuitive see the plate instead of figures, and athletes under 18 never see weight talk.</p>' : ''}
    </div>`;
}

function wireViewer(root, id, { preview, back }) {
  const aud = preview ? { intuitive: false, minor: false } : readerAudience();
  const l = lessonFor(id, aud);
  if (!l) return;
  const v = place(id);
  const n = l.cards.length;
  const go = (step) => { v.step = Math.max(0, Math.min(n, step)); repaint(); };
  const next = root.querySelector('#lv-next');
  if (next) next.addEventListener('click', () => go(v.step + 1));
  const prev = root.querySelector('#lv-prev');
  if (prev) prev.addEventListener('click', () => go(v.step - 1));
  // Swipe through the cards: left is next, right is back. Vertical scrolling stays the page's.
  const card = root.querySelector('#lv-card');
  if (card) {
    let x0 = null, y0 = null;
    card.addEventListener('touchstart', (e) => { const t = e.touches && e.touches[0]; if (t) { x0 = t.clientX; y0 = t.clientY; } }, { passive: true });
    card.addEventListener('touchend', (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!t || x0 == null) return;
      const dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      go(dx < 0 ? v.step + 1 : v.step - 1);
    }, { passive: true });
  }
  root.querySelectorAll('[data-lv-opt]').forEach((b) => b.addEventListener('click', () => {
    if (v.pick != null) return;
    v.pick = Number(b.dataset.lvOpt);
    repaint();
  }));
  const done = root.querySelector('#lv-done');
  if (done) done.addEventListener('click', () => {
    if (!preview && !v.saved && v.pick != null) {
      v.saved = true;
      void recordCompletion(id, isCorrect(l.check, v.pick));
    }
    VIEW = { id: null, step: 0, pick: null, saved: false };
    // Back where the lesson was opened from (Home, Learn, the coach's list); the route's fallback
    // when there is no history.
    const b = root.querySelector('.back-head [data-back]');
    if (b) b.click(); else location.hash = `#${back}`;
  });
  armKeys();
}

/* Keyboard: the arrow keys page through the cards. One listener for the session (mount runs on
   every render, so a per-mount listener would stack). */
let KEYS = false;
function armKeys() {
  if (KEYS || typeof document === 'undefined') return;
  KEYS = true;
  document.addEventListener('keydown', (e) => {
    const r = (location.hash || '').slice(1).split('/')[0];
    if (r !== 'lesson' && r !== 'coach-lesson') return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
    const b = e.key === 'ArrowRight' ? document.getElementById('lv-next') : e.key === 'ArrowLeft' ? document.getElementById('lv-prev') : null;
    if (b) b.click();
  });
}

export const lessonView = {
  tab: 'plan',
  render({ sub } = {}) { return viewerHtml(String(sub || ''), { preview: false, back: 'learn' }); },
  mount(root, { sub } = {}) {
    wireViewer(root, String(sub || ''), { preview: false, back: 'learn' });
    if (RT.userId) void loadLearning(false).catch(() => {});
  },
};

export const coachLesson = {
  nav: 'operator', tab: 'home',
  render({ sub } = {}) { return viewerHtml(String(sub || ''), { preview: true, back: 'coach-lessons' }); },
  mount(root, { sub } = {}) { wireViewer(root, String(sub || ''), { preview: true, back: 'coach-lessons' }); },
};
