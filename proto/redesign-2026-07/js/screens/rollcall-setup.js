/* OnStandard: the coach's roll call, rebuilt (Task 10, 2026-09-23).

   Three screens, one module:
     rollcall-new            set one up in four answers: time, days, who, alarm (about 20 seconds)
     rollcall-new/<id>       the same screen, editing a saved roll call
     rollcall-week/<id>      retired (roll call v3): redirects to rollcall/<id>, the coach's one roll
                             call screen (rollcall-hub.js), which carries this week strip now
     rollcall-history/<id>   the last 30 days: team on-time rate, who needs attention, who is reliable

   THE FOUR ANSWERS. Grace (5 minutes), the close (30 minutes) and the morning message have good
   defaults and sit behind one "Change", on a single line that says what they mean ("On standard
   until 6:05 AM, missed at 6:30 AM."). The window arithmetic, the time input, the presets and the
   payload are coach-wakeup.js's own (windowCells, wakeupPayload), so the old composer and this one
   can never write a different 6:05.

   THREE MODES, one segment (DESIGN.md: three options are a segmented control):
     wake     a morning_roll_call with no place: the alarm and I'm Up.
     both     a morning_roll_call with a place and an arrive-by time: up on time, then there.
     arrival  a NON-morning commitment (Practice, Lift, Team meeting or Class) with a place and an
              arrive-by time. No alarm and no I'm Up: walking in is the check-in. It is never a
              morning_roll_call with the alarm off (controller ruling, 2026-09-23): the board, the
              score and the server all key "arrival only" off the type.

   THE PLACE is drawn on the phone's own map (location.js pickPlace, native MapKit) and saved with
   savePlace (100 to 1000 m, the server holds the floor). A binary from before the map picker says
   so in plain words and offers no control that cannot work; saved places stay one tap either way.

   "A different time for a group" is DEFERRED (spec correction 10): one time per morning. The week
   strip moves a morning, cancels it, and undoes either.

   Styles: css/screens.css, the rs- (setup), rw- (week) and rh- (history) blocks. */
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { DAYS_LONG, DAYS_SHORT, MONTHS_SHORT } from '../fmt-date.js';
import { track, EVENTS } from '../analytics.js';
import { backHead, esc, skeletonRows, emptyState, errorState, sayStatus } from '../components.js';
import { CD, bookId } from '../coach-data.js';
import { ensureBook } from './coach-connected.js';
import { fmtMin } from '../requirements.js';
import { tierFor } from '../score-band.js';
import { initialsOf } from '../initials.js';
import { overlayOpen } from '../overlay-guard.js';
import { mapAvailable, mapMissingLine } from '../location.js';
import {
  VC, loadCommitments, loadLocations, saveCommitment, savePlace, loadUpcoming, setInstanceSchedule,
  notifyScheduleChange, loadRollcallHistory, todayISO, shiftISO,
} from '../commitment-data.js';
import { ROLLCALL_OFF, ROLLCALL_MARK, isRollcall } from '../commitments.js';
import {
  wakeupPayload, windowCells, windowLabel, hhmm, minOf, daysLabel, canSchedule,
  GRACES, CLOSE_CHOICES, CLOSE_DEFAULT_MIN, PRESETS,
} from './coach-wakeup.js';
import { tellAthletesNow } from '../rollcall-v3-data.js';

/* ---------------------------------------------------------------- the model */

/** What an arrival-only roll call is, in the coach's words. Practice is the default. */
export const ARRIVAL_KINDS = [
  { type: 'practice', label: 'Practice' },
  { type: 'strength', label: 'Lift' },
  { type: 'team_meeting', label: 'Team meeting' },
  { type: 'class', label: 'Class' },
];
const MODES = [
  { k: 'wake', label: 'Wake-up', cap: 'An alarm and one tap: I’m Up.' },
  { k: 'arrival', label: 'Arrival', cap: 'Walking in is the check-in. No alarm.' },
  { k: 'both', label: 'Both', cap: 'Up on time, then at the place.' },
];
const MODE_KEYS = MODES.map((m) => m.k);
const ARRIVAL_GRACES = [0, 5, 10, 15];
const ARRIVAL_GRACE_DEFAULT = 10;
const ARRIVAL_DEFAULT_MIN = 930;      // 3:30 PM, an afternoon practice
const BOTH_GAP_MIN = 45;              // up at 6:00, at the weight room by 6:45
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/* The mark this screen leaves on every roll call it writes (upsert_commitment stores `escalation`
   as given, unknown keys included). A Practice with a place made in the general composer carries
   its own close, dwell, link and reminders; this screen must never claim it and write over them. */
export { ROLLCALL_MARK };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const isMin = (v) => typeof v === 'number' && isFinite(v);
const arrivalType = (t) => (ARRIVAL_KINDS.some((k) => k.type === t) ? t : 'practice');
const placeName = (d) => String((d.place && d.place.name) || '').trim();

/** A fresh setup: 6:00 AM, Monday to Friday, the whole team, the alarm on. */
export function blankSetup() {
  return {
    id: null, mode: 'wake', arrival_type: 'practice',
    title: '', saved_title: '', message: '', action_label: '',
    audience_kind: 'team', audience_value: null,
    repeat_days: [1, 2, 3, 4, 5], starts_min: 360, grace_min: 5, close_after_min: CLOSE_DEFAULT_MIN,
    escalation: { breakthrough: true, notify_coach_on_miss: true, alarm: true },
    location_id: null, place: null, arrive_by_min: null, arrival_grace_min: ARRIVAL_GRACE_DEFAULT,
    active: true, timezone: null, change: false,
    // What a saved row carries that these four answers never ask about; kept as it was on an edit.
    keep: {},
  };
}

/** A saved commitments row, read back into a setup draft. `locations` names the place. */
export function draftFromRule(row, locations = []) {
  const morning = row.type === 'morning_roll_call';
  const starts = isMin(row.starts_min) ? row.starts_min : 360;
  const grace = isMin(row.respond_by_min) ? Math.max(0, row.respond_by_min - starts) : 5;
  const closeAfter = isMin(row.ends_min) ? Math.max(grace, row.ends_min - starts) : CLOSE_DEFAULT_MIN;
  const loc = row.location_id ? (locations || []).find((l) => l && l.id === row.location_id) : null;
  const place = loc ? { id: loc.id, name: loc.name, radius_m: loc.radius_m, address: loc.address || null }
    : row.location_id ? { id: row.location_id, name: row.location_name || 'Saved place', radius_m: null, address: null } : null;
  const esc0 = row.escalation && typeof row.escalation === 'object' ? row.escalation : {};
  const agrace = isMin(row.arrival_grace_min) ? row.arrival_grace_min : ARRIVAL_GRACE_DEFAULT;
  return {
    ...blankSetup(),
    id: row.id || null,
    mode: morning ? (row.location_id ? 'both' : 'wake') : 'arrival',
    arrival_type: morning ? 'practice' : arrivalType(row.type),
    title: morning ? (row.title || '') : '',
    saved_title: morning ? '' : (row.title || ''),
    // A coach's own title on an arrival-only row survives the edit; the automatic "At <place>" follows the place.
    title_custom: !morning && !!row.title && !/^At /.test(row.title),
    message: row.message || '', action_label: row.action_label || '',
    audience_kind: row.audience_kind || 'team', audience_value: row.audience_value || null,
    repeat_days: Array.isArray(row.repeat_days) ? row.repeat_days.map(Number) : [],
    starts_min: starts, grace_min: grace, close_after_min: closeAfter,
    // `alarm` absent = a wake-up from before the switch, which 0234 resolves to ON. An arrival
    // only roll call never rings.
    escalation: { ...esc0, alarm: morning ? esc0.alarm !== false : false },
    location_id: row.location_id || null, place,
    arrive_by_min: isMin(row.arrive_by_min) ? row.arrive_by_min : null,
    arrival_grace_min: agrace,
    active: row.active !== false, timezone: row.timezone || null,
    keep: {
      reminder_offsets_min: Array.isArray(row.reminder_offsets_min) ? row.reminder_offsets_min.map(Number) : null,
      min_dwell_min: isMin(row.min_dwell_min) ? row.min_dwell_min : null,
      linked_commitment_id: row.linked_commitment_id || null,
    },
    // Anything off the defaults opens "Change", so nothing that is set is hidden.
    change: grace !== 5 || closeAfter !== CLOSE_DEFAULT_MIN || agrace !== ARRIVAL_GRACE_DEFAULT || !!row.message,
  };
}

