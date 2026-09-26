/* Lessons and team challenges, the staff screens (goals and eating plan, phase D, 2026-09-26).
 *
 *   #coach-lessons                     the team's assigned lessons with "14 of 22 done"; Assign
 *   #coach-lessons/assign              the same, with the assign sheet open (the Create menu's door)
 *   #coach-lesson-progress/<id>        one assignment: who has finished and who has not (by name)
 *   #coach-challenge                   the team challenge: everyone's days, the count, End
 *   #coach-challenge/new               start one: a habit, a week or two, a goal
 *
 * WHO. Every staffer of the team reads (0256 is_staff_of_team). Only the standards editors
 * (teach-coach.js canTeach, 0252 can_set_team_phase in the database) get Assign, Remove, Start and
 * End; the database refuses anyone else whatever the screen shows. Names are staff-only: the
 * athlete's own app shows the team as a count. Deterministic, no model call. Lazy.
 */
import { CD, bookId, loadBook } from '../coach-data.js';
import { backHead, esc, skeletonRows, emptyState, errorState } from '../components.js';
import { icon } from '../icons.js';
import { overlayOpen } from '../overlay-guard.js';
import { todayISO } from '../roles.js';
import { LESSONS, lessonById, dueLabel } from '../lessons-model.js';
import {
  HABITS, habitTitle, habitRule, defaultRange, rangeLabel, rangeDays, rangeError, goalBounds, teamLine, myLine, trackerStates,
} from '../challenge-model.js';
import { addDays } from '../weekly-focus-model.js';
import { teach, isTeamBook, canTeach, canRead, readLessons, readBoard, dropTeachReads, announce, boardOpen } from '../teach-coach.js';

const repaint = () => { if (window.__render) window.__render(); };
const routeOf = () => (location.hash || '').slice(1).split('/')[0];

let NOTE = { lessons: '', challenge: '' };
let PROG = { id: null, data: undefined, at: 0, confirmRemove: false, busy: false, note: '' };
let SETUP = { habit: 'protein:breakfast', range: 'this', goal: null, busy: false, note: '' };
let END = { confirm: false, busy: false, note: '' };
let SHEET_FOR = null;   // the #coach-lessons/assign visit that already opened its sheet

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const r = routeOf();
    if (r !== 'coach-lessons') { NOTE.lessons = ''; SHEET_FOR = null; }
    if (r !== 'coach-lesson-progress') PROG = { ...PROG, confirmRemove: false, busy: false, note: '' };
    if (r !== 'coach-challenge') { NOTE.challenge = ''; END = { confirm: false, busy: false, note: '' }; SETUP = { ...SETUP, busy: false, note: '' }; }
  });
}

/** Load the book (and the role with it), then run `then`; repaint when anything moved. */
function ensure(then) {
  const go = async () => { if (canRead() && (await then())) repaint(); };
  if (CD.kind === 'team' && !CD.extras) void Promise.resolve(loadBook(false, 'team')).then(go);
  else void go();
}

function teamGate(title, back) {
  if (CD.kind && CD.kind !== 'team') {
    return `${backHead(title, null, back)}<div class="tcl">${emptyState({ icon: 'fileText', title: 'Lessons and challenges are for teams', body: 'A team assigns lessons and runs challenges here.', compact: true })}</div>`;
  }
  if (!isTeamBook() || !CD.extras) return `${backHead(title, null, back)}<div class="tcl">${skeletonRows(2, 'Loading your team')}</div>`;
  return null;
}

