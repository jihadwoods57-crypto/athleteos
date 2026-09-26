/* Dining halls, the staff screens (goals and eating plan, phase C, 2026-09-26).
 *
 *   #dining-halls                    the team's halls, today's state, add a hall
 *   #dining-hall/<hallId>            upload a menu (photos, a PDF, or pasted text), its days, its hours
 *   #dining-day/<hallId>/<date>      review one day: edit, delete and add items; publish; unpublish
 *
 * THE FLOW IS REVIEW BEFORE PUBLISH. An upload is read ONCE by the dining-menu function into DRAFT
 * menus. Staff check them here. Nothing reaches an athlete until Publish (0255 publish_dining_day);
 * a published day is never edited in place: an edit makes a draft copy and athletes keep seeing
 * the published menu until the next Publish. Unpublish takes a day off their screens.
 *
 * WHO. Staff who edit the team's standard (dining-staff-model.js canManageDining, the same list as
 * 0252 can_set_team_phase, which the database enforces on every write). Anyone else who lands here
 * reads, and gets no buttons. Lazy (screens/index.js); nothing here is in the boot graph.
 */
import { RT, invokeWithDeadline } from '../state.js';
import { CD, bookId, loadBook } from '../coach-data.js';
import { backHead, esc, skeletonRows, emptyState, errorState } from '../components.js';
import { icon } from '../icons.js';
import { ensureAiConsent, isConsentSkip, noteAiConsentRequired } from '../ai-consent.js';
import { encodeImageFile } from '../chat-attach.js';
import { base64ToBytes } from '../photo-hash.js';
import {
  PERIOD_KEYS, periodLabel, ITEM_KINDS, DEFAULT_HOURS, cleanMenuItem, cleanMenuText, HALL_NAME_MAX, addDays, MENU_TAGS,
} from '../dining-menu.js';
import {
  canManageDining, fmtDay, hoursLines, hoursForm, hoursFromForm, dayGroups, dayState, DAY_STATE_LABEL, dayPeriods,
  todayLine, shownRow, itemMeta, uploadErrorLine, readResultLine, BLANK_ITEM, dayControls,
  uploadState, resultFromRows, startDateBounds, startDateError, toggleTag,
} from '../dining-staff-model.js';

/* ---------------------------------------------------------------- state (this session only) */
const TTL = 60000;
let DH = {
  team: null, halls: null, hallsAt: 0, err: false,
  today: [],                 // the team's rows for today and ahead (the halls list)
  rows: {}, rowsAt: {},      // hallId -> that hall's rows
  adding: false, addNote: '',
  // One upload form PER HALL (review round): hall Y's Read never touches hall X's upload.
  // pendingId: an upload already filed whose read was refused for now (busy, today's cap, a dropped
  // connection). The next tap asks for THAT upload again instead of uploading the files twice.
  ups: {},
  hoursEdit: null,           // { hallId, name, rows, note }
  edit: null,                // { key: 'lunch:3' | 'lunch:new', note }
  day: { busy: false, note: '', err: false, confirmDiscard: false },
  delHall: false,
};
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const repaint = () => { if (window.__render) window.__render(); };
const manage = () => !!(CD.extras && canManageDining(CD.extras.myRole, CD.caps, CD.kind));
const hallOf = (id) => (DH.halls || []).find((h) => h.id === id) || null;
const BLANK_UP = { kind: 'photo', files: [], text: '', startsOn: '', busy: false, note: '', err: false, pendingId: null };
/** This hall's upload form (made on first use). */
const upFor = (hallId) => { if (!DH.ups[hallId]) DH.ups[hallId] = { ...BLANK_UP }; return DH.ups[hallId]; };
const setUp = (hallId, patch) => { DH.ups[hallId] = { ...upFor(hallId), ...patch }; return DH.ups[hallId]; };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));

if (typeof window !== 'undefined') {
  // Leaving the dining screens drops the half-finished forms (never the loaded data).
  window.addEventListener('hashchange', () => {
    const r = (location.hash || '').slice(1).split('/')[0];
    if (!/^dining-/.test(r)) { DH.adding = false; DH.hoursEdit = null; DH.edit = null; DH.delHall = false; DH.day = { busy: false, note: '', err: false, confirmDiscard: false }; }
  });
}

/* ---------------------------------------------------------------- reads */
async function loadHalls(force) {
  const team = bookId();
  const sb = window.sb;
  if (!team || !sb) return false;
  if (!force && DH.team === team && DH.halls && Date.now() - DH.hallsAt < TTL) return false;
  try {
    const today = localToday();
    const [h, m] = await Promise.all([
      sb.from('dining_halls').select('id, name, hours, created_at').eq('team_id', team).order('created_at'),
      sb.from('dining_menus').select('hall_id, menu_date, period, status').eq('team_id', team).gte('menu_date', today).lte('menu_date', addDays(today, 14)),
    ]);
    if (h.error) throw h.error;
    DH = { ...DH, team, halls: Array.isArray(h.data) ? h.data : [], today: Array.isArray(m.data) ? m.data : [], hallsAt: Date.now(), err: false };
  } catch {
    DH = { ...DH, team, halls: DH.team === team ? DH.halls : null, err: true };
  }
  return true;
}