/** Payload for upsert_commitment. wakeupPayload for a wake-up (plus the place when it asks for
 *  one); a non-morning type for arrival only, with no acknowledgement and no alarm. */
export function setupPayload(d, owner, kind, tz) {
  const mode = MODE_KEYS.includes(d.mode) ? d.mode : 'wake';
  const agrace = clamp(isMin(d.arrival_grace_min) ? d.arrival_grace_min : ARRIVAL_GRACE_DEFAULT, 0, 120);
  const keep = d.keep || {};
  if (mode === 'arrival') {
    const by = clamp(isMin(d.arrive_by_min) ? Math.round(d.arrive_by_min) : (isMin(d.starts_min) ? d.starts_min : ARRIVAL_DEFAULT_MIN), 0, 1439);
    const name = placeName(d);
    return {
      id: d.id || undefined,
      type: arrivalType(d.arrival_type),
      title: ((d.title_custom && (d.saved_title || '').trim()) || (name ? `At ${name}` : (d.saved_title || '').trim() || 'Check-in')).slice(0, 60),
      message: (d.message || '').trim() || null,
      action_label: (d.action_label || '').trim() || null,
      audience_kind: d.audience_kind, audience_value: d.audience_value || null,
      repeat_days: d.repeat_days,
      // Nothing to acknowledge: the arrival IS the answer. It starts at the arrive-by time, so the
      // phone arms the place two hours ahead (my_armable_geofences) and missed is arrive-by + grace.
      starts_min: by, respond_by_min: null, opens_min: null, ends_min: null,
      location_id: d.location_id || null, arrive_by_min: by, arrival_grace_min: agrace,
      min_dwell_min: keep.min_dwell_min != null ? keep.min_dwell_min : null,
      linked_commitment_id: keep.linked_commitment_id || null,
      reminder_offsets_min: keep.reminder_offsets_min && keep.reminder_offsets_min.length ? keep.reminder_offsets_min : [15, 5],
      escalation: { ...(d.escalation || {}), alarm: false, [ROLLCALL_MARK]: true },
      active: d.active !== false,
      team_id: kind === 'practice' ? null : owner,
      practice_id: kind === 'practice' ? owner : null,
      timezone: tz,
    };
  }
  const p = wakeupPayload(d, owner, kind, tz);
  p.arrival_grace_min = agrace;
  p.escalation = { ...p.escalation, [ROLLCALL_MARK]: true };
  // The wake-up's reminders follow its grace (wakeupPayload); a dwell or a link set elsewhere stays.
  if (keep.min_dwell_min != null) p.min_dwell_min = keep.min_dwell_min;
  if (keep.linked_commitment_id) p.linked_commitment_id = keep.linked_commitment_id;
  if (mode === 'both') {
    p.location_id = d.location_id || null;
    p.arrive_by_min = isMin(d.arrive_by_min) ? clamp(Math.round(d.arrive_by_min), 0, 1439) : null;
  } else {
    p.location_id = null;
    p.arrive_by_min = null;
  }
  return p;
}

/** The one thing stopping a save, in plain words, or null. */
export function setupErrors(d) {
  if (!Array.isArray(d.repeat_days) || !d.repeat_days.length) return 'Pick at least one day.';
  const mode = MODE_KEYS.includes(d.mode) ? d.mode : 'wake';
  if (mode !== 'arrival' && !isMin(d.starts_min)) return 'Set the wake-up time.';
  if (mode !== 'wake') {
    if (!d.location_id) return 'Pick the place they need to be.';
    if (!isMin(d.arrive_by_min)) return 'Set the time they need to be there.';
    if (mode === 'both' && d.arrive_by_min <= d.starts_min) return 'The be-there time has to be after the wake-up.';
  }
  if (d.audience_kind !== 'team' && !d.audience_value) return 'Pick who this is for.';
  return null;
}

/* ---------------------------------------------------------------- words */

const who = (d) => {
  if (d.audience_kind === 'room') { const r = ((CD.extras && CD.extras.rooms) || []).find((x) => x.id === d.audience_value); return r ? `the ${r.label} room` : 'one room'; }
  if (d.audience_kind === 'group') { const g = ((CD.extras && CD.extras.groups) || []).find((x) => x.id === d.audience_value); return g ? g.name : 'one group'; }
  return CD.kind === 'practice' ? 'all clients' : 'the whole team';
};
const agraceOf = (d) => (isMin(d.arrival_grace_min) ? d.arrival_grace_min : ARRIVAL_GRACE_DEFAULT);

/** The header's one line: when it repeats, when, and who. */
export function setupLine(d) {
  const days = daysLabel(d.repeat_days);
  const at = placeName(d) || 'the place';
  if (d.mode === 'arrival') return `${days} by ${fmtMin(isMin(d.arrive_by_min) ? d.arrive_by_min : ARRIVAL_DEFAULT_MIN)} at ${at}.`;
  if (d.mode === 'both') {
    const by = isMin(d.arrive_by_min) ? d.arrive_by_min : Math.min(1439, d.starts_min + BOTH_GAP_MIN);
    return `${days}: up at ${fmtMin(d.starts_min)}, at ${at} by ${fmtMin(by)}.`;
  }
  return `${days} at ${fmtMin(d.starts_min)}, ${who(d)}.`;
}

/** The window as one plain line, each beat in its meaning's colour, no boxes:
 *  "On standard until 6:05 AM · late until 6:30 AM · missed after". */
export function windowPlain(d) {
  const c = windowCells(d);
  return `<span class="g">On standard until ${esc(c[1].at)}</span> · <span class="a">late until ${esc(c[2].at)}</span> · <span class="r">missed after</span>`;
}

/** The defaults behind "Change", said once. */
export function windowLine(d) {
  if (d.mode === 'arrival') {
    const by = isMin(d.arrive_by_min) ? d.arrive_by_min : ARRIVAL_DEFAULT_MIN;
    return `On time until ${fmtMin(Math.min(1439, by + agraceOf(d)))}, missed if they aren’t there by then.`;
  }
  const c = windowCells(d);
  return `${d.mode === 'both' ? 'Wake-up: on' : 'On'} standard until ${c[1].at}, missed at ${c[2].at}.`;
}

/* ---------------------------------------------------------------- the draft */

let DRAFT = null;
const NOT_ROLLCALL = { notRollcall: true };
/* A Start in flight. Read at render: a repaint while saveCommitment is out draws a disabled
   "Saving…", never a fresh live button under the coach's thumb. */
let SAVING = false;
/** Test and harness seam. */
export function markSavingForHarness(on) { SAVING = !!on; }
/** Harness and test seam: start the setup screen from this draft (merged over a blank one). */
export function seedSetupForHarness(partial) { DRAFT = { ...blankSetup(), ...(partial || {}) }; }

