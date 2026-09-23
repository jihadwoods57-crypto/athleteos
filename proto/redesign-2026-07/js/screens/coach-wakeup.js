/* OnStandard — Roll call composer (0211).
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
import { DAYS_LONG } from '../fmt-date.js';
import { track, EVENTS } from '../analytics.js';
import { backHead, esc } from '../components.js';
import { CD, bookId } from '../coach-data.js';
import { ensureBook } from './coach-connected.js';
import { allowedCreateKeys, isReadonly } from '../staff-access.js';
import { fmtMin } from '../requirements.js';
import { loadCommitments, saveCommitment, loadBoard, todayISO } from '../commitment-data.js';
import { ROLLCALL_OFF } from '../commitments.js';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOW_FULL = DAYS_LONG;
/* Exported for the rebuilt setup (rollcall-setup.js), which asks the same window questions. */
export const GRACES = [0, 2, 5, 10, 15];
export const CLOSE_CHOICES = [15, 30, 45, 60];
export const CLOSE_DEFAULT_MIN = 30;

/* Writing prompts, NOT defaults. See the header. */
export const PRESETS = [
  'Everyone up and ready to go?',
  'Good morning. Check in and get your day started.',
  'Roll call. Let’s attack the day.',
];

export const canSchedule = () => {
  if (CD.kind === 'practice') return true;
  const role = CD.extras ? CD.extras.myRole : null;
  if (!CD.extras) return true;
  return !isReadonly(role) && allowedCreateKeys(role).includes('commitments');
};

/* The draft. `null` = start clean. editWakeup() loads a saved row. */
let DRAFT = null;
const blank = () => ({
  id: null, title: 'Roll call', message: '', action_label: '',
  audience_kind: 'team', audience_value: null,
  repeat_days: [1, 2, 3, 4, 5], starts_min: 360, grace_min: 5, close_after_min: CLOSE_DEFAULT_MIN,
  escalation: { breakthrough: true, notify_coach_on_miss: true, alarm: true },
  active: true, more: false,
});

/** Load a saved morning_roll_call row into this composer. Exported for the manage screen. */
export function editWakeup(row) {
  const grace = (typeof row.respond_by_min === 'number' && typeof row.starts_min === 'number')
    ? Math.max(0, row.respond_by_min - row.starts_min) : 5;
  DRAFT = {
    ...blank(),
    id: row.id, title: row.title || 'Roll call', message: row.message || '',
    action_label: row.action_label || '',
    audience_kind: row.audience_kind || 'team', audience_value: row.audience_value || null,
    repeat_days: Array.isArray(row.repeat_days) ? row.repeat_days.map(Number) : [],
    starts_min: typeof row.starts_min === 'number' ? row.starts_min : 360,
    grace_min: grace,
    close_after_min: typeof row.ends_min === 'number' ? Math.max(grace, row.ends_min - row.starts_min) : CLOSE_DEFAULT_MIN,
    // `alarm` absent means the wake-up predates the switch, and 0234 resolves that to TRUE
    // server-side. Reading it as anything else here would show a coach an OFF switch for an alarm
    // that is in fact ringing.
    escalation: {
      ...((row.escalation && typeof row.escalation === 'object') ? row.escalation : {}),
      alarm: !(row.escalation && row.escalation.alarm === false),
    },
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

export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const minOf = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v || ''); return m ? Math.min(1439, +m[1] * 60 + +m[2]) : null; };

