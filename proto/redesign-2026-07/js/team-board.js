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
const byAnswer = (a, b) => (at(a.acknowledged_at) ?? Infinity) - (at(b.acknowledged_at) ?? Infinity);
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

/** The board, arranged. `board` is rollcall_team_board's answer; `selfId` the signed-in athlete
 *  (null for a coach); `nowISO` the clock the caller renders against.
 *    upCount      answers that count: on time + late (never an unresolved review)
 *    total        everyone the roll call is asking, excused left out (as the score does)
 *    arrivedCount responders with an arrival, excused left out
 *    firstUp      { name, time } of the earliest answer that counts, or null
 *    me           { place, verdict } for selfId, or null when they are not on this board
 *    groups       up (on time) and late in answer order; waiting (not up yet, and answers under
 *                 review), missed, excused by name
 *    closed       the roll call's window has closed (by instant, not by string)
 *    asksArrival  the roll call carries a place check
 *  plus `info` (title, coach, place name and the instance's times, for the screen's header) and
 *  `names`, the display name per athlete id (first name; last initial added when two share one). */
export function boardModel(board, selfId, nowISO) {
  const b = board && typeof board === 'object' ? board : {};
  const rows = Array.isArray(b.rows) ? b.rows.filter((r) => r && typeof r === 'object') : [];
  const now = at(nowISO), close = at(b.closes_at);
  const closed = now != null && close != null && now > close;

  const groups = { up: [], late: [], waiting: [], missed: [], excused: [] };
  for (const r of rows) {
    const v = r.verdict;
    if (v === 'on_standard') groups.up.push(r);
    else if (v === 'late') groups.late.push(r);
    else if (v === 'missed') groups.missed.push(r);
    else if (v === 'excused') groups.excused.push(r);
    else groups.waiting.push(r);   // pending, review, or anything the server adds later
  }
  groups.up.sort(byAnswer); groups.late.sort(byAnswer);
  groups.waiting.sort(byName); groups.missed.sort(byName); groups.excused.sort(byName);

  // Display names: first name, told apart by last initial only when two teammates share one.
  const count = new Map();
  for (const r of rows) { const f = first(r.name).toLowerCase(); count.set(f, (count.get(f) || 0) + 1); }
  const names = {};
  for (const r of rows) {
    const f = first(r.name);
    names[r.athlete_id] = (count.get(f.toLowerCase()) > 1 && lastInitial(r.name)) ? `${f} ${lastInitial(r.name)}` : (f || 'Teammate');
  }

  const counted = groups.up.concat(groups.late).sort(byAnswer);
  const firstRow = counted[0] || null;
  const mine = selfId ? rows.find((r) => r.athlete_id === selfId) || null : null;
  return {
    upCount: counted.length,
    total: rows.filter((r) => r.verdict !== 'excused').length,
    arrivedCount: rows.filter((r) => r.arrived_at && r.verdict !== 'excused').length,
    firstUp: firstRow ? { name: names[firstRow.athlete_id], time: clock(firstRow.acknowledged_at) } : null,
    me: mine ? { place: mine.place || null, verdict: mine.verdict } : null,
    groups, closed, asksArrival: !!b.asks_arrival, selfId: selfId || null, names,
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
   not here yet and for a phone that could not confirm the place (unverified is never a miss). */
function arrivalLine(r) {
  switch (r.arrival_verdict) {
    case 'on_standard': return `<span class="rb-arr g">Here ${esc(clock(r.arrived_at))}</span>`;
    case 'late': return `<span class="rb-arr a">Here ${esc(clock(r.arrived_at))}</span>`;
    case 'pending': return '<span class="rb-arr">Not here yet</span>';
    case 'unverified': return '<span class="rb-arr">Unverified</span>';
    case 'missed': return '<span class="rb-arr r">Not here</span>';
    default: return '';
  }
}

/* One face. `kind` is the group: up | late | waiting | missed | excused. */
function tile(r, kind, m, coach) {
  const me = !coach && m.selfId && r.athlete_id === m.selfId;
  const name = me ? 'You' : m.names[r.athlete_id];
  const fullName = String(r.name || name);
  let meta = '';
  if (kind === 'up' || kind === 'late') {
    meta = `<span class="rb-meta">${r.place ? `${ordinal(r.place)} · ` : ''}<span class="rb-t">${esc(clock(r.acknowledged_at))}</span></span>`;
  } else if (kind === 'waiting' && r.verdict === 'review') {
    meta = '<span class="rb-meta">Being checked</span>';
  } else if (kind === 'missed') {
    meta = '<span class="rb-meta">Missed</span>';
  } else if (kind === 'excused') {
    meta = '<span class="rb-meta">Excused</span>';
  }
  const arr = m.asksArrival && kind !== 'excused' ? arrivalLine(r) : '';
  const cls = `rb-tile ${kind}${me ? ' me' : ''}`;
  const face = `<span class="rb-av" data-avatar-uid="${esc(r.athlete_id)}" aria-hidden="true"><span data-avatar-fallback>${esc(initialsOf(r.name, '?'))}</span></span>`;
  const body = `${face}<span class="rb-name">${esc(name)}</span>${meta}${arr}`;
  if (coach) {
    return `<li><button type="button" class="${cls}" data-rb-athlete="${esc(r.athlete_id)}" aria-label="${esc(fullName)}. Nudge or override">${body}</button></li>`;
  }
  return `<li><div class="${cls}"${me ? ' aria-current="true"' : ''}>${me ? '<span class="sr-only">You, </span>' : ''}${body}</div></li>`;
}

function group(label, rows, kind, m, coach) {
  if (!rows.length) return '';
  return `<h2 class="eyebrow rb-h">${esc(label)}<span class="rb-hn">${rows.length}</span></h2>`
    + `<ul class="rb-grid ${kind}">${rows.map((r) => tile(r, kind, m, coach)).join('')}</ul>`;
}

/** The board's markup: the count, who was first up, the athlete's own place, then the faces.
 *  `coach` true makes every face a <button data-rb-athlete="id"> (the screen opens Nudge /
 *  Override from it); an athlete's faces are not controls, and their own tile is marked `.me`.
 *  Every name goes through esc; no coordinate is ever in a board row's rendered fields. */
export function boardHtml(model, { coach = false } = {}) {
  const m = model || boardModel(null, null, null);
  const g = m.groups;
  // The athlete's own place, in the one pill: green on time, amber late (a real warning).
  const isLate = m.me && m.me.verdict === 'late';
  const you = !coach && m.me && m.me.place
    ? `<p class="rb-you"><span class="status-pill ${isLate ? 'a' : 'g'}">You're ${esc(ordinal(m.me.place))}${isLate ? ' · Late' : ''}</span></p>`
    : '';
  const firstLine = m.firstUp
    ? `<p class="rb-first">First up: ${esc(m.firstUp.name)} · ${esc(m.firstUp.time)}</p>`
    : `<p class="rb-first">${m.closed ? 'Nobody checked in' : 'Nobody is up yet'}</p>`;
  const here = m.asksArrival
    ? `<p class="rb-here"><span class="rb-hn2">${m.arrivedCount}</span> of ${m.total} here${m.info && m.info.locationName ? ` · ${esc(m.info.locationName)}` : ''}</p>`
    : '';
  const hero = `<div class="rb-hero">`
    + `<p class="rb-count"><span class="rb-n">${m.upCount}</span> of ${m.total} up</p>`
    + firstLine + here + you
    + `</div>`;
  const empty = !g.up.length && !g.late.length && !g.waiting.length && !g.missed.length && !g.excused.length
    ? '<p class="rb-empty">No one is on this roll call yet.</p>' : '';
  return `<section class="rb${coach ? ' coach' : ''}" aria-label="Team board">`
    + hero + empty
    + group('On time', g.up, 'up', m, coach)
    + group('Late', g.late, 'late', m, coach)
    + group('Not up yet', g.waiting, 'waiting', m, coach)
    + group('Missed', g.missed, 'missed', m, coach)
    + group('Excused', g.excused, 'excused', m, coach)
    + `</section>`;
}