/** The rule behind an id, from the book's loaded commitments. */
export const ruleOf = (id) => (id ? (VC.commitments || []).find((r) => r && r.id === id) || null : null);
/** A roll call this module can open: every wake-up, and an arrival-only row THIS screen made
 *  (carries the mark). Exported for the tests. */
/* One definition, in commitments.js, so the doors (coach Home, Commitments) ask it too. */
export { isRollcall };

function draftFor(sub) {
  if (!sub) {
    if (!DRAFT || DRAFT.id) DRAFT = blankSetup();
    return DRAFT;
  }
  if (DRAFT && DRAFT.id === sub) return DRAFT;
  const rule = ruleOf(sub);
  if (!rule) return null;
  if (!isRollcall(rule)) return NOT_ROLLCALL;
  DRAFT = draftFromRule(rule, VC.locations || []);
  return DRAFT;
}

/* ---------------------------------------------------------------- setup markup */

const field = (label, control, hint, id) => `
  <div class="wk-field">
    <div class="wk-l"${id ? ` id="${id}"` : ''}>${label}</div>
    ${control}
    ${hint ? `<div class="ts wk-hint">${hint}</div>` : ''}
  </div>`;
const radioChip = (on, label, attr) => `<button type="button" class="chip ${on ? 'on' : ''}" role="radio" aria-checked="${on ? 'true' : 'false'}" ${attr}>${label}</button>`;

function modeSeg(d) {
  return `<div class="seg rs-mode" role="radiogroup" aria-label="What to check">
    ${MODES.map((m) => `<button type="button" role="radio" aria-checked="${d.mode === m.k ? 'true' : 'false'}" class="${d.mode === m.k ? 'on' : ''}" data-rs-mode="${m.k}">${m.label}</button>`).join('')}
  </div>
  <p class="rs-mode-s">${esc((MODES.find((m) => m.k === d.mode) || MODES[0]).cap)}</p>`;
}

function whoChips(d) {
  const rows = (CD.roster && Array.isArray(CD.roster.rows)) ? CD.roster.rows : [];
  const rooms = CD.kind === 'practice' ? [] : ((CD.extras && CD.extras.rooms) || []);
  const groups = (CD.extras && CD.extras.groups) || [];
  const n = (k) => (k ? ` · ${k}` : '');
  return `<div class="chip-row" role="radiogroup" aria-labelledby="rs-who-l">
    ${radioChip(d.audience_kind === 'team', `${CD.kind === 'practice' ? 'All clients' : 'Whole team'}${n(rows.length)}`, 'data-rs-aud="team"')}
    ${rooms.map((r) => radioChip(d.audience_kind === 'room' && d.audience_value === r.id, `${esc(r.label)} room${n(rows.filter((x) => x.roomId === r.id).length)}`, `data-rs-aud="room:${esc(r.id)}"`)).join('')}
    ${groups.map((g) => radioChip(d.audience_kind === 'group' && d.audience_value === g.id, `${esc(g.name)}${n((g.athlete_ids || []).length)}`, `data-rs-aud="group:${esc(g.id)}"`)).join('')}
  </div>`;
}

function daysChips(d) {
  return `<div class="wk-days" role="group" aria-labelledby="rs-days-l">
    ${DOW.map((n, i) => `<button type="button" class="chip ${d.repeat_days.includes(i) ? 'on' : ''}" role="checkbox" aria-checked="${d.repeat_days.includes(i) ? 'true' : 'false'}" aria-label="${DAYS_LONG[i]}" data-rs-day="${i}">${n}</button>`).join('')}
  </div>`;
}

function alarmRow(d) {
  const on = !!(d.escalation && d.escalation.alarm);
  return `<div class="std-switch-row rs-alarm" role="switch" tabindex="0" aria-checked="${on ? 'true' : 'false'}" aria-label="Ring as an alarm" aria-describedby="rs-alarm-sub" data-rs-alarm>
    <div class="std-sw-m">
      <div class="std-sw-t">Ring as an alarm</div>
      <div class="std-sw-s" id="rs-alarm-sub">${on
        ? 'Rings through silent mode and a Sleep Focus on iOS 26.1 or later. Other phones get the notification.'
        : 'A notification only. It stays quiet on silent, which is most phones at 5 AM.'}</div>
    </div>
    <div class="std-switch ${on ? 'on' : ''}" aria-hidden="true"></div>
  </div>`;
}

const timeInput = (id, min, label) => `<input class="ob-input wk-time" id="${id}" type="time" value="${hhmm(min)}" aria-label="${esc(label)}" />`;

function whereBlock(d, canMap) {
  const by = isMin(d.arrive_by_min) ? d.arrive_by_min : (d.mode === 'arrival' ? ARRIVAL_DEFAULT_MIN : d.starts_min + BOTH_GAP_MIN);
  let place;
  if (d.location_id && d.place) {
    const size = isMin(d.place.radius_m) ? `${Math.round(d.place.radius_m)} m around it` : 'Saved place';
    place = `<div class="rs-place">
      <span class="lic" aria-hidden="true">${icon('pin', 18)}</span>
      <div class="lm"><div class="lt">${esc(d.place.name || 'Saved place')}</div><div class="ls">${esc(size)}${d.place.address ? ` · ${esc(d.place.address)}` : ''}</div>
        <button type="button" class="rs-change rs-place-x" data-rs-replace>Pick another</button></div>
    </div>`;
  } else {
    const saved = (VC.locations || []).filter((l) => l && l.id && l.name);
    place = `${saved.length ? `<div class="wk-l" id="rs-saved-l">Saved places</div>
      <div class="chip-row rs-saved" role="radiogroup" aria-labelledby="rs-saved-l">
        ${saved.map((l) => radioChip(false, esc(l.name), `data-rs-loc="${esc(l.id)}"`)).join('')}
      </div>` : ''}
      ${canMap
        ? `<button type="button" class="btn ghost rs-map" data-rs-map>${icon('pin', 18)} ${saved.length ? 'Draw a new place' : 'Draw the place on a map'}</button>
           <div class="ts wk-hint">Search or drop a pin, then drag the edge. 100 m to 1000 m across a building or a field.</div>`
        : `<p class="rs-nomap">${esc(mapMissingLine())}</p>`}`;
  }
  const byField = field('Be there by', timeInput('rs-by', by, 'Be there by'),
    d.location_id ? `On time until ${fmtMin(Math.min(1439, by + agraceOf(d)))}. They check in by walking in, or with I’m here.` : '');
  return `<h2 class="eyebrow">Where</h2>
  <section class="card pad wk-form rs-where">
    <div class="wk-field rs-place-f">${place}<p class="rs-say" id="rs-place-say" role="status" aria-live="polite"></p></div>
    ${d.mode === 'both' ? byField : ''}
  </section>`;
}