async function loadRows(hallId, force) {
  const sb = window.sb;
  if (!sb || !hallId) return false;
  if (!force && DH.rows[hallId] && Date.now() - (DH.rowsAt[hallId] || 0) < TTL) return false;
  const today = localToday();
  try {
    const { data, error } = await sb.from('dining_menus')
      .select('id, hall_id, menu_date, period, status, items, updated_at, published_at')
      .eq('hall_id', hallId).gte('menu_date', addDays(today, -1)).lte('menu_date', addDays(today, 45)).order('menu_date');
    if (error) throw error;
    DH.rows = { ...DH.rows, [hallId]: Array.isArray(data) ? data : [] };
    DH.rowsAt = { ...DH.rowsAt, [hallId]: Date.now() };
  } catch { if (!DH.rows[hallId]) DH.rows = { ...DH.rows, [hallId]: null }; }
  return true;
}

/** Make sure the book (and the staff role) is loaded, then the halls; repaint when anything moved. */
function ensure(root, hallId) {
  const go = async () => {
    const a = await loadHalls(false);
    const b = hallId ? await loadRows(hallId, false) : false;
    if ((a || b) && root && root.isConnected !== false) repaint();
  };
  if (!bookId() || !CD.extras) void Promise.resolve(loadBook(false, 'team')).then(go);
  else void go();
}

/* ---------------------------------------------------------------- shared bits */
function gate(title, back) {
  if (!bookId() && CD.kind !== 'team') return `${backHead(title, null, back)}<div class="dh">${skeletonRows(2, 'Loading your team')}</div>`;
  if (CD.kind && CD.kind !== 'team') {
    return `${backHead(title, null, back)}<div class="dh">${emptyState({ icon: 'utensils', title: 'Dining halls are for teams', body: 'A team adds its dining hall menus here.', compact: true })}</div>`;
  }
  return null;
}
function loadingOr(head) {
  if (DH.halls === null && DH.err) return `${head}<div class="dh">${errorState({ title: "Couldn't load your halls", retryId: 'dh-retry' })}</div>`;
  if (DH.halls === null) return `${head}<div class="dh">${skeletonRows(2, 'Loading your halls')}</div>`;
  return null;
}

/* ================================================================ #dining-halls */
function hallRow(h) {
  const rows = DH.today.filter((r) => r.hall_id === h.id);
  return `<button type="button" class="dh-row" data-go="dining-hall/${esc(h.id)}">
    <span class="dh-row-ic">${icon('utensils', 18)}</span>
    <span class="dh-row-b"><span class="dh-row-t">${esc(h.name)}</span><span class="dh-row-s">${esc(todayLine(rows, localToday()))}</span></span>
    ${icon('chevron', 15, 'class="chev-dim"')}
  </button>`;
}

function addHtml() {
  if (!manage()) return '';
  if (!DH.adding) return `<button type="button" class="btn ghost dh-add" id="dh-add">${icon('plus', 16)}Add a hall</button>`;
  return `<form class="dh-card dh-form" id="dh-add-form">
    <label class="dh-lbl" for="dh-name">Hall name</label>
    <input class="dh-in" id="dh-name" name="name" maxlength="${HALL_NAME_MAX}" autocomplete="off" placeholder="The name your athletes use"/>
    <p class="dh-note">It starts with breakfast 7 to 10, lunch 11 to 2 and dinner 5 to 8, every day. Change the hours on the next screen.</p>
    <div class="dh-acts"><button type="button" class="btn ghost" id="dh-add-cancel">Cancel</button><button type="submit" class="btn primary">Add hall</button></div>
    <div class="dh-err" role="status">${esc(DH.addNote)}</div>
  </form>`;
}

export const diningHalls = {
  nav: 'operator', tab: 'home',
  render() {
    const back = 'coach-home';
    const g = gate('Dining halls', back);
    if (g) return g;
    const head = backHead('Dining halls', 'Menus become meal ideas', back);
    const wait = loadingOr(head);
    if (wait) return wait;
    const halls = DH.halls || [];
    return `${head}
    <div class="dh">
      <p class="dh-lead">Upload a hall's menu and check it. Athletes see a menu only after you publish it, as plates that fit their plan.</p>
      ${halls.length ? `<div class="dh-list">${halls.map(hallRow).join('')}</div>`
    : emptyState({ icon: 'utensils', title: 'No dining halls yet', body: manage() ? 'Add the hall your athletes eat at, then upload its menu.' : 'Your nutrition staff add the halls here.', compact: true })}
      ${addHtml()}
    </div>`;
  },
  mount(root) {
    ensure(root, null);
    const box = root.querySelector('.dh');
    if (!box) return;
    box.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      if (t.closest('#dh-retry')) { void loadHalls(true).then(repaint); return; }
      if (t.closest('#dh-add')) { DH.adding = true; DH.addNote = ''; repaint(); const i = document.getElementById('dh-name'); if (i) i.focus(); return; }
      if (t.closest('#dh-add-cancel')) { DH.adding = false; repaint(); }
    });
    box.addEventListener('submit', async (e) => {
      if (!e.target || e.target.id !== 'dh-add-form') return;
      e.preventDefault();
      const name = cleanMenuText(e.target.querySelector('#dh-name').value || '', HALL_NAME_MAX);
      if (!name) { DH.addNote = 'Give the hall a name.'; repaint(); return; }
      const sb = window.sb;
      try {
        const { data, error } = await sb.from('dining_halls').insert({ team_id: bookId(), name, hours: DEFAULT_HOURS }).select('id').maybeSingle();
        if (error || !data) throw error || new Error('no row');
        DH.adding = false;
        await loadHalls(true);
        window.__go(`dining-hall/${data.id}`);
      } catch {
        DH.addNote = (DH.halls || []).length >= 8 ? 'A team can have up to 8 halls.' : "Couldn't add the hall. Check your connection and try again.";
        repaint();
      }
    });
  },
};