export const daysLabel = (days) => {
  const d = (days || []).map(Number).sort();
  if (!d.length) return 'No days picked';
  if (d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Monday to Friday';
  if (d.join() === '0,6') return 'Weekends';
  return d.map((n) => DOW_FULL[n].slice(0, 3)).join(', ');
};

/* The recurrence, and only the recurrence. This replaces previewLine(), which said the recurrence
   AND the whole window in one sentence. As a header subtitle that was three lines of prose
   restating the window strip a thumb below it, which moves the repetition rather than removing it
   (founder audit 2026-09-14). The window is drawn now; the header says when it repeats. */
export function scheduleLine(d) {
  const who = d.audience_label || (CD.kind === 'practice' ? 'all clients' : 'the whole team');
  return `${daysLabel(d.repeat_days)} at ${fmtMin(d.starts_min)}, ${who}.`;
}

/* THE WINDOW, AS THREE BEATS, drawn once instead of narrated under two separate fields and then
   again in the header. Same clock arithmetic the server enforces: starts / starts+grace /
   starts+max(grace, close_after). */
export function windowCells(d) {
  const grace = Math.max(0, Number(d.grace_min) || 0);
  const closeAfter = d.close_after_min == null ? CLOSE_DEFAULT_MIN : d.close_after_min;
  const close = d.starts_min + Math.max(grace, closeAfter);
  return [
    { at: fmtMin(d.starts_min), label: 'On standard', tone: 'g' },
    { at: fmtMin(d.starts_min + grace), label: grace ? 'Late from' : 'Late after', tone: 'a' },
    { at: fmtMin(close), label: 'Missed at', tone: 'r' },
  ];
}

/** The same three beats as one sentence, for the strip's screen-reader name. */
export function windowLabel(d) {
  const c = windowCells(d);
  return `On standard at ${c[0].at}, late from ${c[1].at}, missed at ${c[2].at}.`;
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
    title: (d.title || '').trim() || 'Roll call',
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
  /* RETIRED (roll call rebuilt, 2026-09-23): one way in, rollcall-new. Kept as a route so an old
     link still lands; the router asks this before painting, so nothing of this screen shows. */
  redirect() { return ROLLCALL_OFF ? 'coach-home' : 'rollcall-new'; },
  render() { if (ROLLCALL_OFF) return ''; newWakeup(); return ''; },
  // Switched off (see ROLLCALL_OFF): the menu entry that led here is gone, so the only way in is
  // a restored hash or an old deep link. Send those home rather than into a composer whose save
  // the server would refuse.
  mount() { location.replace(ROLLCALL_OFF ? '#coach-home' : '#rollcall-new'); },
};

/** The whole composer, replaced by one honest screen while the feature is off. */
function switchedOffScreen(back) {
  return `${backHead('Roll call', 'Switched off', back)}
  <div class="sidebox">
    <div class="req-icon b s38">${icon('sun', 17)}</div>
    <div><div class="tt">The Roll call is off right now</div>
    <div class="ts">Nobody is being asked to check in, and no morning notifications are going out. Every roll call you already ran is kept exactly as it was recorded. This screen comes back when the roll call does.</div></div>
  </div>`;
}

const field = (label, control, hint) => `
  <div class="wk-field">
    <div class="wk-l">${label}</div>
    ${control}
    ${hint ? `<div class="ts wk-hint">${hint}</div>` : ''}
  </div>`;

export const coachWakeupEdit = {
  nav: 'operator', tab: 'home', transient: true,
  /* RETIRED (roll call rebuilt, 2026-09-23): the rebuilt setup edits a roll call by id. A draft
     loaded by editWakeup carries that id; with none this was always a new roll call. Switched off,
     the honest switched-off screen below still renders. */
  redirect() {
    if (ROLLCALL_OFF) return null;
    return DRAFT && DRAFT.id ? `rollcall-new/${DRAFT.id}` : 'rollcall-new';
  },
  render() {
    const back = CD.kind === 'practice' ? 'trainer' : 'coach-home';
    if (ROLLCALL_OFF) return switchedOffScreen(back);
    if (!canSchedule()) {
      return `${backHead('Roll call', 'Not available for your role', back)}
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
    ${backHead(editing ? 'Edit roll call' : 'Roll call', scheduleLine({ ...d, audience_label: audLabel }), back)}

    ${/* WHAT LANDS ON THEIR PHONE, FIRST (founder audit 2026-09-14).
          This screen used to open on a time picker and describe the alarm in a five line
          paragraph two thirds of the way down, next to a single chip that looked exactly like
          "5 min". The alarm is the loudest thing this product does: it rings through a Sleep
          Focus at 5 AM. It leads now, it is a real switch (the one boolean control in
          DESIGN.md, not a group of one chip), and the paragraph is replaced by the thing it was
          describing. The button words live here too, beside the button they label, instead of
          under a fold that the old help text quoted without being able to reach. */''}
    <h2 class="eyebrow" id="wk-lands-l">How it lands</h2>
    <section class="card pad wk-lands">
      <div class="std-switch-row" role="switch" tabindex="0" aria-checked="${d.escalation.alarm ? 'true' : 'false'}" aria-label="Ring as an alarm" aria-describedby="wk-alarm-sub" data-esc="alarm">
        <div class="std-sw-m">
          <div class="std-sw-t">Ring as an alarm</div>
          <div class="std-sw-s" id="wk-alarm-sub">${d.escalation.alarm
            ? `Rings through silent mode, Do Not Disturb and a Sleep Focus. Needs a phone with alarm support (iOS 26.1 or later); anyone else gets the notification.`
            : 'A notification only, so it stays quiet on silent or in a Sleep Focus, which is most phones at 5 AM.'}</div>
        </div>
        <div class="std-switch ${d.escalation.alarm ? 'on' : ''}" aria-hidden="true"></div>
      </div>

      ${/* The preview is live: the three inputs below write straight into it on `input`, with no
            re-render, so the coach watches their own words land on the face they will land on. */''}
      <div class="wk-phone ${d.escalation.alarm ? 'is-alarm' : ''}" aria-hidden="true">
        <div class="wk-ph-k">${d.escalation.alarm ? 'Alarm' : 'Notification'}</div>
        <div class="wk-ph-clock">${esc(fmtMin(d.starts_min))}</div>
        <div class="wk-ph-t" id="wk-ph-t">${esc((d.title || '').trim() || 'Roll call')}</div>
        <div class="wk-ph-m" id="wk-ph-m">${esc((d.message || '').trim() || 'No message yet. It goes out with the time only.')}</div>
        <div class="wk-ph-b" id="wk-ph-b">${esc((d.action_label || '').trim() || 'I’m Up')}</div>
      </div>

      <div class="wk-field wk-field-flush">
        <div class="wk-l">Button words</div>
        <input class="ob-input" id="wk-action" aria-label="Button words" maxlength="24" value="${esc(d.action_label)}" placeholder="I’m Up" />
        <div class="ts wk-hint">The one thing they tap: on the alarm, on the lock screen and in the app.</div>
      </div>
    </section>

    ${/* THE WINDOW IS SHOWN, NOT NARRATED. Grace was a field up here and Closes was under the
          fold, and each one's hint quoted the other's number while the summary line said both
          again. Three prose statements of one timeline. Now it is drawn once and the two controls
          that move it sit under it. */''}
    <h2 class="eyebrow">The window</h2>
    <section class="card pad wk-form">
      ${field('Wake-up time',
        `<input class="ob-input wk-time" id="wk-time" type="time" value="${hhmm(d.starts_min)}" aria-label="Wake-up time" />`)}

      <div class="wk-win" role="img" aria-label="${esc(windowLabel(d))}">
        ${windowCells(d).map((c) => `
        <div class="wk-win-c ${c.tone}">
          <b>${esc(c.at)}</b>
          <span>${esc(c.label)}</span>
        </div>`).join('')}
      </div>

      ${field('Grace period',
        `<div class="wk-chips wk-chips-fit" id="wk-grace" role="radiogroup" aria-label="Grace period">
          ${GRACES.map((g) => `<button class="chip ${d.grace_min === g ? 'on' : ''}" role="radio" aria-checked="${d.grace_min === g ? 'true' : 'false'}" data-grace="${g}">${g === 0 ? 'None' : `${g}m`}</button>`).join('')}
        </div>`)}

      ${field('Closes',
        `<div class="wk-chips wk-chips-fit" id="wk-late" role="radiogroup" aria-label="Closes">
          ${CLOSE_CHOICES.map((v) => `<button class="chip ${d.close_after_min === v ? 'on' : ''}" role="radio" aria-checked="${d.close_after_min === v ? 'true' : 'false'}" data-late="${v}">${v}m</button>`).join('')}
        </div>`,
        'After this, anyone who never answered is Missed, for good.')}
    </section>

    <h2 class="eyebrow">Who and when</h2>
    <section class="card pad wk-form">
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

    <h2 class="eyebrow" id="wk-msg-l">Morning message <span class="opt">· optional</span></h2>
    <section class="card pad">
      <textarea class="ob-input wk-msg" id="wk-msg" aria-labelledby="wk-msg-l" maxlength="1000" rows="5" placeholder="What you’d text the group this morning. It goes out as the roll call, in your name, exactly as written.">${esc(d.message)}</textarea>
      <div class="wk-presets">
        ${PRESETS.map((s, i) => `<button class="chip" data-preset="${i}">${esc(s)}</button>`).join('')}
      </div>
      <div class="ts wk-hint">Tap one to load it and edit it, or write your own. Every scheduled day sends this message. You can change any single day from the board.</div>
    </section>

    <button class="wk-more" id="wk-more" aria-expanded="${d.more ? 'true' : 'false'}">${icon('chevron', 14)} ${d.more ? 'Fewer options' : 'More options'}</button>
    <section class="card pad wk-form" id="wk-more-panel" ${d.more ? '' : 'hidden'}>
      ${field('Title',
        `<input class="ob-input" id="wk-title" aria-label="Title" maxlength="60" value="${esc(d.title)}" placeholder="Roll call" />`,
        `What ${esc(CD.nouns)} see as the heading. The time and your message sit under it.`)}
      ${/* Two booleans, so two switches. They were chips, which DESIGN.md reserves for a choice
            among several; a chip that is really an on/off reads as an unmade selection. */''}
      <div class="wk-l wk-l-group">If they miss it</div>
      <div class="std-switch-row" role="switch" tabindex="0" aria-checked="${d.escalation.breakthrough ? 'true' : 'false'}" aria-label="Tell them they’re late" aria-describedby="wk-bt-sub" data-esc="breakthrough">
        <div class="std-sw-m">
          <div class="std-sw-t">Tell them they’re late</div>
          <div class="std-sw-s" id="wk-bt-sub">A time-sensitive push when the grace period ends. It comes from OnStandard, not from you.</div>
        </div>
        <div class="std-switch ${d.escalation.breakthrough ? 'on' : ''}" aria-hidden="true"></div>
      </div>
      <div class="std-switch-row" role="switch" tabindex="0" aria-checked="${d.escalation.notify_coach_on_miss ? 'true' : 'false'}" aria-label="Tell me who missed" aria-describedby="wk-nm-sub" data-esc="notify_coach_on_miss">
        <div class="std-sw-m">
          <div class="std-sw-t">Tell me who missed</div>
          <div class="std-sw-s" id="wk-nm-sub">One message to you when the grace period ends, with Nudge and Got it on it.</div>
        </div>
        <div class="std-switch ${d.escalation.notify_coach_on_miss ? 'on' : ''}" aria-hidden="true"></div>
      </div>
      <div class="ts wk-hint">Times are in ${esc(tz)}. Everyone on the roll call is judged on that clock, wherever their phone is.</div>
    </section>

    <button class="btn primary" id="wk-save">${icon('check', 19)} ${editing ? 'Save changes' : 'Create roll call'}</button>
    <div id="wk-err" class="ts wk-err" aria-live="polite"></div>
    <div class="wk-gap"></div>`;
  },

  mount(root) {
    // Nothing to wire on the switched-off screen, and no reason to fetch a book for it.
    if (ROLLCALL_OFF) return;
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
      // CAPTURE BEFORE TOGGLING (founder audit 2026-09-14). The alarm branch below re-renders,
      // and render reads d.message. Without this, a coach who typed a morning message and then
      // flipped the alarm watched their message disappear: the textarea was repainted from a
      // draft that had never been read back.
      capture();
      const k = b.getAttribute('data-esc');
      d.escalation = { ...(d.escalation || {}) };
      d.escalation[k] = !d.escalation[k];
      b.setAttribute('aria-checked', d.escalation[k] ? 'true' : 'false');
      // The pill is aria-hidden paint INSIDE the row, so toggling a class on the row would leave
      // it showing the old position. Every one of these also changes copy that quotes its state,
      // so a repaint is the honest answer for all three, not just the alarm.
      if (window.__render) window.__render();
    }));
    /* THE PREVIEW IS LIVE. Title, message and button words write straight into the phone face on
       `input`, with no re-render: a repaint here would steal focus mid-word, and the whole point
       of the preview is watching your own sentence land while you type it. */
    const live = (sel, target, fallback) => {
      const el = root.querySelector(sel);
      const out = root.querySelector(target);
      if (!el || !out) return;
      el.addEventListener('input', () => { out.textContent = el.value.trim() || fallback; });
    };
    live('#wk-title', '#wk-ph-t', 'Roll call');
    live('#wk-msg', '#wk-ph-m', 'No message yet. It goes out with the time only.');
    live('#wk-action', '#wk-ph-b', 'I’m Up');

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