function changePanel(d) {
  const wake = d.mode !== 'arrival';
  const place = d.mode !== 'wake';
  return `<section class="card pad wk-form rs-more" id="rs-more" ${d.change ? '' : 'hidden'}>
    ${wake ? `<p class="rs-win" aria-label="${esc(windowLabel(d))}">${windowPlain(d)}</p>
    ${field('Grace',
      `<div class="wk-chips wk-chips-fit" role="radiogroup" aria-labelledby="rs-grace-l">
        ${GRACES.map((g) => radioChip(d.grace_min === g, g === 0 ? 'None' : `${g}m`, `data-rs-grace="${g}"`)).join('')}
      </div>`, '', 'rs-grace-l')}
    ${field('Closes after',
      `<div class="wk-chips wk-chips-fit" role="radiogroup" aria-labelledby="rs-close-l">
        ${CLOSE_CHOICES.map((v) => radioChip(d.close_after_min === v, `${v}m`, `data-rs-close="${v}"`)).join('')}
      </div>`, 'After this, anyone who never answered is missed.', 'rs-close-l')}` : ''}
    ${place ? field(wake ? 'Grace at the place' : 'Grace',
      `<div class="wk-chips wk-chips-fit" role="radiogroup" aria-labelledby="rs-agrace-l">
        ${ARRIVAL_GRACES.map((g) => radioChip(agraceOf(d) === g, g === 0 ? 'None' : `${g}m`, `data-rs-agrace="${g}"`)).join('')}
      </div>`, 'Minutes after the be-there time that still count as on time.', 'rs-agrace-l') : ''}
    ${field('Message <span class="opt">· optional</span>',
      `<textarea class="ob-input wk-msg" id="rs-msg" aria-labelledby="rs-msg-l" maxlength="1000" rows="4" placeholder="What you’d text the group. It goes out in your name, exactly as written.">${esc(d.message)}</textarea>
      ${wake ? `<div class="wk-presets">${PRESETS.map((s, i) => `<button type="button" class="chip" data-rs-preset="${i}">${esc(s)}</button>`).join('')}</div>` : ''}`,
      '', 'rs-msg-l')}
  </section>`;
}

function setupHtml(d, back) {
  const editing = !!d.id;
  const canMap = mapAvailable();
  const wake = d.mode !== 'arrival';
  const main = `<section class="card pad wk-form rs-form">
    ${wake ? field('Wake-up time', timeInput('rs-time', d.starts_min, 'Wake-up time')) : ''}
    ${d.mode === 'arrival' ? `${field('What is it',
      `<div class="chip-row" role="radiogroup" aria-labelledby="rs-kind-l">
        ${ARRIVAL_KINDS.map((k) => radioChip(arrivalType(d.arrival_type) === k.type, esc(k.label), `data-rs-kind="${k.type}"`)).join('')}
      </div>`, '', 'rs-kind-l')}
    ${field('Be there by', timeInput('rs-by', isMin(d.arrive_by_min) ? d.arrive_by_min : ARRIVAL_DEFAULT_MIN, 'Be there by'))}` : ''}
    ${field('Days', daysChips(d), '', 'rs-days-l')}
    ${field('Who', whoChips(d), CD.kind === 'practice' ? '' : 'Anyone who joins later is on the next one.', 'rs-who-l')}
    ${wake ? alarmRow(d) : ''}
  </section>`;
  // No map on this binary and no saved place to pick (final review I-1): one line, never a door
  // to a map that cannot open.
  const canPlace = canMap || (VC.locations || []).some((l) => l && l.id && l.name);
  const addPlace = d.mode === 'wake' && !canPlace
    ? `<p class="rs-nomap rs-noplace">${esc(mapMissingLine())}</p>`
    : d.mode === 'wake'
    ? `<div class="card rs-addcard"><button type="button" class="lrow rs-add" data-rs-addplace>
        <span class="lic" aria-hidden="true">${icon('pin', 18)}</span>
        <span class="lm"><span class="lt">Also check they’re at a place</span><span class="ls">Up on time, then walk in by a set time</span></span>
        ${icon('chevron', 16)}
      </button></div>` : '';
  return `${backHead(editing ? 'Edit roll call' : 'New roll call', setupLine(d), back)}
    ${modeSeg(d)}
    ${main}
    ${addPlace}
    ${d.mode !== 'wake' ? whereBlock(d, canMap) : ''}
    <div class="rs-window"><p class="rs-window-t">${esc(windowLine(d))}</p><button type="button" class="rs-change" aria-expanded="${d.change ? 'true' : 'false'}" aria-controls="rs-more">${d.change ? 'Done' : 'Change'}</button></div>
    ${changePanel(d)}
    <div class="action-bar rs-bar"><button type="button" class="btn primary" id="rs-save"${SAVING ? ' disabled aria-busy="true"' : ''}>${SAVING ? 'Saving…' : editing ? 'Save changes' : 'Start roll call'}</button><p class="rs-err" id="rs-err" role="status" aria-live="polite"></p></div>`;
}

function notForRole(back) {
  return `${backHead('Roll call', 'Not available for your role', back)}
  ${emptyState({ icon: 'eye', title: 'Scheduling is for the coaching staff', body: 'You can see the board and every answer for your scope. Ask the head coach if you should be able to schedule too.' })}`;
}

const PLACE_ERR = {
  radius_min: 'Make the circle bigger. The smallest is 100 m.',
  radius_max: 'Make the circle smaller. The largest is 1000 m.',
  name_required: 'Give the place a name.',
  not_authorized: 'Only the coaching staff can save places.',
  team_or_practice_required: 'Your team isn’t loaded yet. Try again in a moment.',
};

/* ---------------------------------------------------------------- rollcall-new */

