/* OnStandard — Wake-Up Roll Call composer (0211).
   The fast path for the one commitment every coach schedules: a wake-up time, a grace period,
   the days, who, and the morning message. Everything else (button label, when it closes, the
   escalation switches) sits under one "More" fold. It writes the SAME commitments row the
   general composer (coach-commitments.js) writes, with type 'morning_roll_call', so the board,
   the ladder, the lock-screen button and the history all work without knowing this screen exists.

   THE CLOCK (0212). Three instants: OPEN = the wake-up time (opens_min = starts_min: no
   answering at 5:59), GRACE = respond_by_min = starts_min + grace, CLOSE = ends_min =
   starts_min + close_after (30 minutes after the wake-up unless the coach picks another under
   More options). Missed is final at the close. The server enforces the same three windows.

   MESSAGE HONESTY: the presets are writing prompts. Tapping one loads it into the box to edit;
   nothing is saved unless the coach leaves it there. The message is never trimmed or rewritten,
   on this screen or on the notification. */
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { track, EVENTS } from '../analytics.js';
import { backHead, esc } from '../components.js';
import { CD, bookId } from '../coach-data.js';
import { ensureBook } from './coach-connected.js';
import { allowedCreateKeys, isReadonly } from '../staff-access.js';
import { fmtMin } from '../requirements.js';
import { loadCommitments, saveCommitment, loadBoard, todayISO } from '../commitment-data.js';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const GRACES = [0, 2, 5, 10, 15];
const CLOSE_CHOICES = [15, 30, 45, 60];
const CLOSE_DEFAULT_MIN = 30;

/* Writing prompts, NOT defaults. See the header. */
export const PRESETS = [
  'Everyone up and ready to go?',
  'Good morning. Check in and get your day started.',
  'Roll call. Let’s attack the day.',
];

const canSchedule = () => {
  if (CD.kind === 'practice') return true;
  const role = CD.extras ? CD.extras.myRole : null;
  if (!CD.extras) return true;
  return !isReadonly(role) && allowedCreateKeys(role).includes('commitments');
};

/* The draft. `null` = start clean. editWakeup() loads a saved row. */
let DRAFT = null;
const blank = () => ({
  id: null, title: 'Wake-Up Roll Call', message: '', action_label: '',
  audience_kind: 'team', audience_value: null,
  repeat_days: [1, 2, 3, 4, 5], starts_min: 360, grace_min: 5, close_after_min: CLOSE_DEFAULT_MIN,
  escalation: { breakthrough: true, notify_coach_on_miss: true },
  active: true, more: false,
});

/** Load a saved morning_roll_call row into this composer. Exported for the manage screen. */
export function editWakeup(row) {
  const grace = (typeof row.respond_by_min === 'number' && typeof row.starts_min === 'number')
    ? Math.max(0, row.respond_by_min - row.starts_min) : 5;
  DRAFT = {
    ...blank(),
    id: row.id, title: row.title || 'Wake-Up Roll Call', message: row.message || '',
    action_label: row.action_label || '',
    audience_kind: row.audience_kind || 'team', audience_value: row.audience_value || null,
    repeat_days: Array.isArray(row.repeat_days) ? row.repeat_days.map(Number) : [],
    starts_min: typeof row.starts_min === 'number' ? row.starts_min : 360,
    grace_min: grace,
    close_after_min: typeof row.ends_min === 'number' ? Math.max(grace, row.ends_min - row.starts_min) : CLOSE_DEFAULT_MIN,
    escalation: (row.escalation && typeof row.escalation === 'object') ? { ...row.escalation } : {},
    active: row.active !== false,
    // A saved row with anything off the defaults opens with the fold open, so nothing set is hidden.
    more: !!(row.action_label
      || (typeof row.ends_min === 'number' && row.ends_min - row.starts_min !== CLOSE_DEFAULT_MIN)
      || !(row.escalation && row.escalation.breakthrough && row.escalation.notify_coach_on_miss)),
    timezone: row.timezone || null,
  };
}

/** Start a fresh draft. */
export function newWakeup() { DRAFT = null; }

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const minOf = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v || ''); return m ? Math.min(1439, +m[1] * 60 + +m[2]) : null; };