/* ================================================================ #dining-hall/<id> */
function uploadHtml(hallId) {
  if (!manage()) return '';
  const U = upFor(hallId);
  const start = U.startsOn || localToday();
  const bounds = startDateBounds(localToday());
  const kinds = [['photo', 'Photos'], ['pdf', 'PDF'], ['text', 'Paste text']];
  const n = U.files.length;
  const picker = U.kind === 'text'
    ? `<label class="dh-lbl" for="dh-text">Menu text</label>
       <textarea class="dh-ta" id="dh-text" maxlength="20000" placeholder="Paste the menu, days and meals included">${esc(U.text)}</textarea>`
    : `<label class="btn ghost dh-pick">${icon(U.kind === 'pdf' ? 'fileText' : 'camera', 17)}${U.kind === 'pdf' ? 'Choose a PDF' : 'Choose photos'}
         <input type="file" class="dh-file" id="dh-file" accept="${U.kind === 'pdf' ? 'application/pdf' : 'image/*'}"${U.kind === 'pdf' ? '' : ' multiple'}/></label>
       <div class="dh-files">${n ? esc(U.kind === 'pdf' ? `${U.files[0].name || 'PDF'} ready` : `${n} photo${n === 1 ? '' : 's'} ready (up to 6)`) : esc(U.kind === 'pdf' ? 'One PDF, up to 10 MB.' : 'Up to 6 photos: a page each.')}</div>`;
  const ready = !U.busy && (!!U.pendingId || (U.kind === 'text' ? U.text.trim().length >= 10 : n > 0));
  return `<h2 class="eyebrow">Upload a menu</h2>
  <section class="dh-card dh-up" data-dh-hall="${esc(hallId)}">
    <div class="dh-seg" role="radiogroup" aria-label="What you are uploading">
      ${kinds.map(([k, l]) => `<button type="button" class="dh-sg${U.kind === k ? ' on' : ''}" role="radio" aria-checked="${U.kind === k ? 'true' : 'false'}" data-dh-kind="${k}"${U.busy ? ' disabled' : ''}>${l}</button>`).join('')}
    </div>
    ${picker}
    <label class="dh-lbl" for="dh-start">Menu starts on</label>
    <input type="date" class="dh-in" id="dh-start" value="${esc(start)}" min="${esc(bounds.min)}" max="${esc(bounds.max)}"${U.busy ? ' disabled' : ''}/>
    <button type="button" class="btn primary dh-go" id="dh-read"${ready ? '' : ' disabled'}>${U.busy ? 'Reading the menu…' : 'Read the menu'}</button>
    <p class="dh-note${U.err ? ' err' : ''}" role="status">${esc(U.note || 'We read each upload once, up to a week of menus. Nothing reaches athletes until you publish.')}</p>
  </section>`;
}

function daysHtml(hallId) {
  const rows = DH.rows[hallId];
  if (rows === undefined) return `<h2 class="eyebrow">Menus</h2>${skeletonRows(2, 'Loading the menus')}`;
  if (rows === null) return `<h2 class="eyebrow">Menus</h2><p class="dh-note err">Couldn't load the menus. Pull to refresh or try again.</p>`;
  const days = dayGroups(rows);
  if (!days.length) return `<h2 class="eyebrow">Menus</h2><p class="dh-empty">No menus yet.${manage() ? ' Upload one above.' : ''}</p>`;
  return `<h2 class="eyebrow">Menus</h2>
  <div class="dh-list">${days.map((g) => {
    const st = dayState(g);
    return `<button type="button" class="dh-row" data-go="dining-day/${esc(hallId)}/${esc(g.date)}">
      <span class="dh-row-b"><span class="dh-row-t">${esc(fmtDay(g.date))}${g.date === localToday() ? ' <span class="dh-today">Today</span>' : ''}</span><span class="dh-row-s">${esc(dayPeriods(g))}</span></span>
      <span class="dh-st ${esc(st)}">${esc(DAY_STATE_LABEL[st])}</span>
      ${icon('chevron', 15, 'class="chev-dim"')}
    </button>`;
  }).join('')}</div>`;
}