export const rollcallNew = {
  nav: 'operator', tab: 'home', transient: true,
  render({ sub } = {}) {
    const back = sub ? `rollcall/${sub}` : (CD.kind === 'practice' ? 'trainer' : 'coach-home');
    if (ROLLCALL_OFF) return `${backHead('Roll call', 'Switched off', back)}${emptyState({ icon: 'sun', title: 'The roll call is off right now', body: 'Nobody is being asked to check in. Every roll call you already ran is kept.' })}`;
    if (!canSchedule()) return notForRole(back);
    const d = draftFor(sub);
    if (d === NOT_ROLLCALL) {
      return `${backHead('Edit', '', back)}${emptyState({ icon: 'clock', title: 'This one isn’t a roll call', body: 'It was set up in Commitments, with its own close and reminders. Edit it there so nothing is lost.', action: { go: 'coach-commit-manage', label: 'Open Commitments' } })}`;
    }
    if (!d) {
      if (VC.commitmentsError) return `${backHead('Edit roll call', '', back)}${errorState({ title: 'This roll call didn’t load', retryId: 'rs-retry' })}`;
      return `${backHead('Edit roll call', 'Loading…', back)}${skeletonRows(4, 'Loading the roll call')}`;
    }
    return setupHtml(d, back);
  },

  mount(root, { sub } = {}) {
    if (ROLLCALL_OFF || !canSchedule()) return;
    ensureBook();
    const rerender = () => { if (root.isConnected && window.__render) window.__render(); };
    // The book's rules (to edit) and saved places (one tap), quietly; repaint only on a change.
    const owner = bookId();
    const locBefore = JSON.stringify((VC.locations || []).map((l) => l.id));
    const hadDraft = !!draftFor(sub);
    if (owner) {
      Promise.all([loadCommitments(owner, CD.kind), loadLocations(owner, CD.kind)]).then(() => {
        const locNow = JSON.stringify((VC.locations || []).map((l) => l.id));
        if ((!hadDraft && draftFor(sub)) || locNow !== locBefore) rerender();
      }, () => {});
    }
    const retry = root.querySelector('#rs-retry');
    if (retry) retry.addEventListener('click', async () => { retry.disabled = true; if (owner) await loadCommitments(owner, CD.kind, true); rerender(); });

    const d = draftFor(sub);
    if (!d || d === NOT_ROLLCALL) return;
    const val = (sel) => { const el = root.querySelector(sel); return el ? el.value : null; };
    /* Read what the coach typed back into the draft BEFORE any repaint: a repaint rebuilds every
       input from the draft, and a message typed and not captured would vanish. */
    const capture = () => {
      const t = minOf(val('#rs-time')); if (t != null) d.starts_min = t;
      const b = minOf(val('#rs-by')); if (b != null) d.arrive_by_min = b;
      const m = val('#rs-msg'); if (m != null) d.message = m;
      const err = root.querySelector('#rs-err'); if (err) sayStatus(err, '');
    };
    const on = (sel, fn) => root.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => { capture(); fn(b); rerender(); }));

    ['#rs-time', '#rs-by'].forEach((sel) => {
      const el = root.querySelector(sel);
      if (el) el.addEventListener('change', () => { capture(); rerender(); });
    });
    on('[data-rs-mode]', (b) => {
      const m = b.getAttribute('data-rs-mode');
      if (m === 'arrival' && !isMin(d.arrive_by_min)) d.arrive_by_min = ARRIVAL_DEFAULT_MIN;
      if (m === 'both' && (!isMin(d.arrive_by_min) || d.arrive_by_min <= d.starts_min)) d.arrive_by_min = Math.min(1439, d.starts_min + BOTH_GAP_MIN);
      d.mode = m;
    });
    on('[data-rs-addplace]', () => {
      d.mode = 'both';
      if (!isMin(d.arrive_by_min) || d.arrive_by_min <= d.starts_min) d.arrive_by_min = Math.min(1439, d.starts_min + BOTH_GAP_MIN);
    });
    on('[data-rs-kind]', (b) => { d.arrival_type = arrivalType(b.getAttribute('data-rs-kind')); });
    on('[data-rs-day]', (b) => {
      const n = +b.getAttribute('data-rs-day');
      d.repeat_days = d.repeat_days.includes(n) ? d.repeat_days.filter((x) => x !== n) : d.repeat_days.concat(n).sort();
    });
    on('[data-rs-aud]', (b) => {
      const [k, v] = b.getAttribute('data-rs-aud').split(':');
      d.audience_kind = k; d.audience_value = v || null;
    });
    on('[data-rs-grace]', (b) => { d.grace_min = +b.getAttribute('data-rs-grace'); });
    on('[data-rs-close]', (b) => { d.close_after_min = +b.getAttribute('data-rs-close') || CLOSE_DEFAULT_MIN; });
    on('[data-rs-agrace]', (b) => { d.arrival_grace_min = +b.getAttribute('data-rs-agrace'); });
    on('.rs-change', () => { d.change = !d.change; });
    on('[data-rs-loc]', (b) => {
      const l = (VC.locations || []).find((x) => x.id === b.getAttribute('data-rs-loc'));
      if (l) { d.location_id = l.id; d.place = { id: l.id, name: l.name, radius_m: l.radius_m, address: l.address || null }; }
    });
    root.querySelectorAll('[data-rs-preset]').forEach((b) => b.addEventListener('click', () => {
      capture();
      d.message = PRESETS[+b.getAttribute('data-rs-preset')] || d.message;
      rerender();
      const ta = document.querySelector('#rs-msg');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }));
    const alarm = root.querySelector('[data-rs-alarm]');
    const flip = () => { capture(); d.escalation = { ...(d.escalation || {}), alarm: !(d.escalation && d.escalation.alarm) }; rerender(); };
    if (alarm) {
      alarm.addEventListener('click', flip);
      alarm.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
    }

    /* The map: the phone draws it, the server keeps the place. */
    const say = (m, error = false) => sayStatus(root.querySelector('#rs-place-say'), m, { error });
    const openMap = async (btn) => {
      capture();
      if (btn) btn.disabled = true;
      let r = null;
      try { const L = await import('../location.js'); r = await L.pickPlace(d.place && isMin(d.place.radius_m) ? d.place : undefined); } catch { r = { error: 'map-unavailable' }; }
      if (btn) btn.disabled = false;
      if (!r) return;   // the coach closed the map
      if (r.error === 'map-unavailable') { say(mapMissingLine(), true); return; }
      if (r.error === 'map-busy') { say('The map is already open.', true); return; }
      const own = bookId();
      if (!own) { say(PLACE_ERR.team_or_practice_required, true); return; }
      say('Saving the place…');
      const res = await savePlace(r, own, CD.kind);
      if (!res.ok) { say(PLACE_ERR[res.error] || 'Couldn’t save the place. Try again.', true); return; }
      d.location_id = res.id;
      d.place = { id: res.id, name: r.name, radius_m: r.radius_m, address: r.address || null };
      loadLocations(own, CD.kind, true).catch(() => {});
      rerender();
    };
    const map = root.querySelector('[data-rs-map]');
    if (map) map.addEventListener('click', () => openMap(map));
    const replace = root.querySelector('[data-rs-replace]');
    if (replace) replace.addEventListener('click', () => {
      // With the map: redraw it, starting from the place. Without: back to the saved places.
      if (mapAvailable() && d.place && isMin(d.place.radius_m)) { openMap(replace); return; }
      capture(); d.location_id = null; d.place = null; rerender();
    });

    const save = root.querySelector('#rs-save');
    if (save) save.addEventListener('click', async () => {
      if (save.disabled || SAVING) return;
      capture();
      const errEl = root.querySelector('#rs-err');
      const problem = setupErrors(d);
      if (problem) { sayStatus(errEl, problem, { error: true }); return; }
      const own = bookId();
      if (!own) { sayStatus(errEl, 'Your team isn’t loaded yet. Try again in a moment.', { error: true }); return; }
      SAVING = true;
      save.disabled = true; save.setAttribute('aria-busy', 'true'); save.textContent = 'Saving…';
      const tz = d.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      const payload = setupPayload(d, own, CD.kind, tz);
      let id = null;
      try { id = await saveCommitment(payload); } catch { id = null; }
      if (!id) {
        SAVING = false;
        // A repaint during the write may have replaced the button: find the live one.
        const live = document.querySelector('#rs-save');
        if (live) { live.disabled = false; live.removeAttribute('aria-busy'); live.textContent = d.id ? 'Save changes' : 'Start roll call'; }
        sayStatus(document.querySelector('#rs-err') || errEl, 'Couldn’t save. Check your connection and try again.', { error: true });
        return;
      }
      track(EVENTS.VC_SCHEDULED, { type: payload.type, audience: d.audience_kind, hasLocation: !!payload.location_id, wakeup: d.mode !== 'arrival', mode: d.mode, grace: d.grace_min, hasMessage: !!(d.message || '').trim() });
      // Leave FIRST, with the draft still whole (a repaint now shows the form, never a blank one),
      // then refresh. The saved draft carries its id, so the next New starts clean.
      d.id = id;
      location.replace(`#rollcall/${id}`);
      SAVING = false;
      // Roll call v3: tell the athletes now, not at the next cron minute. The roll call screen it
      // lands on says how that went (rollcall-v3-data.js toldState).
      void tellAthletesNow(id);
      loadCommitments(own, CD.kind, true).then((rows) => { RT.vcCommitments = rows; }, () => {});
    });
  },
};

/* ---------------------------------------------------------------- the week */

const compact = (min) => fmtMin(min).replace(/ (AM|PM)$/, '');

/** Today's date (YYYY-MM-DD) on the roll call's own clock, not the phone's: a coach travelling two
 *  time zones west must still see Tuesday's 6:00 as Tuesday. Falls back to the phone's date. */
