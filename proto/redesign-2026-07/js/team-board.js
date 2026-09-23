/* OnStandard: the roll call's team board, as a pure model and its markup (roll call rebuilt,
   2026-09-23). The founder's heart of the rebuild: every teammate's face lights up in the order
   they got up, the first one up is called out, late and missing stay visible.

   THE SERVER DECIDES, THIS FILE ARRANGES. Every verdict here is the one rollcall_team_board (0242)
   returned: `verdict` (on_standard | late | review | pending | missed | excused) groups the faces,
   `place` is the athlete's place in line, and `arrival_verdict` (on_standard | late | pending |
   unverified | missed | excused) is the place check. Nothing is re-derived from timestamps, so the
   athlete's board, the coach's board, the lock-screen card and the closing summary cannot disagree.
   A delayed-sync answer still under REVIEW is not up: it has no place until a coach resolves it.

   Pure and dependency-light on purpose: node --test holds it without a DOM. Hence the local esc
   (components.js drags state.js in, which touches window at import; same call audience.js made)
   and initials.js, a leaf. Faces hydrate through the shared avatar seam: `data-avatar-uid` plus
   an initials fallback, which the router's hydrateAvatars() upgrades to the photo. avatar_path is
   never turned into a URL here.

   Not in the eager boot graph: only the lazily loaded roll-call screens import it.

   Styles: css/screens.css, the `rb-` block. */
import { initialsOf } from './initials.js';
import { clockTime } from './fmt-date.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]); }

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st, 22nd. */
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const words = (name) => String(name || '').trim().split(/\s+/).filter(Boolean);
const first = (name) => words(name)[0] || '';
const lastInitial = (name) => { const w = words(name); return w.length > 1 ? `${[...w[w.length - 1]][0]}.` : ''; };

/* The time on a tile, without the AM/PM: a roll call's times all sit inside one short window, so
   "5:52" reads at a glance where "5:52 AM" doubles the width of every caption. The device's own
   clock convention otherwise (a 24-hour phone keeps "05:52"). */
function clock(iso) {
  return clockTime(iso).replace(/\s?[AaPp]\.?\s?[Mm]\.?$/, '').trim();
}
const at = (iso) => { const t = Date.parse(iso || ''); return isFinite(t) ? t : null; };
const byTime = (key) => (a, b) => (at(a[key]) ?? Infinity) - (at(b[key]) ?? Infinity);
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

/* The board's MODE (0242, fix round 1, controller ruling): 'wake' a morning roll call with no
   place, 'both' a morning roll call with a place, 'arrival' any other commitment type with a place
   (no alarm, no I'm Up: the arrival IS the answer). A board from before the server sent `mode`
   falls back on asks_arrival, which can tell 'wake' from 'both' but never 'arrival'. */
export function boardMode(board) {
  const m = board && board.mode;
  if (m === 'wake' || m === 'both' || m === 'arrival') return m;
  return board && board.asks_arrival ? 'both' : 'wake';
}

/** The board, arranged. `board` is rollcall_team_board's answer; `selfId` the signed-in athlete
 *  (null for a coach); `nowISO` the clock the caller renders against.
 *    mode         'wake' | 'both' | 'arrival' (boardMode)
 *    upCount      answers that count: on time + late (never an unresolved review). In 'arrival'
 *                 mode, arrivals that count (arrival_verdict on_standard + late)
 *    total        everyone the roll call is asking, excused left out (as the score does)
 *    arrivedCount responders with an arrival, excused left out
 *    firstUp      { name, time } of the earliest answer (arrival, in 'arrival' mode) that counts
 *    me           { place, verdict } for selfId, or null when they are not on this board; in
 *                 'arrival' mode verdict is the arrival_verdict and place the arrival order
 *    groups       up (on time) and late in answer order; waiting (not up yet, and answers under
 *                 review), missed, excused by name; unverified (arrival mode only: the phone could
 *                 not confirm the place, a neutral state, never a miss)
 *    closed       the roll call's window has closed (by instant, not by string)
 *    asksArrival  the roll call carries a place check
 *  plus `info` (title, coach, place name and the instance's times, for the screen's header),
 *  `names` (display name per athlete id: first name, last initial added when two share one) and
 *  `places` (arrival mode: athlete id -> arrival order).
 *  Every verdict is the server's; in 'arrival' mode the only thing computed here is the ORDER of
 *  arrival, from arrived_at, because the server's `place` counts wake-up answers. */