function hoursHtml(h) {
  const E = DH.hoursEdit && DH.hoursEdit.hallId === h.id ? DH.hoursEdit : null;
  if (!E) {
    return `<h2 class="eyebrow">Hours</h2>
    <section class="dh-card dh-hours">
      ${hoursLines(h.hours).map((l) => `<div class="dh-hl">${esc(l)}</div>`).join('')}
      <p class="dh-note">A meal is offered to athletes only while its hours are open that day.</p>
      ${manage() ? `<button type="button" class="dh-link" id="dh-hours-edit">${icon('edit', 15)}Edit the hall</button>` : ''}
    </section>`;
  }
  return `<h2 class="eyebrow">Edit the hall</h2>
  <section class="dh-card dh-hedit" id="dh-hedit">
    <label class="dh-lbl" for="dh-hname">Name</label>
    <input class="dh-in" id="dh-hname" maxlength="${HALL_NAME_MAX}" value="${esc(E.name)}"/>
    ${E.rows.map((r) => `<div class="dh-hrow" data-dh-p="${esc(r.period)}">
      <button type="button" class="dh-tog${r.on ? ' on' : ''}" aria-pressed="${r.on ? 'true' : 'false'}" data-dh-on="${esc(r.period)}">${r.on ? icon('check', 14) : ''}${esc(periodLabel(r.period))}</button>
      ${r.on ? `<div class="dh-times"><input type="time" class="dh-in dh-time" aria-label="${esc(`${periodLabel(r.period)} opens`)}" data-dh-from="${esc(r.period)}" value="${esc(r.from)}"/><span>to</span><input type="time" class="dh-in dh-time" aria-label="${esc(`${periodLabel(r.period)} closes`)}" data-dh-to="${esc(r.period)}" value="${esc(r.to)}"/></div>
      <div class="dh-days" role="group" aria-label="${esc(`${periodLabel(r.period)} days`)}">${DAY_LETTERS.map((l, i) => `<button type="button" class="dh-wd${r.days.includes(i) ? ' on' : ''}" aria-pressed="${r.days.includes(i) ? 'true' : 'false'}" aria-label="${DAY_NAMES[i]}" data-dh-day="${esc(r.period)}:${i}"><span class="dh-wd-p">${l}</span></button>`).join('')}</div>` : '<span class="dh-closed">Not served</span>'}
    </div>`).join('')}
    <div class="dh-acts"><button type="button" class="btn ghost" id="dh-hours-cancel">Cancel</button><button type="button" class="btn primary" id="dh-hours-save">Save</button></div>
    <div class="dh-err" role="status">${esc(E.note || '')}</div>
    <button type="button" class="dh-link danger" id="dh-del-hall">${icon('trash', 15)}${DH.delHall ? 'Tap again to delete this hall and its menus' : 'Delete this hall'}</button>
  </section>`;
}

export const diningHall = {
  nav: 'operator', tab: 'home',
  render({ sub }) {
    const hallId = String(sub || '').split('/')[0];
    const g = gate('Dining hall', 'dining-halls');
    if (g) return g;
    const wait = loadingOr(backHead('Dining hall', null, 'dining-halls'));
    if (wait) return wait;
    const h = hallOf(hallId);
    if (!h) return `${backHead('Dining hall', null, 'dining-halls')}<div class="dh">${emptyState({ icon: 'utensils', title: 'This hall is gone', body: 'It may have been deleted.', compact: true })}</div>`;
    return `${backHead(h.name, 'Dining hall', 'dining-halls')}
    <div class="dh" data-dh-hall="${esc(h.id)}">
      ${uploadHtml(h.id)}
      ${daysHtml(h.id)}
      ${hoursHtml(h)}
    </div>`;
  },
  mount(root, { sub }) {
    const hallId = String(sub || '').split('/')[0];
    ensure(root, hallId);
    const box = root.querySelector('.dh');
    if (!box) return;
    box.addEventListener('click', (e) => onHallClick(e, hallId));
    box.addEventListener('change', (e) => onHallChange(e, hallId));
    box.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'dh-text') {
        const U = upFor(hallId);
        const before = U.text.trim().length >= 10;
        U.text = e.target.value;
        U.pendingId = null;
        if ((U.text.trim().length >= 10) !== before) { const b = box.querySelector('#dh-read'); if (b) b.disabled = !(U.text.trim().length >= 10) || U.busy; }
      }
      if (e.target && e.target.id === 'dh-hname' && DH.hoursEdit) DH.hoursEdit.name = e.target.value;
    });
  },
};

function onHallChange(e, hallId) {
  const t = e.target;
  if (!t) return;
  const U = upFor(hallId);
  if (t.id === 'dh-file') {
    const files = [...(t.files || [])];
    setUp(hallId, {
      files: U.kind === 'pdf' ? files.slice(0, 1) : files.slice(0, 6),
      pendingId: null,
      note: files.length > 6 && U.kind === 'photo' ? 'The first 6 photos will be read.' : '',
      err: false,
    });
    repaint();
  } else if (t.id === 'dh-start') {
    const err = startDateError(t.value || '', localToday());
    setUp(hallId, { startsOn: t.value || '', pendingId: null, note: err || '', err: !!err });
    if (err) repaint();
  } else if (DH.hoursEdit && (t.dataset.dhFrom || t.dataset.dhTo)) {
    const p = t.dataset.dhFrom || t.dataset.dhTo;
    const r = DH.hoursEdit.rows.find((x) => x.period === p);
    if (r) { if (t.dataset.dhFrom) r.from = t.value; else r.to = t.value; }
  }
}