export function todayIn(tz, nowMs = Date.now()) {
  if (!tz) return todayISO();
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(nowMs));
    const g = (t) => (p.find((x) => x.type === t) || {}).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch { return todayISO(); }
}
/** Minutes past midnight now, on that same clock. */
export function nowMinIn(tz, nowMs = Date.now()) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
    const g = (t) => Number((p.find((x) => x.type === t) || {}).value);
    return g('hour') * 60 + g('minute');
  } catch { const d = new Date(nowMs); return d.getHours() * 60 + d.getMinutes(); }
}
/** Why a move to `min` cannot happen, or null. Today's morning cannot move to a time already gone. */
export function moveProblem(day, min, tz, nowMs = Date.now()) {
  if (min == null) return 'Pick a time.';
  if (day && day.today && min <= nowMinIn(tz, nowMs)) return 'That time has already passed today. Pick a later time, or cancel this morning.';
  return null;
}
const dayOf = (iso) => new Date(`${iso}T12:00:00`);

/** Seven days from today, each with its occurrence (or none), moved / skipped / started. */
export function weekDays(rows, todayIso, nowMs = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  return Array.from({ length: 7 }, (_, i) => {
    const iso = shiftISO(todayIso, i);
    let row = list.find((r) => r && r.occurs_on === iso) || null;
    // A cancelled occurrence the coach did not skip is the rule no longer repeating that day.
    if (row && row.instance_status === 'cancelled' && !row.skipped) row = null;
    const skipped = !!(row && row.skipped);
    const moved = !!(row && !skipped && (row.moved
      || (row.starts_override_min != null && row.rule_starts_min != null && row.starts_override_min !== row.rule_starts_min)));
    const t = row && row.starts_at ? Date.parse(row.starts_at) : NaN;
    const date = dayOf(iso);
    return {
      iso, row, moved, skipped, today: i === 0,
      started: isFinite(t) && t <= nowMs,
      dow: date.getDay(), day: date.getDate(), month: date.getMonth(),
      min: row && isMin(row.starts_min) ? row.starts_min : null,
    };
  });
}

function dayName(x) { return `${DAYS_LONG[x.dow]}, ${MONTHS_SHORT[x.month]} ${x.day}`; }

/** The strip: 7 cells. A future morning is a button (move, cancel, undo); moved ones wear the
 *  word "Moved" under the time, cancelled ones read "Cancelled" with a dashed edge, days the rule
 *  skips read Off. */
export function weekStrip(rows, todayIso, nowMs = Date.now()) {
  const days = weekDays(rows, todayIso, nowMs);
  return `<ul class="rw-strip" aria-label="This week">${days.map((x) => {
    const cls = [x.today && 'today', x.moved && 'moved', x.skipped && 'skipped', (!x.row || x.skipped) && 'off', x.started && 'past'].filter(Boolean).join(' ');
    const t = x.skipped ? 'Cancelled' : !x.row ? 'Off' : x.min != null ? compact(x.min) : '';
    const said = `${dayName(x)}, ${!x.row ? 'no roll call' : x.skipped ? 'cancelled' : `${fmtMin(x.min)}${x.moved ? ', moved' : ''}${x.started ? ', already started' : ''}`}`;
    const inner = `<span class="rw-d" aria-hidden="true">${x.today ? 'Today' : DAYS_SHORT[x.dow]}</span><span class="rw-n" aria-hidden="true">${x.day}</span><span class="rw-t" aria-hidden="true">${esc(t)}</span>${x.moved ? '<span class="rw-m" aria-hidden="true">Moved</span>' : ''}`;
    const id = x.row && x.row.instance_id;
    const tappable = !!id && !x.started;
    return `<li class="rw-day${cls ? ` ${cls}` : ''}">${tappable
      ? `<button type="button" class="rw-cell" data-rw-day="${esc(id)}" aria-label="${esc(said)}">${inner}</button>`
      : `<span class="rw-cell" role="img" aria-label="${esc(said)}">${inner}</span>`}</li>`;
  }).join('')}</ul>`;
}

/** The changes, said once under the strip, or the hint when there are none. */
export function weekNote(rows, todayIso, nowMs = Date.now()) {
  const days = weekDays(rows, todayIso, nowMs);
  const ch = days.filter((x) => x.moved || x.skipped).map((x) => (x.skipped ? `${DAYS_LONG[x.dow]} cancelled` : `${DAYS_LONG[x.dow]} moved to ${fmtMin(x.min)}`));
  return ch.length ? `${ch.join(' · ')}.` : 'Tap a morning to move it or cancel it.';
}

const WEEK = { forId: null, failed: false };
let SHEET_OPENER = null;
export function closeWeekSheet(focusBack) {
  document.querySelectorAll('.rw-scrim, .sheet.rw-sheet').forEach((n) => n.remove());
  document.removeEventListener('keydown', weekSheetKey);
  window.removeEventListener('hashchange', closeWeekSheetQuiet);
  if (focusBack && typeof focusBack.focus === 'function') { try { focusBack.focus(); } catch { /* gone */ } }
}
function closeWeekSheetQuiet() { closeWeekSheet(null); }
function weekSheetKey(e) { if (e.key === 'Escape') closeWeekSheet(SHEET_OPENER); }

export function weekSub(rule) {
  const d = draftFromRule(rule, VC.locations || []);
  if (d.mode === 'arrival') return `${daysLabel(d.repeat_days)} · by ${fmtMin(d.arrive_by_min != null ? d.arrive_by_min : d.starts_min)}${placeName(d) ? ` · ${placeName(d)}` : ''}`;
  return `${daysLabel(d.repeat_days)} · ${fmtMin(d.starts_min)}${d.mode === 'both' && placeName(d) ? ` · then ${placeName(d)}` : ''}`;
}

/** The first roll call in the book, for a bare #rollcall-week / #rollcall-history. */
export const firstRollcall = () => {
  const all = (VC.commitments || []).filter(isRollcall);
  const live = all.filter((r) => r.active !== false);
  return live.find((r) => r.type === 'morning_roll_call') || live[0] || all.find((r) => r.type === 'morning_roll_call') || all[0] || null;
};

function noRollcallYet(title, back) {
  return `${backHead(title, '', back)}${emptyState({ icon: 'sun', title: 'No roll call yet', body: 'Set one up in four answers: time, days, who and the alarm.', action: { go: 'rollcall-new', label: 'Set one up' } })}`;
}