export function boardModel(board, selfId, nowISO) {
  const b = board && typeof board === 'object' ? board : {};
  const rows = Array.isArray(b.rows) ? b.rows.filter((r) => r && typeof r === 'object') : [];
  const now = at(nowISO), close = at(b.closes_at);
  const closed = now != null && close != null && now > close;
  const mode = boardMode(b);
  const arrival = mode === 'arrival';
  const key = arrival ? 'arrived_at' : 'acknowledged_at';
  const sorted = byTime(key);

  const groups = { up: [], late: [], waiting: [], missed: [], excused: [], unverified: [] };
  for (const r of rows) {
    const v = arrival ? (r.verdict === 'excused' ? 'excused' : r.arrival_verdict) : r.verdict;
    if (v === 'on_standard') groups.up.push(r);
    else if (v === 'late') groups.late.push(r);
    else if (v === 'missed') groups.missed.push(r);
    else if (v === 'excused') groups.excused.push(r);
    else if (arrival && v === 'unverified') groups.unverified.push(r);
    else groups.waiting.push(r);   // pending, review, or anything the server adds later
  }
  groups.up.sort(sorted); groups.late.sort(sorted);
  groups.waiting.sort(byName); groups.missed.sort(byName); groups.excused.sort(byName); groups.unverified.sort(byName);

  // Display names: first name, told apart by last initial only when two teammates share one.
  const count = new Map();
  for (const r of rows) { const f = first(r.name).toLowerCase(); count.set(f, (count.get(f) || 0) + 1); }
  const names = {};
  for (const r of rows) {
    const f = first(r.name);
    names[r.athlete_id] = (count.get(f.toLowerCase()) > 1 && lastInitial(r.name)) ? `${f} ${lastInitial(r.name)}` : (f || 'Teammate');
  }

  const counted = groups.up.concat(groups.late).sort(sorted);
  // Arrival mode: the place in line is the arrival order (the server's `place` is the wake-up's).
  const places = new Map();
  if (arrival) counted.forEach((r, i) => places.set(r.athlete_id, i + 1));
  const placeOf = (r) => (arrival ? places.get(r.athlete_id) || null : r.place || null);
  const firstRow = counted[0] || null;
  const mine = selfId ? rows.find((r) => r.athlete_id === selfId) || null : null;
  const myVerdict = mine && (arrival ? (mine.verdict === 'excused' ? 'excused' : mine.arrival_verdict) : mine.verdict);
  return {
    mode,
    upCount: counted.length,
    total: rows.filter((r) => r.verdict !== 'excused').length,
    arrivedCount: rows.filter((r) => r.arrived_at && r.verdict !== 'excused').length,
    firstUp: firstRow ? { id: firstRow.athlete_id, name: names[firstRow.athlete_id], fullName: String(firstRow.name || ''), time: clock(firstRow[key]) } : null,
    me: mine ? { place: placeOf(mine), verdict: myVerdict } : null,
    groups, closed, asksArrival: !!b.asks_arrival || arrival, selfId: selfId || null, names, places,
    info: {
      instanceId: b.instance_id || null, title: b.title || '', coachName: b.coach_name || '',
      locationName: b.location_name || '', startsAt: b.starts_at || null,
      respondByAt: b.respond_by_at || null, closesAt: b.closes_at || null, arriveByAt: b.arrive_by_at || null,
    },
  };
}

/* ---------------------------------------------------------------- markup */

/* The place check, per tile, straight off the server's arrival_verdict. Sentence case, one colour
   per meaning: green here on time, amber here late (a real warning), red only for a miss (which
   the server only returns once the arrival deadline and the close have both passed), neutral for
   not here yet and for a phone that could not confirm the place (unverified is never a miss).
   Returns [markup, words for a screen reader]. */