async function onHallClick(e, hallId) {
  const t = e.target && e.target.closest ? e.target : null;
  if (!t) return;
  const kind = t.closest('[data-dh-kind]');
  if (kind && !upFor(hallId).busy) { setUp(hallId, { kind: kind.dataset.dhKind, files: [], note: '', err: false, pendingId: null }); repaint(); return; }
  if (t.closest('#dh-read')) { await readMenu(hallId); return; }
  if (t.closest('#dh-hours-edit')) {
    const h = hallOf(hallId);
    DH.hoursEdit = { hallId, name: h ? h.name : '', rows: hoursForm(h ? h.hours : []), note: '' };
    DH.delHall = false;
    repaint();
    return;
  }
  if (t.closest('#dh-hours-cancel')) { DH.hoursEdit = null; DH.delHall = false; repaint(); return; }
  const on = t.closest('[data-dh-on]');
  if (on && DH.hoursEdit) {
    const r = DH.hoursEdit.rows.find((x) => x.period === on.dataset.dhOn);
    if (r) { r.on = !r.on; if (r.on && !r.from) { const d = DEFAULT_HOURS.find((x) => x.period === r.period); r.from = d ? d.from : '20:00'; r.to = d ? d.to : '23:00'; } }
    repaint();
    return;
  }
  const day = t.closest('[data-dh-day]');
  if (day && DH.hoursEdit) {
    const [p, i] = day.dataset.dhDay.split(':');
    const r = DH.hoursEdit.rows.find((x) => x.period === p);
    const n = Number(i);
    if (r) r.days = r.days.includes(n) ? r.days.filter((x) => x !== n) : [...r.days, n].sort((a, b) => a - b);
    repaint();
    return;
  }
  if (t.closest('#dh-hours-save') && DH.hoursEdit) {
    const name = cleanMenuText(DH.hoursEdit.name || '', HALL_NAME_MAX);
    const res = hoursFromForm(DH.hoursEdit.rows);
    if (!name) { DH.hoursEdit.note = 'Give the hall a name.'; repaint(); return; }
    if (res.error) { DH.hoursEdit.note = res.error; repaint(); return; }
    const { error } = await window.sb.from('dining_halls').update({ name, hours: res.hours }).eq('id', hallId);
    if (error) { DH.hoursEdit.note = "Couldn't save. Check your connection and try again."; repaint(); return; }
    DH.hoursEdit = null;
    await loadHalls(true);
    repaint();
    return;
  }
  if (t.closest('#dh-del-hall')) {
    if (!DH.delHall) { DH.delHall = true; repaint(); return; }
    const { error } = await window.sb.from('dining_halls').delete().eq('id', hallId);
    if (error) { if (DH.hoursEdit) DH.hoursEdit.note = "Couldn't delete the hall. Try again."; DH.delHall = false; repaint(); return; }
    DH.hoursEdit = null; DH.delHall = false;
    await loadHalls(true);
    window.__go('dining-halls');
  }
}

/** Upload the files (or the text), file the upload row, and ask the function to read it once. The
 *  function answers as soon as it has claimed the upload and reads in the background; this polls the
 *  upload's status until it is parsed or failed. */
async function readMenu(hallId) {
  const U = upFor(hallId);
  const sb = window.sb;
  if (U.busy || !sb) return;
  const fail = (code, keep = null) => { setUp(hallId, { busy: false, err: true, note: uploadErrorLine(code), pendingId: keep }); repaint(); };
  const start = U.startsOn || localToday();
  const dateErr = startDateError(start, localToday());
  if (dateErr) { setUp(hallId, { err: true, note: dateErr }); repaint(); return; }
  // The upload goes to the third-party AI: the uploader's own yes first (0243).
  if (!(await ensureAiConsent(RT.userId, { role: RT.authRole || 'coach', ask: true }))) { fail('ai_consent_required', U.pendingId); return; }
  let id = U.pendingId;
  if (!id) {
    setUp(hallId, { busy: true, err: false, note: 'Uploading…' });
    repaint();
    const team = bookId();
    id = uuid();
    const paths = [];
    try {
      if (U.kind === 'photo') {
        for (const [i, f] of U.files.slice(0, 6).entries()) {
          // Menus are text: a larger long edge than a meal photo so small print stays readable.
          const { base64 } = await encodeImageFile(f, 1800, 0.85);
          const path = `${team}/${id}/${i}.jpg`;
          const { error } = await sb.storage.from('dining-menus').upload(path, base64ToBytes(base64), { contentType: 'image/jpeg', upsert: false });
          if (error) throw error;
          paths.push(path);
        }
      } else if (U.kind === 'pdf') {
        const f = U.files[0];
        if (!f || f.size > 10 * 1024 * 1024) { fail('too_large'); return; }
        const path = `${team}/${id}/0.pdf`;
        const { error } = await sb.storage.from('dining-menus').upload(path, f, { contentType: 'application/pdf', upsert: false });
        if (error) throw error;
        paths.push(path);
      }
      const row = { id, team_id: team, hall_id: hallId, kind: U.kind, paths, starts_on: start, ...(U.kind === 'text' ? { text_body: U.text.trim().slice(0, 20000) } : {}) };
      const { error } = await sb.from('dining_menu_uploads').insert(row);
      if (error) throw error;
    } catch { fail('upload'); return; }
  }

  setUp(hallId, { busy: true, err: false, note: 'Reading the menu. This can take a minute or two.' });
  repaint();
  const { data, error } = await invokeWithDeadline('dining-menu', { uploadId: id }, 60000);
  if (isConsentSkip(data)) { noteAiConsentRequired(RT.userId); fail('ai_consent_required', id); return; }
  if (error || !data || data.ok !== true) {
    let code = data && data.error;
    try { if (!code && error && error.context && typeof error.context.json === 'function') code = (await error.context.json()).error; } catch { /* no body */ }
    // Refused for now (busy, today's cap) or lost on the way: the same upload is asked again next
    // time, never uploaded twice. Anything else closed the upload: a new one starts fresh.
    const retry = !code || code === 'capacity' || code === 'limit' || code === 'rate_limited';
    if (code === 'already_read') { await loadRows(hallId, true); await loadHalls(true); }
    fail(code || 'read', retry ? id : null);
    return;
  }
  const done = await pollUpload(hallId, id);
  if (done.state === 'failed') { fail(done.error || 'read'); return; }
  await loadRows(hallId, true);
  await loadHalls(true);
  setUp(hallId, {
    files: [], text: '', busy: false, err: false, pendingId: null,
    note: done.state === 'parsed' ? readResultLine(resultFromRows(DH.rows[hallId], id))
      : 'Still reading. The days appear here when it is done; if nothing shows in 10 minutes, upload it again.',
  });
  repaint();
}