export const rollcallWeek = {
  nav: 'operator', tab: 'home',
  /* Roll call v3: the week strip lives on the one roll call screen now (#rollcall/<id>). A bare
     #rollcall-week still resolves the first roll call below, then lands there too. */
  redirect({ sub } = {}) { return sub ? `rollcall/${sub}` : null; },
  render({ sub } = {}) {
    const back = CD.kind === 'practice' ? 'trainer' : 'coach-home';
    const rule = ruleOf(sub);
    if (!sub) {
      if (VC.commitments && VC.commitments.length && !firstRollcall()) return noRollcallYet('Roll call', back);
      return `${backHead('Roll call', 'Loading…', back)}${skeletonRows(3, 'Loading the roll call')}`;
    }
    if (!rule) {
      if (VC.commitmentsError) return `${backHead('Roll call', '', back)}${errorState({ title: 'This roll call didn’t load', retryId: 'rw-retry' })}`;
      return `${backHead('Roll call', 'Loading…', back)}${skeletonRows(3, 'Loading the roll call')}`;
    }
    const rows = VC.upcomingFor(sub);
    const today = todayIn(rule.timezone);
    const strip = rows
      ? `${weekStrip(rows, today)}<p class="rw-note">${esc(weekNote(rows, today))}</p>`
      : WEEK.forId === sub && WEEK.failed
        ? errorState({ title: 'This week didn’t load', body: 'Reconnect and it loads right here. Nothing was changed.', retryId: 'rw-retry' })
        : skeletonRows(1, 'Loading this week');
    const todayRow = rows ? rows.find((r) => r.occurs_on === today && !r.skipped && r.instance_status !== 'cancelled') : null;
    const morning = rule.type === 'morning_roll_call';
    const link = (go, ic, t, s) => `<div class="lrow" data-go="${esc(go)}" role="button" tabindex="0">
      <span class="lic" aria-hidden="true">${icon(ic, 18)}</span>
      <div class="lm"><div class="lt">${t}</div><div class="ls">${s}</div></div>${icon('chevron', 16)}</div>`;
    return `${backHead(rule.title || 'Roll call', weekSub(rule), back)}
      <h2 class="eyebrow">This week</h2>
      ${strip}
      <div class="card rows list rw-links">
        ${todayRow ? link(`rollcall-board/${todayRow.instance_id}`, 'users', 'Today’s board', morning ? 'Who is up, live' : 'Who is here, live') : ''}
        ${link(`rollcall-history/${rule.id}`, 'bars', 'History', 'Who is reliable over the last 30 days')}
        ${link(`rollcall-new/${rule.id}`, 'edit', 'Edit roll call', morning ? 'Time, days, who, alarm and place' : 'Place, time, days and who')}
      </div>`;
  },

  mount(root, { sub } = {}) {
    ensureBook();
    const rerender = () => { if (root.isConnected && window.__render) window.__render(); };
    const owner = bookId();
    if (!sub) {
      const go = () => { const r = firstRollcall(); if (r) location.replace(`#rollcall/${r.id}`); else rerender(); };
      if (firstRollcall()) { go(); return; }
      if (owner) loadCommitments(owner, CD.kind).then(go, () => {});
      return;
    }
    const hadRule = !!ruleOf(sub);
    if (owner) Promise.all([loadCommitments(owner, CD.kind), loadLocations(owner, CD.kind)]).then(() => { if (!hadRule && ruleOf(sub)) rerender(); }, () => {});
    const before = JSON.stringify(VC.upcomingFor(sub));
    WEEK.forId = sub;
    const refresh = (force = false) => loadUpcoming(sub, 7, force).then((rows) => {
      if (rows === null) { const was = WEEK.failed; WEEK.failed = true; if (!was) rerender(); return; }
      WEEK.failed = false;
      if (JSON.stringify(rows) !== before) rerender();
    });
    refresh();
    const retry = root.querySelector('#rw-retry');
    if (retry) retry.addEventListener('click', async () => {
      retry.disabled = true;
      if (owner) await loadCommitments(owner, CD.kind, true);
      await loadUpcoming(sub, 7, true);
      WEEK.failed = false;
      rerender();
    });
    const prev = window.__screenCleanup;
    window.__screenCleanup = () => { closeWeekSheet(null); if (typeof prev === 'function') prev(); };

    root.querySelectorAll('[data-rw-day]').forEach((b) => b.addEventListener('click', () => openDaySheet(root, sub, b.getAttribute('data-rw-day'), b, rerender)));
  },
};

/** One morning's sheet: move it, cancel it, undo. Every write tells the athletes (0216). */
export function openDaySheet(root, commitmentId, instanceId, opener, rerender) {
  if (overlayOpen()) return;
  const rows = VC.upcomingFor(commitmentId) || [];
  const tz = (ruleOf(commitmentId) || {}).timezone;
  const x = weekDays(rows, todayIn(tz)).find((d) => d.row && d.row.instance_id === instanceId);
  if (!x) return;
  const rule = x.row.rule_starts_min != null ? x.row.rule_starts_min : x.min;
  const state = x.skipped ? `Cancelled. Usually ${fmtMin(rule)}.`
    : x.moved ? `Moved to ${fmtMin(x.min)}. Usually ${fmtMin(rule)}.`
    : `${fmtMin(x.min)}, the usual time.`;
  const host = root.querySelector('.screen') || root;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="sheet-scrim rw-scrim" data-rw-close></div>
    <div class="sheet rw-sheet" role="dialog" aria-modal="true" aria-labelledby="rw-sheet-t">
      <div class="grab"></div>
      <div class="sh-title" id="rw-sheet-t" tabindex="-1">${esc(dayName(x))}</div>
      <div class="sh-sub">${esc(state)}</div>
      ${x.skipped ? '' : `<div class="rw-move">
        <label class="wk-l" for="rw-time">Move this morning</label>
        <div class="rw-move-row"><input class="ob-input wk-time" id="rw-time" type="time" value="${hhmm(x.min != null ? x.min : rule)}" /><button type="button" class="btn primary" id="rw-move" disabled>Move it</button></div>
      </div>
      <button type="button" class="btn ghost danger rw-cancel" id="rw-cancel">Cancel this morning</button>`}
      ${x.skipped || x.moved ? `<button type="button" class="btn ghost rw-undo" id="rw-undo">${x.skipped ? 'Undo · put it back' : `Undo · back to ${esc(fmtMin(rule))}`}</button>` : ''}
      <p class="rw-say" id="rw-say" role="status" aria-live="polite"></p>
      <p class="rw-foot">Athletes hear about it the moment you change it.</p>
      <button type="button" class="cancel" data-rw-close>Close</button>
    </div>`;
  host.append(...wrap.children);
  const sheet = host.querySelector('.sheet.rw-sheet');
  if (!sheet) return;
  SHEET_OPENER = opener;
  document.addEventListener('keydown', weekSheetKey);
  window.addEventListener('hashchange', closeWeekSheetQuiet);
  host.querySelectorAll('[data-rw-close]').forEach((n) => n.addEventListener('click', () => closeWeekSheet(opener)));
  const t = sheet.querySelector('#rw-sheet-t'); if (t) { try { t.focus({ preventScroll: true }); } catch { /* no focus */ } }
  const say = sheet.querySelector('#rw-say');

  const write = async (btn, change, busy) => {
    const label = btn.textContent;
    sheet.querySelectorAll('button').forEach((b) => { if (!b.hasAttribute('data-rw-close')) b.disabled = true; });
    btn.textContent = busy;
    const ok = await setInstanceSchedule(instanceId, change);
    if (!ok) {
      sheet.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      btn.textContent = label;
      sayStatus(say, 'Couldn’t save. It may have already started, or check your connection.', { error: true });
      return;
    }
    let told = null;
    try { told = await notifyScheduleChange(instanceId); } catch { told = null; }
    await loadUpcoming(commitmentId, 14, true);   // the roll call screen reads 14 days (the alarm horizon)
    closeWeekSheet(opener);
    rerender();
    const note = document.querySelector('.rw-note');
    if (note && told && told.reason === 'failed') sayStatus(note, 'Saved. The heads-up to athletes didn’t send; their alarms still follow the change.', { error: true });
  };
  const move = sheet.querySelector('#rw-move');
  // Live only once the time actually differs (review pass C-Polish 2): "Move it" on an unchanged
  // time was a button that did nothing but close the sheet.
  const timeIn = sheet.querySelector('#rw-time');
  const current = x.min != null ? x.min : rule;
  const syncMove = () => { if (move) move.disabled = minOf((timeIn || {}).value) === current; };
  if (timeIn) { timeIn.addEventListener('input', syncMove); timeIn.addEventListener('change', syncMove); }
  if (move) move.addEventListener('click', () => {
    const m = minOf((sheet.querySelector('#rw-time') || {}).value);
    const no = moveProblem(x, m, tz);
    if (no) { sayStatus(say, no, { error: true }); return; }
    if (m === x.min) { closeWeekSheet(opener); return; }
    write(move, m === rule ? { resetTime: true } : { startsMin: m }, 'Moving…');
  });
  const cancel = sheet.querySelector('#rw-cancel');
  if (cancel) cancel.addEventListener('click', () => {
    // Two taps: a whole team's morning is not one stray touch away.
    if (cancel.getAttribute('data-armed') !== '1') { cancel.setAttribute('data-armed', '1'); cancel.textContent = 'Tap again to cancel it'; return; }
    write(cancel, { skipped: true }, 'Cancelling…');
  });
  const undo = sheet.querySelector('#rw-undo');
  if (undo) undo.addEventListener('click', () => write(undo, { skipped: x.skipped ? false : null, resetTime: x.moved }, 'Undoing…'));
}

/* ---------------------------------------------------------------- history */

/** Needs attention (below 80 on time, or slipping), then reliable (best first). */
export function historyGroups(h) {
  const list = (h && Array.isArray(h.athletes) ? h.athletes : []).filter((a) => a && isMin(a.on_time_pct));
  const attention = list.filter((a) => a.on_time_pct < 80 || (Number(a.trend) || 0) < 0)
    .sort((a, b) => a.on_time_pct - b.on_time_pct);
  const reliable = list.filter((a) => !attention.includes(a))
    .sort((a, b) => b.on_time_pct - a.on_time_pct || (b.streak || 0) - (a.streak || 0));
  return { attention, reliable };
}

const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function subLine(a, needs) {
  if (needs) {
    const p = [];
    if (a.missed) p.push(`missed ${a.missed}`);
    if (a.late) p.push(`late ${a.late}`);
    if ((Number(a.trend) || 0) < 0) p.push('slipping');
    return p.length ? cap1(p.join(' · ')) : `On time ${a.on_time} of ${a.mornings}`;
  }
  const p = [];
  if ((a.streak || 0) >= 2) p.push(`${a.streak}-morning streak`);
  if (a.first_up) p.push(`First up ${a.first_up} ${a.first_up === 1 ? 'time' : 'times'}`);
  return p.length ? p.join(' · ') : `On time ${a.on_time} of ${a.mornings}`;
}

/* On time, late and missed as one thin bar: the split behind the rate, drawn, not boxed. */
function mornBar(a) {
  const total = Math.max(1, (a.on_time || 0) + (a.late || 0) + (a.missed || 0));
  const W = 96, H = 6;
  let x = 0;
  const seg = (n, fill) => { if (!n) return ''; const w = (n / total) * W; const r = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="${fill}"/>`; x += w; return r; };
  return `<svg class="rh-bar" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><clipPath id="rhc-${esc(a.athlete_id)}"><rect width="${W}" height="${H}" rx="3"/></clipPath><g clip-path="url(#rhc-${esc(a.athlete_id)})"><rect width="${W}" height="${H}" fill="var(--surface-3)"/>${seg(a.on_time, 'var(--green)')}${seg(a.late, 'var(--amber)')}${seg(a.missed, 'var(--red)')}</g></svg>`;
}