function arrivalLine(r) {
  const t = clock(r.arrived_at);
  switch (r.arrival_verdict) {
    case 'on_standard': return [`<span class="rb-arr g">Here ${esc(t)}</span>`, `here at ${t}`];
    case 'late': return [`<span class="rb-arr a">Here ${esc(t)}</span>`, `here late at ${t}`];
    case 'pending': return ['<span class="rb-arr">Not here yet</span>', 'not here yet'];
    case 'unverified': return ['<span class="rb-arr">Unverified</span>', 'place not confirmed'];
    case 'missed': return ['<span class="rb-arr r">Not here</span>', 'not here'];
    default: return ['', ''];
  }
}

const GROUP_WORDS = {
  up: 'on time', late: 'late', waiting: 'not up yet', missed: 'missed', excused: 'excused', unverified: 'place not confirmed',
};
const GROUP_WORDS_ARRIVAL = { ...GROUP_WORDS, up: 'here on time', late: 'here late', waiting: 'not here yet', missed: 'not here' };

/* One face. `kind` is the group: up | late | waiting | missed | excused | unverified. */
function tile(r, kind, m, coach) {
  const me = !coach && m.selfId && r.athlete_id === m.selfId;
  const arrivalMode = m.mode === 'arrival';
  const name = me ? 'You' : m.names[r.athlete_id];
  const fullName = String(r.name || name);
  const place = arrivalMode ? (m.places && m.places.get(r.athlete_id)) : r.place;
  const t = clock(arrivalMode ? r.arrived_at : r.acknowledged_at);
  let meta = '';
  if (kind === 'up' || kind === 'late') {
    meta = `<span class="rb-meta">${place ? `${ordinal(place)} · ` : ''}<span class="rb-t">${esc(t)}</span></span>`;
  } else if (kind === 'waiting' && r.verdict === 'review') {
    meta = '<span class="rb-meta">Being checked</span>';
  } else if (kind === 'missed') {
    meta = `<span class="rb-meta">${arrivalMode ? 'Not here' : 'Missed'}</span>`;
  } else if (kind === 'excused') {
    meta = '<span class="rb-meta">Excused</span>';
  } else if (kind === 'unverified') {
    meta = '<span class="rb-meta">Unverified</span>';
  }
  // In arrival mode the arrival IS the tile; in 'both' it is a second line under the wake-up.
  const [arr, arrWords] = m.asksArrival && !arrivalMode && kind !== 'excused' ? arrivalLine(r) : ['', ''];
  const cls = `rb-tile ${kind}${me ? ' me' : ''}`;
  const face = `<span class="rb-av" data-avatar-uid="${esc(r.athlete_id)}" aria-hidden="true"><span data-avatar-fallback>${esc(initialsOf(r.name, '?'))}</span></span>`;
  const body = `${face}<span class="rb-name">${esc(name)}</span>${meta}${arr}`;
  if (coach) {
    // The button's label replaces its contents for a screen reader, so it carries all of them:
    // who, which group, place and time, and the place check.
    const words = (arrivalMode ? GROUP_WORDS_ARRIVAL : GROUP_WORDS)[kind] || '';
    const when = (kind === 'up' || kind === 'late') ? `, ${place ? `${ordinal(place)} at ` : 'at '}${t}` : '';
    const label = `${fullName}, ${words}${when}${arrWords ? `, ${arrWords}` : ''}. Nudge or override`;
    return `<li><button type="button" class="${cls}" data-rb-athlete="${esc(r.athlete_id)}" aria-label="${esc(label)}">${body}</button></li>`;
  }
  // The name already reads "You" on the athlete's own tile; nothing is added, so it is said once.
  return `<li><div class="${cls}"${me ? ' aria-current="true"' : ''}>${body}</div></li>`;
}

function group(label, rows, kind, m, coach) {
  if (!rows || !rows.length) return '';
  return `<h2 class="eyebrow rb-h">${esc(label)}<span class="rb-hn">${rows.length}</span></h2>`
    + `<ul class="rb-grid ${kind}">${rows.map((r) => tile(r, kind, m, coach)).join('')}</ul>`;
}