/** Poll one upload until it is parsed or failed (a read left parsing past 10 minutes reads as failed),
 *  for up to about three minutes: the function's own model timeout is well inside that. */
async function pollUpload(hallId, id) {
  const sb = window.sb;
  for (let i = 0; i < 60; i++) {
    try {
      const { data } = await sb.from('dining_menu_uploads').select('status, error, claimed_at, entries').eq('id', id).maybeSingle();
      const state = uploadState(data);
      if (state === 'parsed') return { state };
      if (state === 'failed') return { state, error: (data && data.error) || 'read' };
    } catch { /* keep polling */ }
    await pause(3000);
  }
  return { state: 'parsing' };
}

/* ================================================================ #dining-day/<hallId>/<date> */
function itemForm(it, key) {
  const s = it.per_serving || {};
  const num = (k, label) => `<label class="dh-lbl dh-numl">${label}<input class="dh-in" name="${k}" inputmode="numeric" maxlength="4" value="${s[k] != null ? esc(String(s[k])) : ''}"/></label>`;
  return `<form class="dh-iform" data-dh-form="${esc(key)}">
    <label class="dh-lbl">Name<input class="dh-in" name="name" maxlength="60" autocomplete="off" value="${esc(it.name || '')}"/></label>
    <div class="dh-grid2">
      <label class="dh-lbl">Station<input class="dh-in" name="station" maxlength="30" autocomplete="off" value="${esc(it.station || '')}"/></label>
      <label class="dh-lbl">Part of the plate<select class="dh-in" name="kind">${ITEM_KINDS.map((k) => `<option value="${k.key}"${it.kind === k.key ? ' selected' : ''}>${k.label}</option>`).join('')}</select></label>
    </div>
    <div class="dh-grid4">${num('protein', 'Protein g')}${num('kcal', 'Calories')}${num('carbs', 'Carbs g')}${num('fat', 'Fat g')}</div>
    <p class="dh-note">Estimates for one serving. Leave a figure blank if you don't know it.</p>
    <div class="dh-lbl">Allergens and markers, as printed</div>
    <div class="dh-tags" role="group" aria-label="Allergens and markers">${MENU_TAGS.map((t) => {
      const on = !!(DH.edit && Array.isArray(DH.edit.tags) && DH.edit.tags.includes(t.key));
      return `<button type="button" class="dh-tg${on ? ' on' : ''}${t.covers.length ? ' al' : ''}" aria-pressed="${on ? 'true' : 'false'}" data-dh-tag="${esc(t.key)}">${esc(t.label)}</button>`;
    }).join('')}</div>
    <p class="dh-note">Athletes with a matching allergy or intolerance never see this item.</p>
    <div class="dh-acts">
      ${key.endsWith(':new') ? '' : '<button type="button" class="btn ghost dh-del" data-dh-del>Delete</button>'}
      <button type="button" class="btn ghost" data-dh-cancel>Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div>
    <div class="dh-err" role="status">${esc((DH.edit && DH.edit.note) || '')}</div>
  </form>`;
}

function itemRow(it, key, editable) {
  return `<div class="dh-item">
    <div class="dh-item-b"><div class="dh-item-n">${esc(it.name)}</div><div class="dh-item-m">${esc(itemMeta(it))}</div>${it.tags && it.tags.length ? `<div class="dh-item-t">${esc(it.tags.join(', '))}</div>` : ''}</div>
    ${editable ? `<button type="button" class="dh-edit" data-dh-edit="${esc(key)}" aria-label="${esc(`Edit ${it.name}`)}">${icon('edit', 16)}</button>` : ''}
  </div>`;
}

function dayBanner(st) {
  if (st === 'published') return `<div class="dh-banner live">${icon('checkCircle', 18)}<span>Published. Athletes see plates from this menu in their meal ideas. An edit makes a draft; they keep this menu until you publish again.</span></div>`;
  if (st === 'changes') return `<div class="dh-banner">${icon('info', 18)}<span>Athletes see the published menu. Your changes go live when you publish.</span></div>`;
  return `<div class="dh-banner">${icon('info', 18)}<span>Draft. Athletes don't see this day until you publish it.</span></div>`;
}