const daysLabel = (days) => {
  const d = (days || []).map(Number).sort();
  if (!d.length) return 'No days picked';
  if (d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Monday to Friday';
  if (d.join() === '0,6') return 'Weekends';
  return d.map((n) => DOW_FULL[n].slice(0, 3)).join(', ');
};

/** The one-line summary under the form: what the athlete will actually experience. */
export function previewLine(d) {
  const dl = d.starts_min + d.grace_min;
  const close = d.starts_min + Math.max(d.grace_min, d.close_after_min == null ? CLOSE_DEFAULT_MIN : d.close_after_min);
  const who = d.audience_label || (CD.kind === 'practice' ? 'all clients' : 'the whole team');
  return `${daysLabel(d.repeat_days)} at ${fmtMin(d.starts_min)} for ${who}. `
    + (d.grace_min > 0
      ? `${fmtMin(d.starts_min)} to ${fmtMin(dl)} is On Standard. Late until ${fmtMin(close)}. Then it’s Missed.`
      : `Only ${fmtMin(d.starts_min)} is On Standard. Late until ${fmtMin(close)}. Then it’s Missed.`);
}

/** Payload for upsert_commitment. Exported so the tests can pin the mapping. */
export function wakeupPayload(d, owner, kind, tz) {
  const grace = Math.max(0, Math.min(120, Number(d.grace_min) || 0));
  const starts = Math.max(0, Math.min(1439, Number(d.starts_min) || 0));
  const respond = Math.min(1439, starts + grace);
  // The close is never before the grace: a 15-minute close with a 15-minute grace closes at the grace.
  const closeAfter = Math.max(grace, Math.min(720, Number(d.close_after_min) || CLOSE_DEFAULT_MIN));
  // Two follow-ups inside the grace: at the time itself (offset = grace) and roughly midway.
  // Zero grace = one push at the time, which is also the deadline.
  const mid = grace >= 2 ? Math.max(1, Math.round(grace * 0.4)) : null;
  const offsets = mid != null && mid < grace ? [grace, mid] : [grace];
  return {
    id: d.id || undefined,
    type: 'morning_roll_call',
    title: (d.title || '').trim() || 'Wake-Up Roll Call',
    message: (d.message || '').trim() || null,
    action_label: (d.action_label || '').trim() || null,
    audience_kind: d.audience_kind, audience_value: d.audience_value || null,
    repeat_days: d.repeat_days,
    starts_min: starts, respond_by_min: respond,
    opens_min: starts,
    ends_min: Math.min(1439, starts + closeAfter),
    location_id: null, arrive_by_min: null, min_dwell_min: null, linked_commitment_id: null,
    reminder_offsets_min: offsets,
    escalation: { ...(d.escalation || {}) },
    active: d.active !== false,
    team_id: kind === 'practice' ? null : owner,
    practice_id: kind === 'practice' ? owner : null,
    timezone: tz,
  };
}

/** The create menu's entry: a data-go route cannot call newWakeup(), so this one-frame screen
 *  clears the draft and replaces itself with the composer. */
export const coachWakeupNew = {
  nav: 'operator', tab: 'home', transient: true,
  render() { newWakeup(); return ''; },
  mount() { location.replace('#coach-wakeup-edit'); },
};

const field = (label, control, hint) => `
  <div class="wk-field">
    <div class="wk-l">${label}</div>
    ${control}
    ${hint ? `<div class="ts wk-hint">${hint}</div>` : ''}
  </div>`;

export const coachWakeupEdit = {
  nav: 'operator', tab: 'home', transient: true,
  render() {
    const back = CD.kind === 'practice' ? 'trainer' : 'coach-home';
    if (!canSchedule()) {
      return `${backHead('Wake-Up Roll Call', 'Not available for your role', back)}
      <div class="sidebox">
        <div class="req-icon b s38">${icon('eye', 17)}</div>
        <div><div class="tt">Scheduling is for the coaching staff</div>
        <div class="ts">You can see the board and every answer for your scope. Ask the head coach if you should be able to schedule too.</div></div>
      </div>`;
    }
    const d = DRAFT || (DRAFT = blank());
    const rooms = (CD.extras && CD.extras.rooms) || [];
    const groups = (CD.extras && CD.extras.groups) || [];
    const audLabel = d.audience_kind === 'room' ? (rooms.find((r) => r.id === d.audience_value) || {}).label
      : d.audience_kind === 'group' ? (groups.find((g) => g.id === d.audience_value) || {}).name : null;
    const tz = d.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    const editing = !!d.id;

    return `
    ${backHead(editing ? 'Edit Wake-Up Roll Call' : 'Wake-Up Roll Call', 'It’s 6:00 AM. Who’s up?', back)}

    <section class="card pad wk-form">
      ${field('Wake-up time',
        `<input class="ob-input wk-time" id="wk-time" type="time" value="${hhmm(d.starts_min)}" aria-label="Wake-up time" />`)}

      ${field('Grace period',
        `<div class="wk-chips" id="wk-grace" role="radiogroup" aria-label="Grace period">
          ${GRACES.map((g) => `<button class="chip ${d.grace_min === g ? 'on' : ''}" role="radio" aria-checked="${d.grace_min === g ? 'true' : 'false'}" data-grace="${g}">${g === 0 ? 'None' : `${g} min`}</button>`).join('')}
        </div>`,
        d.grace_min > 0
          ? `${esc(fmtMin(d.starts_min))} to ${esc(fmtMin(d.starts_min + d.grace_min))} is On Standard. After that is Late.`
          : `Only an answer at ${esc(fmtMin(d.starts_min))} is On Standard.`)}

      ${field('Days',
        `<div class="wk-days" id="wk-days" role="group" aria-label="Days">
          ${DOW.map((n, i) => `<button class="chip ${d.repeat_days.includes(i) ? 'on' : ''}" role="checkbox" aria-checked="${d.repeat_days.includes(i) ? 'true' : 'false'}" aria-label="${DOW_FULL[i]}" data-day="${i}">${n}</button>`).join('')}
        </div>`)}

      ${field('Who',
        `<div class="wk-chips" id="wk-aud" role="radiogroup" aria-label="Who">
          <button class="chip ${d.audience_kind === 'team' ? 'on' : ''}" role="radio" aria-checked="${d.audience_kind === 'team' ? 'true' : 'false'}" data-aud="team">${CD.kind === 'practice' ? 'All clients' : 'Entire team'}</button>
          ${rooms.map((r) => `<button class="chip ${d.audience_kind === 'room' && d.audience_value === r.id ? 'on' : ''}" role="radio" aria-checked="${d.audience_kind === 'room' && d.audience_value === r.id ? 'true' : 'false'}" data-aud="room:${esc(r.id)}">${esc(r.label)}</button>`).join('')}
          ${groups.map((g) => `<button class="chip ${d.audience_kind === 'group' && d.audience_value === g.id ? 'on' : ''}" role="radio" aria-checked="${d.audience_kind === 'group' && d.audience_value === g.id ? 'true' : 'false'}" data-aud="group:${esc(g.id)}">${esc(g.name)}</button>`).join('')}
        </div>`,
        CD.kind === 'practice' ? '' : 'Anyone who joins the team later gets the next one automatically.')}
    </section>

    <h2 class="eyebrow">Morning message <span class="opt">· optional</span></h2>
    <section class="card pad">
      <textarea class="ob-input wk-msg" id="wk-msg" maxlength="1000" rows="5" placeholder="What you’d text the group this morning. It goes out as the roll call, in your name, exactly as written.">${esc(d.message)}</textarea>
      <div class="wk-presets">
        ${PRESETS.map((s, i) => `<button class="chip" data-preset="${i}">${esc(s)}</button>`).join('')}
      </div>
      <div class="ts wk-hint">Tap one to load it and edit it, or write your own. Every scheduled day sends this message. You can change any single day from the board.</div>
    </section>

    <button class="wk-more" id="wk-more" aria-expanded="${d.more ? 'true' : 'false'}">${icon('chevron', 14)} ${d.more ? 'Fewer options' : 'More options'}</button>
    <section class="card pad wk-form" id="wk-more-panel" ${d.more ? '' : 'hidden'}>
      ${field('Title',
        `<input class="ob-input" id="wk-title" maxlength="60" value="${esc(d.title)}" placeholder="Wake-Up Roll Call" />`,
        `What ${esc(CD.nouns)} see as the heading. The time and your message sit under it.`)}
      ${field('Button label',
        `<input class="ob-input" id="wk-action" maxlength="24" value="${esc(d.action_label)}" placeholder="I’m Up" />`,
        'The one thing they tap, on the lock screen and in the app.')}
      ${field('Closes',
        `<div class="wk-chips" id="wk-late" role="radiogroup" aria-label="Closes">
          ${CLOSE_CHOICES.map((v) => `<button class="chip ${d.close_after_min === v ? 'on' : ''}" role="radio" aria-checked="${d.close_after_min === v ? 'true' : 'false'}" data-late="${v}">${v} min after</button>`).join('')}
        </div>`,
        `Late check-ins count until ${esc(fmtMin(d.starts_min + Math.max(d.grace_min, d.close_after_min)))}. Then the roll call closes and anyone who never answered is Missed, for good.`)}
      ${field('If they miss it',
        `<div class="wk-chips" id="wk-esc" role="group" aria-label="If they miss it">
          <button class="chip ${d.escalation.breakthrough ? 'on' : ''}" role="checkbox" aria-checked="${d.escalation.breakthrough ? 'true' : 'false'}" data-esc="breakthrough">Tell them they’re late</button>
          <button class="chip ${d.escalation.notify_coach_on_miss ? 'on' : ''}" role="checkbox" aria-checked="${d.escalation.notify_coach_on_miss ? 'true' : 'false'}" data-esc="notify_coach_on_miss">Tell me who missed</button>
        </div>`,
        `The late push is time-sensitive and comes from OnStandard, not from you. "Tell me who missed" is one message to you when the grace period ends, with Nudge and Got it on it.`)}
      <div class="ts wk-hint">Times are in ${esc(tz)}. Everyone on the roll call is judged on that clock, wherever their phone is.</div>
    </section>

    <div class="wk-preview">${icon('clock', 14)} <span id="wk-preview">${esc(previewLine({ ...d, audience_label: audLabel }))}</span></div>

    <button class="btn green" id="wk-save">${icon('check', 19)} ${editing ? 'Save changes' : 'Create Roll Call'}</button>
    <div id="wk-err" class="ts wk-err" aria-live="polite"></div>
    <div class="ts wk-foot">${esc(CD.nouns.charAt(0).toUpperCase() + CD.nouns.slice(1))} get a lock-screen push at ${esc(fmtMin(d.starts_min))} with one button. You see who’s up live on the board.</div>`;
  },

  mount(root) {
    ensureBook();
    const id = bookId();
    if (id) {
      loadCommitments(id, CD.kind).then((rows) => { RT.vcCommitments = rows; });
    }
    const d = DRAFT || (DRAFT = blank());
    const val = (sel) => { const el = root.querySelector(sel); return el ? el.value : ''; };
    const capture = () => {
      const err = root.querySelector('#wk-err'); if (err) err.textContent = '';
      const t = minOf(val('#wk-time')); if (t != null) d.starts_min = t;
      d.message = val('#wk-msg');
      if (root.querySelector('#wk-title')) d.title = val('#wk-title').trim();
      if (root.querySelector('#wk-action')) d.action_label = val('#wk-action').trim();
    };
    // The time field repaints on CHANGE, not on every keystroke, so typing never loses focus.
    const time = root.querySelector('#wk-time');
    if (time) time.addEventListener('change', () => { capture(); window.__render && window.__render(); });

    root.querySelectorAll('[data-grace]').forEach((b) => b.addEventListener('click', () => {
      capture(); d.grace_min = +b.getAttribute('data-grace'); window.__render && window.__render();
    }));
    root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
      capture();
      const n = +b.getAttribute('data-day');
      d.repeat_days = d.repeat_days.includes(n) ? d.repeat_days.filter((x) => x !== n) : d.repeat_days.concat(n).sort();
      window.__render && window.__render();
    }));
    root.querySelectorAll('[data-aud]').forEach((b) => b.addEventListener('click', () => {
      capture();
      const [kind, value] = b.getAttribute('data-aud').split(':');
      d.audience_kind = kind; d.audience_value = value || null;
      window.__render && window.__render();
    }));
    root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      capture();
      d.message = PRESETS[+b.getAttribute('data-preset')] || d.message;
      window.__render && window.__render();
      const ta = document.querySelector('#wk-msg');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }));
    root.querySelectorAll('[data-late]').forEach((b) => b.addEventListener('click', () => {
      capture();
      d.close_after_min = +b.getAttribute('data-late') || CLOSE_DEFAULT_MIN;
      window.__render && window.__render();
    }));
    root.querySelectorAll('[data-esc]').forEach((b) => b.addEventListener('click', () => {
      const k = b.getAttribute('data-esc');
      d.escalation = { ...(d.escalation || {}) };
      d.escalation[k] = !d.escalation[k];
      b.classList.toggle('on', !!d.escalation[k]);
      b.setAttribute('aria-checked', d.escalation[k] ? 'true' : 'false');
    }));
    const more = root.querySelector('#wk-more');
    if (more) more.addEventListener('click', () => { capture(); d.more = !d.more; window.__render && window.__render(); });

    const save = root.querySelector('#wk-save');
    const sayErr = (m) => { const el = root.querySelector('#wk-err'); if (el) el.textContent = m; };
    if (save) save.addEventListener('click', async () => {
      if (save.disabled) return;
      capture();
      if (!d.repeat_days.length) { sayErr('Pick at least one day.'); return; }
      if (d.audience_kind !== 'team' && !d.audience_value) { sayErr('Pick who this is for.'); return; }
      const owner = bookId();
      if (!owner) { sayErr('Your team isn’t loaded yet. Try again in a moment.'); return; }
      const orig = save.innerHTML;
      save.disabled = true; save.textContent = d.id ? 'Saving…' : 'Creating…';
      const tz = d.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      const newId = await saveCommitment(wakeupPayload(d, owner, CD.kind, tz));
      if (!newId) { save.disabled = false; save.innerHTML = orig; sayErr('Couldn’t save. Check your connection and try again.'); return; }
      track(EVENTS.VC_SCHEDULED, { type: 'morning_roll_call', audience: d.audience_kind, hasLocation: false, wakeup: true, grace: d.grace_min, hasMessage: !!d.message.trim() });
      DRAFT = null;
      RT.vcCommitments = await loadCommitments(owner, CD.kind, true);
      await loadBoard(owner, CD.kind, todayISO(), true);
      location.hash = '#coach-commit-manage';
    });
  },
};