/** The board's markup: the count, who was first up, the athlete's own place, then the faces.
 *  `coach` true makes every face a <button data-rb-athlete="id"> (the screen opens Nudge /
 *  Override from it); an athlete's faces are not controls, and their own tile is marked `.me`.
 *  In 'arrival' mode the board counts "here" instead of "up". Every name goes through esc; no
 *  coordinate is ever in a board row's rendered fields. */
export function boardHtml(model, { coach = false, when = '' } = {}) {
  const m = model || boardModel(null, null, null);
  const g = m.groups;
  const arrivalMode = m.mode === 'arrival';
  // The athlete's own place, in the one pill: green on time, amber late (a real warning).
  const isLate = m.me && m.me.verdict === 'late';
  const myRow = !coach && m.selfId ? g.up.concat(g.late).find((r) => r.athlete_id === m.selfId) : null;
  const myTime = myRow ? clock(arrivalMode ? myRow.arrived_at : myRow.acknowledged_at) : '';
  // The athlete's own place sits on the count row's right edge (one callout, not a pill of its
  // own): green on time, amber late. Once they are placed it replaces the clock line there.
  const you = !coach && m.me && m.me.place
    ? `<span class="rb-you ${isLate ? 'a' : 'g'}">You're ${esc(ordinal(m.me.place))}${arrivalMode ? ' here' : ''}${myTime ? ` · ${esc(myTime)}` : ''}${isLate ? ' · Late' : ''}</span>`
    : '';
  const nobody = m.closed ? 'Nobody checked in' : arrivalMode ? 'Nobody is here yet' : 'Nobody is up yet';
  // First up gets their own face beside the words: the one teammate the whole board calls out.
  const firstFace = m.firstUp && m.firstUp.id
    ? `<span class="rb-av sm" data-avatar-uid="${esc(m.firstUp.id)}" aria-hidden="true"><span data-avatar-fallback>${esc(initialsOf(m.firstUp.fullName || m.firstUp.name, '?'))}</span></span>`
    : '';
  const firstLine = m.firstUp
    ? `<p class="rb-first">${firstFace}<span>${arrivalMode ? 'First here' : 'First up'}: ${esc(m.firstUp.name)} · ${esc(m.firstUp.time)}</span></p>`
    : `<p class="rb-first none">${nobody}</p>`;
  const where = m.info && m.info.locationName ? m.info.locationName : '';
  const here = m.asksArrival && !arrivalMode
    ? `<p class="rb-here"><span class="rb-hn2">${m.arrivedCount}</span> of ${m.total} here${where ? ` · ${esc(where)}` : ''}</p>`
    : '';
  // `when` is the screen's clock line ("Closes 6:30"), set on the count's right edge.
  const aside = you || (when ? `<span class="rb-when">${esc(when)}</span>` : '');
  const count = arrivalMode
    ? `<div class="rb-countrow"><p class="rb-count"><span class="rb-n">${m.upCount}</span> of ${m.total} here</p>${aside}</div>${where ? `<p class="rb-here">${esc(where)}</p>` : ''}`
    : `<div class="rb-countrow"><p class="rb-count"><span class="rb-n">${m.upCount}</span> of ${m.total} up</p>${aside}</div>`;
  const hero = `<div class="rb-hero">${count}${firstLine}${here}</div>`;
  const kinds = ['up', 'late', 'waiting', 'missed', 'excused', 'unverified'];
  const empty = kinds.every((k) => !(g[k] && g[k].length))
    ? '<p class="rb-empty">No one is on this roll call yet.</p>' : '';
  return `<section class="rb${coach ? ' coach' : ''}" aria-label="Team board">`
    + hero + empty
    + group(arrivalMode ? 'Here on time' : 'On time', g.up, 'up', m, coach)
    + group(arrivalMode ? 'Here late' : 'Late', g.late, 'late', m, coach)
    + group(arrivalMode ? 'Not here yet' : 'Not up yet', g.waiting, 'waiting', m, coach)
    + group('Place not confirmed', g.unverified, 'unverified', m, coach)
    + group(arrivalMode ? 'Not here' : 'Missed', g.missed, 'missed', m, coach)
    + group('Excused', g.excused, 'excused', m, coach)
    + `</section>`;
}