export const diningDay = {
  nav: 'operator', tab: 'home',
  render({ sub }) {
    const [hallId, date] = String(sub || '').split('/');
    const back = `dining-hall/${hallId}`;
    const g0 = gate('Menu', back);
    if (g0) return g0;
    const wait = loadingOr(backHead('Menu', null, back));
    if (wait) return wait;
    const h = hallOf(hallId);
    const head = backHead(fmtDay(date) || 'Menu', h ? h.name : 'Dining hall', back);
    const rows = DH.rows[hallId];
    if (rows === undefined) return `${head}<div class="dh">${skeletonRows(3, 'Loading the menu')}</div>`;
    const g = dayGroups(rows || []).find((x) => x.date === date);
    if (!g) return `${head}<div class="dh">${emptyState({ icon: 'utensils', title: 'No menu for this day', body: 'Upload one from the hall screen.', compact: true })}</div>`;
    const st = dayState(g);
    const C = dayControls(g, manage());
    const can = C.edit;
    const periods = PERIOD_KEYS.filter((p) => shownRow(g.periods[p]) || can);
    const body = periods.map((p) => {
      const row = shownRow(g.periods[p]);
      const items = row && Array.isArray(row.items) ? row.items : [];
      const E = DH.edit && DH.edit.key.startsWith(`${p}:`) ? DH.edit : null;
      if (!items.length && !can) return '';
      if (!items.length && !(E && E.key === `${p}:new`)) return '';
      return `<h2 class="eyebrow">${esc(periodLabel(p))}</h2>
      <div class="dh-card dh-items">
        ${items.map((it, i) => (E && E.key === `${p}:${i}` ? itemForm(it, `${p}:${i}`) : itemRow(it, `${p}:${i}`, can))).join('')}
        ${E && E.key === `${p}:new` ? itemForm(BLANK_ITEM, `${p}:new`) : can ? `<button type="button" class="dh-link" data-dh-add="${esc(p)}">${icon('plus', 15)}Add an item</button>` : ''}
      </div>`;
    }).join('');
    // Periods with nothing on them yet: one quiet row of links under the menu, never between meals.
    const empty = can ? periods.filter((p) => {
      const row = shownRow(g.periods[p]);
      return !(row && Array.isArray(row.items) && row.items.length) && !(DH.edit && DH.edit.key === `${p}:new`);
    }) : [];
    const adds = empty.length ? `<div class="dh-addps">${empty.map((p) => `<button type="button" class="dh-link" data-dh-add="${esc(p)}">${icon('plus', 15)}Add ${esc(periodLabel(p).toLowerCase())}</button>`).join('')}</div>` : '';
    const D = DH.day;
    const acts = can ? `<div class="dh-foot">
      ${C.publish ? `<button type="button" class="btn primary" id="dh-publish"${D.busy ? ' disabled' : ''}>Publish this day</button>` : ''}
      ${C.unpublish ? `<button type="button" class="btn ghost" id="dh-unpublish"${D.busy ? ' disabled' : ''}>Unpublish</button>` : ''}
      ${C.discard ? `<button type="button" class="dh-link danger" id="dh-discard"${D.busy ? ' disabled' : ''}>${D.confirmDiscard ? 'Tap again to discard the draft' : st === 'changes' ? 'Discard my changes' : 'Delete this draft'}</button>` : ''}
      <p class="dh-note${D.err ? ' err' : ''}" role="status">${esc(D.note)}</p>
    </div>` : '';
    return `${head}
    <div class="dh dh-day" data-dh-hall="${esc(hallId)}" data-dh-date="${esc(date)}">
      ${dayBanner(st)}
      ${body}
      ${adds}
      ${acts}
    </div>`;
  },
  mount(root, { sub }) {
    const [hallId, date] = String(sub || '').split('/');
    ensure(root, hallId);
    const box = root.querySelector('.dh-day');
    if (!box) return;
    box.addEventListener('click', (e) => onDayClick(e, hallId, date));
    box.addEventListener('submit', (e) => onItemSave(e, hallId, date));
  },
};

function dayOf(hallId, date) { return dayGroups(DH.rows[hallId] || []).find((x) => x.date === date) || null; }

/** The draft row for a period, made from the published one when there is none yet (an edit to a
 *  live day never touches what athletes see until Publish). */
async function ensureDraft(hallId, date, period) {
  const g = dayOf(hallId, date);
  const slot = g && g.periods[period];
  if (slot && slot.draft) return slot.draft;
  const items = slot && slot.published && Array.isArray(slot.published.items) ? slot.published.items : [];
  const { data, error } = await window.sb.from('dining_menus')
    .insert({ hall_id: hallId, team_id: bookId(), menu_date: date, period, status: 'draft', items })
    .select('id, hall_id, menu_date, period, status, items').maybeSingle();
  if (error || !data) return null;
  DH.rows[hallId] = [...(DH.rows[hallId] || []), data];
  return data;
}

async function saveItems(hallId, date, period, items) {
  const row = await ensureDraft(hallId, date, period);
  if (!row) return false;
  const { error } = await window.sb.from('dining_menus').update({ items }).eq('id', row.id);
  if (error) return false;
  DH.rows[hallId] = (DH.rows[hallId] || []).map((r) => (r.id === row.id ? { ...r, items } : r));
  return true;
}