function histRow(a, needs) {
  const name = String(a.name || 'Athlete');
  const rate = Math.round(a.on_time_pct);
  return `<li class="lrow rh-row">
    <span class="rh-av" data-avatar-uid="${esc(a.athlete_id)}" aria-hidden="true"><span data-avatar-fallback>${esc(initialsOf(name, '?'))}</span></span>
    <div class="lm"><div class="lt">${esc(name)}</div><div class="ls">${esc(subLine(a, needs))}</div>${mornBar(a)}</div>
    <span class="rh-rate ${tierFor(rate).cls}">${rate}%</span>
  </li>`;
}

/** The history body, pure over the rollcall_history payload. */
export function historyHtml(h) {
  const { attention, reliable } = historyGroups(h);
  if (!attention.length && !reliable.length) {
    return emptyState({ icon: 'clock', title: 'No mornings yet', body: 'History starts once the first roll call closes.' });
  }
  const team = isMin(h.team_on_time_pct) ? Math.round(h.team_on_time_pct) : null;
  const n = attention.length + reliable.length;
  const mornings = Math.max(0, ...attention.concat(reliable).map((a) => a.mornings || 0));
  const trend = Number(h.team_trend) || 0;
  const trendLine = trend > 0 ? `Up ${trend} points since the first half of the month.`
    : trend < 0 ? `Down ${-trend} points since the first half of the month.` : 'Holding steady across the month.';
  const hero = `<section class="rfig rh-hero" aria-label="Team on time">
    <div class="rfig-n"><span class="rh-rate ${team == null ? '' : tierFor(team).cls}">${team == null ? 'No rate yet' : `${team}%`}</span></div>
    <div class="rfig-k">On time, ${n} ${n === 1 ? 'athlete' : 'athletes'} over ${mornings} ${mornings === 1 ? 'morning' : 'mornings'}</div>
    <div class="rfig-s${trend < 0 ? ' a' : ''}">${esc(trendLine)}</div>
  </section>`;
  const group = (label, list, needs, cls) => (list.length
    ? `<h2 class="eyebrow rh-h${cls ? ` ${cls}` : ''}">${label} <span class="rh-hn">${list.length}</span></h2>
       <ul class="card rows list rh-list">${list.map((a) => histRow(a, needs)).join('')}</ul>` : '');
  return `${hero}${group('Needs attention', attention, true, 'a')}${group('Reliable', reliable, false, '')}`;
}

const HIST = { forId: null, failed: false };

export const rollcallHistory = {
  nav: 'operator', tab: 'home',
  render({ sub } = {}) {
    const back = sub ? `rollcall/${sub}` : (CD.kind === 'practice' ? 'trainer' : 'coach-home');
    if (!sub) {
      if (VC.commitments && VC.commitments.length && !firstRollcall()) return noRollcallYet('Roll call history', back);
      return `${backHead('Roll call history', 'Loading…', back)}${skeletonRows(4, 'Loading history')}`;
    }
    const rule = ruleOf(sub);
    const sub2 = `Last 30 days${rule && rule.title ? ` · ${rule.title}` : ''}`;
    const h = VC.history(sub, 30);
    if (!h) {
      if (HIST.forId === sub && HIST.failed) {
        return `${backHead('Roll call history', sub2, back)}${errorState({ title: 'History didn’t load', body: 'Reconnect and it loads right here.', retryId: 'rh-retry' })}`;
      }
      return `${backHead('Roll call history', sub2, back)}${skeletonRows(5, 'Loading history')}`;
    }
    return `${backHead('Roll call history', sub2, back)}${historyHtml(h)}`;
  },
  mount(root, { sub } = {}) {
    ensureBook();
    const rerender = () => { if (root.isConnected && window.__render) window.__render(); };
    const owner = bookId();
    if (!sub) {
      const go = () => { const r = firstRollcall(); if (r) location.replace(`#rollcall-history/${r.id}`); else rerender(); };
      if (firstRollcall()) { go(); return; }
      if (owner) loadCommitments(owner, CD.kind).then(go, () => {});
      return;
    }
    const hadRule = !!ruleOf(sub);
    if (owner) loadCommitments(owner, CD.kind).then(() => { if (!hadRule && ruleOf(sub)) rerender(); }, () => {});
    const had = !!VC.history(sub, 30);
    HIST.forId = sub;
    loadRollcallHistory(sub, 30).then((h) => {
      if (!h) { const was = HIST.failed; HIST.failed = true; if (!was) rerender(); return; }
      HIST.failed = false;
      if (!had) rerender();
    });
    const retry = root.querySelector('#rh-retry');
    if (retry) retry.addEventListener('click', async () => {
      retry.disabled = true;
      const h = await loadRollcallHistory(sub, 30, true);
      HIST.failed = !h;
      rerender();
    });
  },
};

export default rollcallWeek;
