/* The team board's pure model and markup (roll call rebuilt, Task 8, 2026-09-23).
 *
 * The first four tests are the plan's, verbatim. The rest pin what the plan's sketch got wrong or
 * left open: a delayed-sync answer still under review is NOT up (it has no place in line until a
 * coach resolves it, 0212/0242), the arrival line reads the SERVER's arrival_verdict and never
 * re-derives one, and the markup has no coordinate in it even when a row carries one.
 *
 * Run: node --test proto/redesign-2026-07/js/team-board.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardModel, ordinal } from './team-board.js';

const B = { total: 5, up: 3, closes_at: '2026-09-25T10:30:00Z', asks_arrival: false, rows: [
  { athlete_id: 'd', name: 'DeShawn Cole', acknowledged_at: '2026-09-25T09:52:00Z', verdict: 'on_standard', place: 1 },
  { athlete_id: 'm', name: 'Marcus Reed', acknowledged_at: '2026-09-25T10:01:00Z', verdict: 'on_standard', place: 2 },
  { athlete_id: 't', name: 'Tyrek Malone', acknowledged_at: '2026-09-25T10:08:00Z', verdict: 'late', place: 3 },
  { athlete_id: 'v', name: 'Tommy Vargas', acknowledged_at: null, verdict: 'pending', place: null },
  { athlete_id: 'x', name: 'Ray Gomez', acknowledged_at: null, verdict: 'excused', place: null } ] };

test('groups follow the verdict, in arrival order', () => {
  const m = boardModel(B, 'm', '2026-09-25T10:10:00Z');
  assert.deepEqual(m.groups.up.map((r) => r.athlete_id), ['d', 'm']);
  assert.deepEqual(m.groups.late.map((r) => r.athlete_id), ['t']);
  assert.deepEqual(m.groups.waiting.map((r) => r.athlete_id), ['v']);
  assert.equal(m.firstUp.name, 'DeShawn');
  assert.deepEqual(m.me, { place: 2, verdict: 'on_standard' });
  assert.equal(m.closed, false);
});
test('after close, the not-up are missed', () => {
  const m = boardModel({ ...B, rows: B.rows.map((r) => r.athlete_id === 'v' ? { ...r, verdict: 'missed' } : r) }, 'm', '2026-09-25T10:31:00Z');
  assert.deepEqual(m.groups.missed.map((r) => r.athlete_id), ['v']);
  assert.equal(m.closed, true);
});
test('ordinals', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
});
test('the markup never contains coordinates and escapes names', async () => {
  const { boardHtml } = await import('./team-board.js');
  const html = boardHtml(boardModel({ ...B, rows: [{ ...B.rows[0], name: '<img onerror=1>' }] }, 'm', '2026-09-25T10:10:00Z'), { coach: false });
  assert.doesNotMatch(html, /<img onerror/);
  assert.doesNotMatch(html, /lat|lng/);
});

/* ---------------------------------------------------------------- beyond the plan's sketch */

test('counts: up is on time + late, total leaves the excused out, first up is by answer time', () => {
  const m = boardModel(B, 'm', '2026-09-25T10:10:00Z');
  assert.equal(m.upCount, 3);
  assert.equal(m.total, 4);
  assert.equal(m.firstUp.time.replace(/\s/g, ''), new Date('2026-09-25T09:52:00Z')
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AaPp]\.?\s?[Mm]\.?$/, '').replace(/\s/g, ''));
  assert.deepEqual(m.groups.excused.map((r) => r.athlete_id), ['x']);
});

test('an answer still under review is not up: no count, no first up, waiting with no place', () => {
  const rows = [
    { athlete_id: 'r', name: 'Andre Whitfield', acknowledged_at: '2026-09-25T09:40:00Z', verdict: 'review', place: null },
    ...B.rows,
  ];
  const m = boardModel({ ...B, rows }, 'r', '2026-09-25T10:10:00Z');
  assert.equal(m.upCount, 3, 'the review answer is not counted up');
  assert.equal(m.firstUp.name, 'DeShawn', 'the earliest tap under review does not claim first up');
  assert.ok(m.groups.waiting.some((r) => r.athlete_id === 'r'));
  assert.deepEqual(m.me, { place: null, verdict: 'review' });
});