async function onItemSave(e, hallId, date) {
  const form = e.target && e.target.closest ? e.target.closest('[data-dh-form]') : null;
  if (!form) return;
  e.preventDefault();
  const [period, idx] = form.dataset.dhForm.split(':');
  const f = (n) => { const el = form.querySelector(`[name="${n}"]`); return el ? el.value : ''; };
  const numOrNull = (v) => (String(v).trim() === '' ? null : Number(v));
  const g = dayOf(hallId, date);
  const cur = [...(((shownRow(g && g.periods[period]) || {}).items) || [])];
  const it = cleanMenuItem({
    name: f('name'), station: f('station'), kind: f('kind'),
    per_serving: { protein: numOrNull(f('protein')), kcal: numOrNull(f('kcal')), carbs: numOrNull(f('carbs')), fat: numOrNull(f('fat')) },
    // The chips staff set: the allergy filter reads them, so they are the vocabulary's words only.
    tags: DH.edit && Array.isArray(DH.edit.tags) ? DH.edit.tags : [],
  });
  if (!DH.edit) return;
  if (!it) { DH.edit.note = 'Give the item a name.'; repaint(); return; }
  if (idx === 'new') cur.push(it); else cur[Number(idx)] = it;
  const ok = await saveItems(hallId, date, period, cur);
  if (!ok) { if (DH.edit) DH.edit.note = "Couldn't save. Check your connection and try again."; repaint(); return; }
  DH.edit = null;
  DH.day = { ...DH.day, note: '', err: false, confirmDiscard: false };
  repaint();
}

async function onDayClick(e, hallId, date) {
  const t = e.target && e.target.closest ? e.target : null;
  if (!t) return;
  const ed = t.closest('[data-dh-edit]');
  if (ed) {
    const [p, i] = ed.dataset.dhEdit.split(':');
    const g = dayOf(hallId, date);
    const it = (((shownRow(g && g.periods[p]) || {}).items) || [])[Number(i)] || {};
    DH.edit = { key: ed.dataset.dhEdit, note: '', tags: Array.isArray(it.tags) ? it.tags.slice() : [] };
    repaint();
    return;
  }
  const add = t.closest('[data-dh-add]');
  if (add) { DH.edit = { key: `${add.dataset.dhAdd}:new`, note: '', tags: [] }; repaint(); return; }
  // A tag chip toggles in place: a repaint would throw away what is typed in the form.
  const tg = t.closest('[data-dh-tag]');
  if (tg && DH.edit) {
    DH.edit.tags = toggleTag(DH.edit.tags, tg.dataset.dhTag);
    const on = DH.edit.tags.includes(tg.dataset.dhTag);
    tg.classList.toggle('on', on);
    tg.setAttribute('aria-pressed', on ? 'true' : 'false');
    return;
  }
  if (t.closest('[data-dh-cancel]')) { DH.edit = null; repaint(); return; }
  if (t.closest('[data-dh-del]') && DH.edit) {
    const [period, idx] = DH.edit.key.split(':');
    const g = dayOf(hallId, date);
    const cur = [...(((shownRow(g && g.periods[period]) || {}).items) || [])];
    cur.splice(Number(idx), 1);
    const ok = await saveItems(hallId, date, period, cur);
    if (!ok) { DH.edit.note = "Couldn't delete it. Try again."; repaint(); return; }
    DH.edit = null;
    repaint();
    return;
  }
  const sb = window.sb;
  const busy = async (fn, doneNote) => {
    DH.day = { busy: true, note: '', err: false, confirmDiscard: false };
    repaint();
    const ok = await fn();
    await loadRows(hallId, true);
    await loadHalls(true);
    DH.day = { busy: false, note: ok ? doneNote : "Couldn't save that. Check your connection and try again.", err: !ok, confirmDiscard: false };
    repaint();
  };
  if (t.closest('#dh-publish')) {
    await busy(async () => { const { error } = await sb.rpc('publish_dining_day', { p_hall: hallId, p_date: date }); return !error; },
      'Published. Athletes on your team see it now.');
    return;
  }
  if (t.closest('#dh-unpublish')) {
    await busy(async () => { const { error } = await sb.rpc('unpublish_dining_day', { p_hall: hallId, p_date: date }); return !error; },
      'Unpublished. Athletes no longer see this day.');
    return;
  }
  if (t.closest('#dh-discard')) {
    if (!DH.day.confirmDiscard) { DH.day = { ...DH.day, confirmDiscard: true }; repaint(); return; }
    await busy(async () => {
      const { error } = await sb.from('dining_menus').delete().eq('hall_id', hallId).eq('menu_date', date).eq('status', 'draft');
      return !error;
    }, 'The draft is gone.');
  }
}

/* Tests and the screenshot harness only. */
export function _seedDining({ team, halls, today = [], rows = {}, ups, edit = null, hoursEdit = null } = {}) {
  DH = { ...DH, team: team || bookId(), halls, hallsAt: Date.now(), err: false, today, rows, rowsAt: Object.fromEntries(Object.keys(rows).map((k) => [k, Date.now()])), edit, hoursEdit };
  if (ups) for (const [h, u] of Object.entries(ups)) DH.ups[h] = { ...BLANK_UP, ...u };
}