const rosterRows = () => (CD.roster && Array.isArray(CD.roster.rows) ? CD.roster.rows : []);
const rooms = () => ((CD.extras && Array.isArray(CD.extras.rooms)) ? CD.extras.rooms : []);
const audienceCount = (roomId) => rosterRows().filter((r) => !roomId || r.roomId === roomId).length;
const audienceLabel = (row) => (row.room_label ? row.room_label : 'Whole team');
const shortDate = (iso) => { const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCDate()}`; };

/* ================================================================ #coach-lessons */
function lessonRowHtml(a) {
  const l = lessonById(a.lesson_id);
  const total = Number(a.total) || 0;
  const done = Math.min(total, Number(a.done) || 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const sub = [audienceLabel(a), a.due_on ? dueLabel(a.due_on, todayISO()) : null].filter(Boolean).join(' · ');
  return `<button type="button" class="tcl-row" data-go="coach-lesson-progress/${esc(a.id)}">
    <span class="tcl-row-b">
      <span class="tcl-row-t">${esc(l ? l.title : a.lesson_id)}</span>
      <span class="tcl-row-s">${esc(sub)}</span>
      <span class="tcl-bar" aria-hidden="true"><i data-pct="${pct}"></i></span>
    </span>
    <span class="tcl-row-n"><b>${esc(`${done} of ${total}`)}</b><span>done</span></span>
  </button>`;
}

export const coachLessons = {
  nav: 'operator', tab: 'home',
  render() {
    const g = teamGate('Lessons', 'coach-home');
    if (g) return g;
    const T = teach();
    const head = backHead('Lessons', '60-second lessons for your team', 'coach-home');
    if (T.lessons === null && T.err) return `${head}<div class="tcl">${errorState({ title: "Couldn't load the lessons", retryId: 'tcl-retry' })}</div>`;
    if (T.lessons === null) return `${head}<div class="tcl">${skeletonRows(3, 'Loading the lessons')}</div>`;
    const editor = canTeach();
    const list = T.lessons;
    return `${head}
    <div class="tcl">
      ${NOTE.lessons ? `<p class="tcl-note" role="status">${icon('checkCircle', 16)}<span>${esc(NOTE.lessons)}</span></p>` : ''}
      ${editor ? `<button type="button" class="btn primary tcl-assign" id="tcl-assign">${icon('plus', 17)}Assign a lesson</button>` : ''}
      ${list.length
    ? `<h2 class="eyebrow">Assigned</h2><div class="tcl-list">${list.map(lessonRowHtml).join('')}</div>`
    : emptyState({ icon: 'fileText', title: 'No lessons assigned yet', body: editor ? 'Pick one of twelve 60-second lessons and send it to the team or one room. Each athlete gets one push.' : 'Your team\'s head coach, coordinator or dietitian assigns lessons here. You will see who has finished them.', compact: true })}
      <h2 class="eyebrow">Every lesson</h2>
      <div class="tcl-list">${LESSONS.map((l) => `<button type="button" class="tcl-row" data-go="coach-lesson/${esc(l.id)}">
        <span class="tcl-row-b"><span class="tcl-row-t">${esc(l.title)}</span><span class="tcl-row-s">${esc(l.summary)}</span></span>
        <span class="tcl-row-p">Preview${icon('chevron', 13)}</span>
      </button>`).join('')}</div>
    </div>`;
  },
  mount(root, { sub } = {}) {
    root.querySelectorAll('.tcl-bar i[data-pct]').forEach((i) => { i.style.width = `${Math.max(0, Math.min(100, Number(i.dataset.pct) || 0))}%`; });
    const retry = root.querySelector('#tcl-retry');
    if (retry) retry.addEventListener('click', () => ensure(() => readLessons(true)));
    const b = root.querySelector('#tcl-assign');
    if (b) b.addEventListener('click', () => openAssign(root, b));
    if (SHEET.open && !document.querySelector('.sheet.lsa-sheet')) openAssign(root, b, true);
    ensure(() => readLessons(false));
    if (sub === 'assign' && canTeach() && SHEET_FOR !== location.hash && !overlayOpen()) {
      SHEET_FOR = location.hash;
      openAssign(root, b);
    }
  },
};

/* ---------------------------------------------------------------- the assign sheet */
let SHEET = { open: false, step: 'pick', lesson: null, room: '', due: null, busy: false, note: '' };
const DUE_CHOICES = [
  { key: null, label: 'No due date' },
  { key: 1, label: 'Tomorrow' },
  { key: 3, label: 'In 3 days' },
  { key: 7, label: 'In a week' },
];

function pickHtml() {
  const assignedTeam = new Set((teach().lessons || []).filter((a) => !a.room_id).map((a) => a.lesson_id));
  return `<div class="grab"></div>
    <div class="sh-title" id="lsa-t">Assign a lesson</div>
    <div class="sh-sub">Twelve lessons, about a minute each. Pick one.</div>
    <div class="lsa-list">
    ${LESSONS.map((l) => `<button type="button" class="sheet-row lsa-row" data-lsa-pick="${esc(l.id)}">
      <span class="si">${icon('fileText', 18)}</span>
      <span class="st"><span class="t">${esc(l.title)}</span><span class="s">${esc(assignedTeam.has(l.id) ? 'Already assigned to the whole team' : l.summary)}</span></span>
      ${icon('chevron', 16)}
    </button>`).join('')}
    </div>
    <button type="button" class="cancel" data-lsa-close>Close</button>`;
}

function detailsHtml() {
  const l = lessonById(SHEET.lesson);
  if (!l) return pickHtml();
  const rs = rooms();
  const who = [{ id: '', label: 'Whole team' }, ...rs.map((r) => ({ id: r.id, label: r.label }))];
  const n = audienceCount(SHEET.room || null);
  const today = todayISO();
  return `<div class="grab"></div>
    <div class="sh-title" id="lsa-t">${esc(l.title)}</div>
    <div class="sh-sub">${esc(l.summary)}</div>
    <div class="lsa-k">Who gets it</div>
    <div class="lsa-chips" role="group" aria-label="Who gets it">
      ${who.map((w) => `<button type="button" class="lsa-chip${(SHEET.room || '') === w.id ? ' on' : ''}" data-lsa-room="${esc(w.id)}" aria-pressed="${(SHEET.room || '') === w.id ? 'true' : 'false'}">${esc(w.label)}</button>`).join('')}
    </div>
    <div class="lsa-k">Due</div>
    <div class="lsa-chips" role="group" aria-label="Due">
      ${DUE_CHOICES.map((d) => `<button type="button" class="lsa-chip${SHEET.due === d.key ? ' on' : ''}" data-lsa-due="${d.key == null ? '' : d.key}" aria-pressed="${SHEET.due === d.key ? 'true' : 'false'}">${esc(d.key > 1 ? `${d.label} (${dueLabel(addDays(today, d.key), today).replace(/^Due /, '')})` : d.label)}</button>`).join('')}
    </div>
    <button type="button" class="btn primary lsa-go" id="lsa-go"${SHEET.busy ? ' disabled' : ''}>${esc(SHEET.busy ? 'Assigning' : `Assign to ${n} athlete${n === 1 ? '' : 's'}`)}</button>
    <p class="lsa-err" id="lsa-err" role="status">${esc(SHEET.note)}</p>
    <div class="lsa-foot">
      <button type="button" class="lsa-link" data-go="coach-lesson/${esc(l.id)}">${icon('eye', 15)}Preview it</button>
      <button type="button" class="lsa-link" data-lsa-back>${icon('back', 15)}Other lessons</button>
    </div>`;
}

function closeAssign(focusBack) {
  SHEET = { ...SHEET, open: false };
  document.querySelectorAll('.lsa-scrim, .sheet.lsa-sheet').forEach((n) => n.remove());
  document.removeEventListener('keydown', onAssignKey);
  window.removeEventListener('hashchange', closeAssignQuiet);
  if (focusBack && typeof focusBack.focus === 'function') { try { focusBack.focus(); } catch { /* gone */ } }
}
function closeAssignQuiet() { closeAssign(null); }
function onAssignKey(e) { if (e.key === 'Escape') closeAssign(document.getElementById('tcl-assign')); }

/* A re-render of the screen (a read landing, the book loading) replaces the DOM the sheet hangs
   in, so the sheet's state lives here and mount() puts an open sheet back exactly where it was. */
function openAssign(root, opener, keep = false) {
  if (!canTeach()) return;
  if (!keep) {
    if (overlayOpen()) return;
    SHEET = { open: true, step: 'pick', lesson: null, room: '', due: null, busy: false, note: '' };
  }
  const host = root.querySelector('.screen') || root;
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim lsa-scrim';
  const sheet = document.createElement('div');
  sheet.className = 'sheet lsa-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'lsa-t');
  host.appendChild(scrim); host.appendChild(sheet);
  const draw = () => { sheet.innerHTML = SHEET.step === 'details' ? detailsHtml() : pickHtml(); };
  draw();
  scrim.addEventListener('click', () => closeAssign(opener));
  document.addEventListener('keydown', onAssignKey);
  window.addEventListener('hashchange', closeAssignQuiet);
  sheet.addEventListener('click', async (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest('[data-lsa-close]')) { closeAssign(opener); return; }
    if (t.closest('[data-lsa-back]')) { SHEET = { ...SHEET, step: 'pick', note: '' }; draw(); return; }
    const pick = t.closest('[data-lsa-pick]');
    if (pick) { SHEET = { ...SHEET, step: 'details', lesson: pick.dataset.lsaPick, note: '' }; draw(); return; }
    const room = t.closest('[data-lsa-room]');
    if (room) { SHEET = { ...SHEET, room: room.dataset.lsaRoom || '', note: '' }; draw(); return; }
    const due = t.closest('[data-lsa-due]');
    if (due) { SHEET = { ...SHEET, due: due.dataset.lsaDue ? Number(due.dataset.lsaDue) : null }; draw(); return; }
    if (t.closest('#lsa-go') && !SHEET.busy) {
      SHEET = { ...SHEET, busy: true, note: '' };
      draw();
      const r = await assignLesson({ team: bookId(), lesson: SHEET.lesson, room: SHEET.room || null, due: SHEET.due ? addDays(todayISO(), SHEET.due) : null });
      if (!r.ok) { SHEET = { ...SHEET, busy: false, note: r.note }; draw(); return; }
      const l = lessonById(SHEET.lesson);
      const n = audienceCount(SHEET.room || null);
      NOTE.lessons = `${l ? l.title : 'The lesson'} is assigned. ${n} athlete${n === 1 ? '' : 's'} will get one push.`;
      closeAssign(null);
      dropTeachReads();
      ensure(() => readLessons(true));
      repaint();
    }
  });
}

/** Save an assignment, then announce it (once). { ok } or { ok: false, note }. */
export async function assignLesson({ team, lesson, room, due }, sb = window.sb) {
  if (!sb || !team || !lessonById(lesson)) return { ok: false, note: "Couldn't assign it. Check your connection and try again." };
  try {
    const { data, error } = await sb.from('lesson_assignments')
      .insert({ team_id: team, lesson_id: lesson, room_id: room || null, due_on: due || null })
      .select('id').single();
    if (error) {
      const dup = error.code === '23505' || /duplicate/i.test(String(error.message || ''));
      return { ok: false, note: dup ? 'That lesson is already assigned to them. Remove it first to assign it again. Athletes are notified once a day at most.' : "Couldn't assign it. Check your connection and try again." };
    }
    if (data && data.id) void announce('lesson', data.id);
    return { ok: true, id: data && data.id };
  } catch { return { ok: false, note: "Couldn't assign it. Check your connection and try again." }; }
}

/* ================================================================ #coach-lesson-progress/<id> */
async function readProgress(id, force) {
  const sb = window.sb;
  if (!sb || !id) return false;
  if (!force && PROG.id === id && PROG.data !== undefined && Date.now() - PROG.at < 60000) return false;
  try {
    const { data, error } = await sb.rpc('lesson_assignment_progress', { p_assignment: id });
    PROG = { ...PROG, id, data: error ? (PROG.id === id ? PROG.data : null) : (data || null), at: Date.now() };
    return true;
  } catch { return false; }
}

function nameList(rows, doneSide) {
  if (!rows.length) return '';
  return `<ul class="tcp-list">${rows.map((r) => `<li class="tcp-li"><span class="tcp-name">${esc(r.name || 'Athlete')}</span>${doneSide ? `<span class="tcp-when">${esc(`Done ${shortDate(r.completed_at)}`)}</span>` : ''}</li>`).join('')}</ul>`;
}

export const coachLessonProgress = {
  nav: 'operator', tab: 'home',
  render({ sub } = {}) {
    const id = String(sub || '').split('/')[0];
    const g = teamGate('Lesson', 'coach-lessons');
    if (g) return g;
    if (PROG.id !== id || PROG.data === undefined) return `${backHead('Lesson', null, 'coach-lessons')}<div class="tcl">${skeletonRows(3, 'Loading who has finished')}</div>`;
    const p = PROG.data;
    if (!p) return `${backHead('Lesson', null, 'coach-lessons')}<div class="tcl">${emptyState({ icon: 'fileText', title: 'This assignment is gone', body: 'It may have been removed.', compact: true })}</div>`;
    const l = lessonById(p.lesson_id);
    const all = Array.isArray(p.athletes) ? p.athletes : [];
    const done = all.filter((a) => a.done);
    const not = all.filter((a) => !a.done);
    const pct = all.length ? Math.round((done.length / all.length) * 100) : 0;
    const sub2 = [p.room_label || 'Whole team', p.due_on ? dueLabel(p.due_on, todayISO()) : null, p.from ? `From ${p.from}` : null].filter(Boolean).join(' · ');
    const editor = canTeach();
    return `${backHead(l ? l.title : 'Lesson', sub2, 'coach-lessons')}
    <div class="tcl">
      <section class="tcp-hero">
        <div class="tcp-big">${esc(`${done.length} of ${all.length}`)}<span>done</span></div>
        <span class="tcl-bar lg" aria-hidden="true"><i data-pct="${pct}"></i></span>
      </section>
      ${not.length ? `<h2 class="eyebrow">Not yet (${not.length})</h2>${nameList(not, false)}` : ''}
      ${done.length ? `<h2 class="eyebrow">Done (${done.length})</h2>${nameList(done, true)}` : ''}
      <div class="tcp-acts">
        ${l ? `<button type="button" class="btn ghost" data-go="coach-lesson/${esc(l.id)}">${icon('eye', 16)}Preview the lesson</button>` : ''}
        ${editor ? (PROG.confirmRemove
    ? `<p class="tcp-confirm">Remove it? Athletes stop seeing it on Home. What they finished stays finished.</p>
           <button type="button" class="btn ghost danger" id="tcp-remove-yes"${PROG.busy ? ' disabled' : ''}>Remove the lesson</button>
           <button type="button" class="btn ghost" id="tcp-remove-no">Keep it</button>`
    : '<button type="button" class="btn ghost danger" id="tcp-remove">Remove this lesson</button>') : ''}
        <p class="lsa-err" role="status">${esc(PROG.note)}</p>
      </div>
    </div>`;
  },
  mount(root, { sub } = {}) {
    const id = String(sub || '').split('/')[0];
    root.querySelectorAll('.tcl-bar i[data-pct]').forEach((i) => { i.style.width = `${Math.max(0, Math.min(100, Number(i.dataset.pct) || 0))}%`; });
    ensure(() => readProgress(id, false));
    const rm = root.querySelector('#tcp-remove');
    if (rm) rm.addEventListener('click', () => { PROG = { ...PROG, confirmRemove: true }; repaint(); });
    const no = root.querySelector('#tcp-remove-no');
    if (no) no.addEventListener('click', () => { PROG = { ...PROG, confirmRemove: false }; repaint(); });
    const yes = root.querySelector('#tcp-remove-yes');
    if (yes) yes.addEventListener('click', async () => {
      PROG = { ...PROG, busy: true }; repaint();
      let ok = false;
      try { const { error, count } = await window.sb.from('lesson_assignments').delete({ count: 'exact' }).eq('id', id); ok = !error && count !== 0; } catch { ok = false; }
      if (!ok) { PROG = { ...PROG, busy: false, note: "Couldn't remove it. Check your connection and try again." }; repaint(); return; }
      PROG = { id: null, data: undefined, at: 0, confirmRemove: false, busy: false, note: '' };
      NOTE.lessons = 'Removed.';
      dropTeachReads();
      location.hash = '#coach-lessons';
    });
  },
};

/* ================================================================ #coach-challenge */
function rangeFor(key, today) {
  if (key === 'next') { const r = defaultRange(addDays(today, 7)); return r; }
  if (key === 'fourteen') return { starts: today, ends: addDays(today, 13) };
  return defaultRange(today);
}

function setupHtml() {
  const today = todayISO();
  const r = rangeFor(SETUP.range, today);
  const gb = goalBounds(r.starts, r.ends);
  const goal = Math.max(gb.min, Math.min(gb.max, SETUP.goal == null ? gb.def : SETUP.goal));
  const err = rangeError(r.starts, r.ends, today);
  const RANGES = [['this', 'This week'], ['next', 'Next week'], ['fourteen', 'The next 14 days']];
  return `${backHead('New team challenge', 'One habit, the whole team', 'coach-home')}
  <div class="tcl tcs">
    <h2 class="eyebrow">The habit</h2>
    <div class="tcs-list" role="radiogroup" aria-label="The habit">
      ${HABITS.map((h) => `<button type="button" class="tcs-opt${SETUP.habit === h.key ? ' on' : ''}" role="radio" aria-checked="${SETUP.habit === h.key ? 'true' : 'false'}" data-tcs-habit="${esc(h.key)}">
        <span class="tcs-radio" aria-hidden="true"></span>
        <span class="tcs-tx"><span class="tcs-t">${esc(h.title)}</span><span class="tcs-s">${esc(h.key === 'snack' ? 'Counts for athletes whose standard includes a snack.' : habitRule(h.key, true, true))}</span></span>
      </button>`).join('')}
    </div>
    <h2 class="eyebrow">When</h2>
    <div class="lsa-chips" role="group" aria-label="When">
      ${RANGES.map(([k, label]) => `<button type="button" class="lsa-chip${SETUP.range === k ? ' on' : ''}" data-tcs-range="${k}" aria-pressed="${SETUP.range === k ? 'true' : 'false'}">${esc(label)}</button>`).join('')}
    </div>
    <p class="tcs-range">${esc(rangeLabel(r.starts, r.ends))}</p>
    <h2 class="eyebrow">The goal</h2>
    <div class="tcs-goal">
      <button type="button" class="tcs-step" id="tcs-minus" aria-label="One day fewer"${goal <= gb.min ? ' disabled' : ''}>−</button>
      <div class="tcs-goal-v" role="status"><b>${esc(String(goal))}</b><span>${esc(`of ${rangeDays(r.starts, r.ends)} days`)}</span></div>
      <button type="button" class="tcs-step" id="tcs-plus" aria-label="One day more"${goal >= gb.max ? ' disabled' : ''}>+</button>
    </div>
    <p class="tcs-note">Everyone's days are counted from what they log, the same way their weekly focus is. Athletes see their own days and how many teammates are on track, never names.</p>
    <button type="button" class="btn primary tcs-go" id="tcs-go"${SETUP.busy || err ? ' disabled' : ''}>${esc(SETUP.busy ? 'Starting' : 'Start the challenge')}</button>
    <p class="lsa-err" role="status">${esc(err || SETUP.note)}</p>
  </div>`;
}

function athleteRow(a, today, goal) {
  const days = trackerStates(a.days, today);
  return `<li class="tcc-row${a.on_track ? ' on' : ''}">
    <div class="tcc-row-top"><span class="tcc-name">${esc(a.name || 'Athlete')}</span><span class="tcc-n">${esc(myLine({ hits: a.hits, goal }).replace(' so far', ''))}</span></div>
    <ol class="tcc-dots" aria-label="${esc(`${a.name || 'Athlete'}: ${a.hits} days hit`)}">${days.map((d) => `<li class="tcc-dot ${d.state}" aria-hidden="true"></li>`).join('')}</ol>
  </li>`;
}

function boardHtml(board, editor) {
  const today = todayISO();
  const c = board.challenge;
  const over = !!board.over;
  const open = boardOpen(board, today);
  const started = c.starts_on <= today;
  const rows = Array.isArray(board.athletes) ? board.athletes : [];
  const inIt = rows.filter((a) => a.eligible).sort((a, b) => (b.hits - a.hits) || String(a.name).localeCompare(String(b.name)));
  const out = rows.filter((a) => !a.eligible);
  const days = rangeDays(c.starts_on, c.ends_on);
  const count = started ? teamLine({ onTrack: board.on_track, total: board.total, over }) : 'Starts soon';
  return `${backHead('Team challenge', rangeLabel(c.starts_on, c.ends_on), 'coach-home')}
  <div class="tcl">
    ${NOTE.challenge ? `<p class="tcl-note" role="status">${icon('checkCircle', 16)}<span>${esc(NOTE.challenge)}</span></p>` : ''}
    <section class="tcc-hero">
      <div class="wf-eb">${esc(over ? 'Team challenge, final' : 'Team challenge')}</div>
      <div class="wf-t">${esc(habitTitle(c.habit))}</div>
      <p class="wf-why">${esc(`${habitRule(c.habit, true, true)} Goal: ${c.goal_days} of ${days} days.`)}</p>
      <div class="tcc-count">${icon('users', 16)}<b>${esc(count)}</b></div>
    </section>
    ${inIt.length ? `<h2 class="eyebrow">Everyone's days</h2><ul class="tcc-list">${inIt.map((a) => athleteRow(a, today, c.goal_days)).join('')}</ul>` : ''}
    ${out.length ? `<p class="tcc-out">${esc(`${out.length} not counted: the habit is not part of their standard, or they joined after these days.`)}</p>` : ''}
    ${editor && open ? (END.confirm
    ? `<p class="tcp-confirm">End it now? Athletes go back to their own weekly focus.</p>
         <button type="button" class="btn ghost danger" id="tcc-end-yes"${END.busy ? ' disabled' : ''}>End the challenge</button>
         <button type="button" class="btn ghost" id="tcc-end-no">Keep it going</button>`
    : '<button type="button" class="btn ghost danger tcc-end" id="tcc-end">End challenge</button>') : ''}
    ${editor && !open ? `<button type="button" class="btn primary" data-go="coach-challenge/new">${icon('target', 17)}Start a new challenge</button>` : ''}
    <p class="lsa-err" role="status">${esc(END.note)}</p>
  </div>`;
}

export const coachChallenge = {
  nav: 'operator', tab: 'home',
  render({ sub } = {}) {
    const g = teamGate('Team challenge', 'coach-home');
    if (g) return g;
    const T = teach();
    const editor = canTeach();
    if (T.board === undefined && T.err) return `${backHead('Team challenge', null, 'coach-home')}<div class="tcl">${errorState({ title: "Couldn't load the challenge", retryId: 'tcc-retry' })}</div>`;
    if (T.board === undefined) return `${backHead('Team challenge', null, 'coach-home')}<div class="tcl">${skeletonRows(3, 'Loading the challenge')}</div>`;
    const open = boardOpen(T.board, todayISO());
    if (sub === 'new' && editor && !open) return setupHtml();
    if (!T.board) {
      return `${backHead('Team challenge', null, 'coach-home')}<div class="tcl">${emptyState({ icon: 'target', title: 'No team challenge yet', body: editor ? 'Pick one habit for the whole team, for a week or two.' : 'Your head coach, coordinator or dietitian starts one here.', action: editor ? { label: 'Start one', go: 'coach-challenge/new' } : null, compact: true })}</div>`;
    }
    return boardHtml(T.board, editor);
  },
  mount(root, { sub } = {}) {
    ensure(() => readBoard(false));
    const retry = root.querySelector('#tcc-retry');
    if (retry) retry.addEventListener('click', () => ensure(() => readBoard(true)));
    root.querySelectorAll('[data-tcs-habit]').forEach((b) => b.addEventListener('click', () => { SETUP = { ...SETUP, habit: b.dataset.tcsHabit, note: '' }; repaint(); }));
    root.querySelectorAll('[data-tcs-range]').forEach((b) => b.addEventListener('click', () => { SETUP = { ...SETUP, range: b.dataset.tcsRange, goal: null, note: '' }; repaint(); }));
    const today = todayISO();
    const r = rangeFor(SETUP.range, today);
    const gb = goalBounds(r.starts, r.ends);
    const cur = () => Math.max(gb.min, Math.min(gb.max, SETUP.goal == null ? gb.def : SETUP.goal));
    const minus = root.querySelector('#tcs-minus');
    if (minus) minus.addEventListener('click', () => { SETUP = { ...SETUP, goal: Math.max(gb.min, cur() - 1) }; repaint(); });
    const plus = root.querySelector('#tcs-plus');
    if (plus) plus.addEventListener('click', () => { SETUP = { ...SETUP, goal: Math.min(gb.max, cur() + 1) }; repaint(); });
    const start = root.querySelector('#tcs-go');
    if (start) start.addEventListener('click', async () => {
      if (SETUP.busy) return;
      SETUP = { ...SETUP, busy: true, note: '' }; repaint();
      const res = await startChallenge({ team: bookId(), habit: SETUP.habit, starts: r.starts, ends: r.ends, goal: cur() });
      if (!res.ok) { SETUP = { ...SETUP, busy: false, note: res.note }; repaint(); return; }
      SETUP = { habit: 'protein:breakfast', range: 'this', goal: null, busy: false, note: '' };
      NOTE.challenge = 'The challenge is on. Everyone on the team gets one push.';
      dropTeachReads();
      await readBoard(true);
      location.hash = '#coach-challenge';
    });
    const end = root.querySelector('#tcc-end');
    if (end) end.addEventListener('click', () => { END = { ...END, confirm: true }; repaint(); });
    const no = root.querySelector('#tcc-end-no');
    if (no) no.addEventListener('click', () => { END = { ...END, confirm: false }; repaint(); });
    const yes = root.querySelector('#tcc-end-yes');
    if (yes) yes.addEventListener('click', async () => {
      const T = teach();
      const id = T.board && T.board.challenge && T.board.challenge.id;
      END = { ...END, busy: true }; repaint();
      let ok = false;
      try { const { data, error } = await window.sb.rpc('end_team_challenge', { p_id: id }); ok = !error && data !== false; } catch { ok = false; }
      if (!ok) { END = { confirm: true, busy: false, note: "Couldn't end it. Check your connection and try again." }; repaint(); return; }
      END = { confirm: false, busy: false, note: '' };
      NOTE.challenge = 'Ended. Athletes are back on their own weekly focus.';
      dropTeachReads();
      await readBoard(true);
      repaint();
    });
  },
};

/** Start a challenge, then announce it (once). { ok } or { ok: false, note }. */
export async function startChallenge({ team, habit, starts, ends, goal }, sb = window.sb) {
  if (!sb || !team) return { ok: false, note: "Couldn't start it. Check your connection and try again." };
  try {
    const { data, error } = await sb.rpc('start_team_challenge', { p_team: team, p_habit: habit, p_starts: starts, p_ends: ends, p_goal: goal });
    if (error) {
      const running = error.code === '23505' || /already running/i.test(String(error.message || ''));
      return { ok: false, note: running ? 'A challenge is already running. End it first.' : "Couldn't start it. Check your connection and try again." };
    }
    if (data) void announce('challenge', data);
    return { ok: true, id: data };
  } catch { return { ok: false, note: "Couldn't start it. Check your connection and try again." }; }
}