test('closed reads the clock by instant, not by string compare', () => {
  // '+00:00' and 'Z' spell the same instant differently; a string compare gets this wrong.
  const m = boardModel({ ...B, closes_at: '2026-09-25T10:30:00+00:00' }, 'm', '2026-09-25T10:30:30.000Z');
  assert.equal(m.closed, true);
  assert.equal(boardModel({ ...B, closes_at: '2026-09-25T10:30:00+00:00' }, 'm', '2026-09-25T10:29:59Z').closed, false);
});

test('an empty or missing board is an honest empty model, never a throw', () => {
  for (const b of [null, undefined, {}, { rows: null }]) {
    const m = boardModel(b, 'm', '2026-09-25T10:10:00Z');
    assert.equal(m.upCount, 0);
    assert.equal(m.total, 0);
    assert.equal(m.firstUp, null);
    assert.equal(m.me, null);
  }
});

test('arrival: the count reads arrived rows, the tile reads the server arrival_verdict', async () => {
  const { boardHtml } = await import('./team-board.js');
  const rows = [
    { ...B.rows[0], arrived_at: '2026-09-25T10:41:00Z', arrival_verdict: 'on_standard' },
    { ...B.rows[1], arrived_at: null, arrival_verdict: 'pending' },
    // The phone could not confirm the place: the server says unverified, never missed.
    { ...B.rows[2], arrived_at: null, arrival_verdict: 'unverified' },
    // The client must NOT re-derive: an arrived_at the server judged late stays late.
    { ...B.rows[3], arrived_at: '2026-09-25T10:58:00Z', arrival_verdict: 'late' },
    B.rows[4],
  ];
  const m = boardModel({ ...B, asks_arrival: true, location_name: 'Weight room', rows }, 'm', '2026-09-25T10:45:00Z');
  assert.equal(m.asksArrival, true);
  assert.equal(m.arrivedCount, 2);
  const html = boardHtml(m, { coach: false });
  assert.match(html, /Here \d/);
  assert.match(html, /Not here yet/);
  assert.match(html, /Unverified/);
  assert.match(html, /rb-arr a/, 'a late arrival is amber');
  assert.match(html, /of 4 here/);
});

test('no arrival line at all when the roll call asks for no place', async () => {
  const { boardHtml } = await import('./team-board.js');
  const html = boardHtml(boardModel(B, 'm', '2026-09-25T10:10:00Z'), { coach: false });
  assert.doesNotMatch(html, /rb-arr/);
  assert.doesNotMatch(html, /here/i);
});

test('athlete markup: my tile is marked, first up is named, late time is amber, groups labelled', async () => {
  const { boardHtml } = await import('./team-board.js');
  const html = boardHtml(boardModel(B, 'm', '2026-09-25T10:10:00Z'), { coach: false });
  assert.match(html, /<span class="rb-n">3<\/span> of 4 up/);
  assert.match(html, /First up: DeShawn · \d/);
  assert.match(html, /class="rb-tile[^"]*\bme\b/);
  assert.match(html, /class="rb-tile late/);
  assert.match(html, /1st · /);
  assert.match(html, />Late</);
  assert.match(html, />Not up yet</);
  assert.match(html, />Excused</);
  assert.doesNotMatch(html, />Missed</, 'nobody is missed while the roll call is open');
  assert.doesNotMatch(html, /data-rb-athlete/, 'an athlete cannot act on a teammate');
  // Faces hydrate through the shared avatar seam, never a raw avatar_path URL.
  assert.match(html, /data-avatar-uid="d"/);
  assert.match(html, /<span data-avatar-fallback>DC<\/span>/);
});

test('coach markup: every face is a button carrying the athlete id', async () => {
  const { boardHtml } = await import('./team-board.js');
  const html = boardHtml(boardModel(B, null, '2026-09-25T10:10:00Z'), { coach: true });
  for (const id of ['d', 'm', 't', 'v', 'x']) assert.match(html, new RegExp(`<button type="button" class="rb-tile[^"]*" data-rb-athlete="${id}"`));
  assert.doesNotMatch(html, /\bme\b"/);
});

test('the missed group is labelled only once the board has closed', async () => {
  const { boardHtml } = await import('./team-board.js');
  const closed = { ...B, rows: B.rows.map((r) => r.athlete_id === 'v' ? { ...r, verdict: 'missed' } : r) };
  const html = boardHtml(boardModel(closed, 'm', '2026-09-25T10:31:00Z'), { coach: false });
  assert.match(html, />Missed</);
  assert.match(html, /class="rb-tile missed/);
});

test('two teammates with one first name are told apart by last initial', () => {
  const rows = [
    { athlete_id: 'a', name: 'Marcus Reed', acknowledged_at: '2026-09-25T09:50:00Z', verdict: 'on_standard', place: 1 },
    { athlete_id: 'b', name: 'Marcus Hill', acknowledged_at: '2026-09-25T09:55:00Z', verdict: 'on_standard', place: 2 },
  ];
  const m = boardModel({ ...B, rows }, null, '2026-09-25T10:10:00Z');
  assert.equal(m.firstUp.name, 'Marcus R.');
});

test('names are escaped everywhere they appear, first up and aria labels included', async () => {
  const { boardHtml } = await import('./team-board.js');
  const evil = '"><script>x</script>';
  const rows = [{ ...B.rows[0], name: evil }, { ...B.rows[3], name: `${evil} Two` }];
  for (const coach of [false, true]) {
    const html = boardHtml(boardModel({ ...B, rows }, 'm', '2026-09-25T10:10:00Z'), { coach });
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /"><script/);
  }
});

test('coordinates on a row never reach the markup', async () => {
  const { boardHtml } = await import('./team-board.js');
  const rows = [{ ...B.rows[0], lat: 28.60241, lng: -81.20012, arrival_verdict: 'on_standard', arrived_at: '2026-09-25T10:40:00Z' }];
  const html = boardHtml(boardModel({ ...B, asks_arrival: true, rows }, 'm', '2026-09-25T10:45:00Z'), { coach: true });
  assert.doesNotMatch(html, /28\.60|81\.20/);
});

/* ---------------------------------------------------------------- fix round 1 (2026-09-23) */

test('Missed renders only when the SERVER says missed, never from the clock', async () => {
  const { boardHtml } = await import('./team-board.js');
  // Past the close, but the server still says pending (e.g. a board read a second before the
  // escalation ran): the client does not promote it to missed on its own.
  const m = boardModel(B, 'm', '2026-09-25T11:00:00Z');
  assert.equal(m.closed, true);
  assert.deepEqual(m.groups.missed, []);
  const html = boardHtml(m, { coach: false });
  assert.doesNotMatch(html, />Missed</);
  assert.match(html, />Not up yet</);
});

test('the athlete reads "You" once; the coach label carries the group and the time', async () => {
  const { boardHtml } = await import('./team-board.js');
  const mine = boardHtml(boardModel(B, 'm', '2026-09-25T10:10:00Z'), { coach: false });
  const tileHtml = mine.slice(mine.indexOf('rb-tile up me'));
  assert.equal((tileHtml.slice(0, tileHtml.indexOf('</li>')).match(/You/g) || []).length, 1);
  assert.doesNotMatch(mine, /sr-only/);
  const coach = boardHtml(boardModel(B, null, '2026-09-25T10:10:00Z'), { coach: true });
  assert.match(coach, /aria-label="DeShawn Cole, on time, 1st at \d+:52\. Nudge or override"/);
  assert.match(coach, /aria-label="Tyrek Malone, late, 3rd at \d+:08\. Nudge or override"/);
  assert.match(coach, /aria-label="Tommy Vargas, not up yet\. Nudge or override"/);
  const placed = { ...B, asks_arrival: true, rows: [{ ...B.rows[0], arrival_verdict: 'pending' }] };
  assert.match(boardHtml(boardModel(placed, null, '2026-09-25T10:10:00Z'), { coach: true }),
    /aria-label="DeShawn Cole, on time, 1st at \d+:52, not here yet\. Nudge or override"/);
});

/* The three board modes (0242 fix round 1, controller ruling). */
const ARR = { mode: 'arrival', asks_arrival: true, location_name: 'Stadium', total: 5,
  closes_at: '2026-09-25T20:00:00Z', arrive_by_at: '2026-09-25T19:30:00Z', rows: [
  { athlete_id: 'a', name: 'Andre Whitfield', acknowledged_at: null, verdict: 'missed', place: null, arrived_at: '2026-09-25T19:25:00Z', arrival_verdict: 'on_standard' },
  { athlete_id: 'b', name: 'Marcus Reed', acknowledged_at: null, verdict: 'missed', place: null, arrived_at: '2026-09-25T19:12:00Z', arrival_verdict: 'on_standard' },
  { athlete_id: 'c', name: 'Tyrek Malone', acknowledged_at: null, verdict: 'missed', place: null, arrived_at: '2026-09-25T19:44:00Z', arrival_verdict: 'late' },
  { athlete_id: 'd', name: 'Jaylen Brooks', acknowledged_at: null, verdict: 'pending', place: null, arrived_at: null, arrival_verdict: 'pending' },
  { athlete_id: 'e', name: 'Tommy Vargas', acknowledged_at: null, verdict: 'pending', place: null, arrived_at: null, arrival_verdict: 'unverified' },
  { athlete_id: 'f', name: 'Ray Gomez', acknowledged_at: null, verdict: 'excused', place: null, arrived_at: null, arrival_verdict: 'excused' } ] };

test('arrival mode groups by the server arrival_verdict, in arrival order', () => {
  const m = boardModel(ARR, 'a', '2026-09-25T19:50:00Z');
  assert.equal(m.mode, 'arrival');
  assert.deepEqual(m.groups.up.map((r) => r.athlete_id), ['b', 'a']);
  assert.deepEqual(m.groups.late.map((r) => r.athlete_id), ['c']);
  assert.deepEqual(m.groups.waiting.map((r) => r.athlete_id), ['d']);
  assert.deepEqual(m.groups.unverified.map((r) => r.athlete_id), ['e']);
  assert.deepEqual(m.groups.excused.map((r) => r.athlete_id), ['f']);
  assert.deepEqual(m.groups.missed, [], 'the wake-up verdict is ignored in arrival mode');
  assert.equal(m.upCount, 3);
  assert.equal(m.total, 5);
  assert.equal(m.firstUp.name, 'Marcus');
  assert.deepEqual(m.me, { place: 2, verdict: 'on_standard' });
});

test('arrival mode markup counts here, not up, and shows unverified as its own neutral state', async () => {
  const { boardHtml } = await import('./team-board.js');
  const html = boardHtml(boardModel(ARR, 'a', '2026-09-25T19:50:00Z'), { coach: false });
  assert.match(html, /<span class="rb-n">3<\/span> of 5 here/);
  assert.doesNotMatch(html, / up</);
  assert.match(html, /First here: Marcus · /);
  assert.match(html, />Place not confirmed</);
  assert.match(html, /class="rb-tile unverified/);
  assert.match(html, />Not here yet</);
  assert.doesNotMatch(html, /rb-arr/, 'no second arrival line: the arrival is the tile');
  const closed = { ...ARR, rows: ARR.rows.map((r) => r.athlete_id === 'd' ? { ...r, arrival_verdict: 'missed' } : r) };
  assert.match(boardHtml(boardModel(closed, 'a', '2026-09-25T20:30:00Z'), { coach: false }), />Not here</);
});

test('mode falls back on asks_arrival when the server sent none (wake or both, never arrival)', async () => {
  const { boardMode } = await import('./team-board.js');
  assert.equal(boardMode({ asks_arrival: false }), 'wake');
  assert.equal(boardMode({ asks_arrival: true }), 'both');
  assert.equal(boardMode({ mode: 'arrival' }), 'arrival');
  assert.equal(boardMode(null), 'wake');
  assert.equal(boardModel({ ...B, mode: 'both', asks_arrival: true }, 'm', '2026-09-25T10:10:00Z').mode, 'both');
});
