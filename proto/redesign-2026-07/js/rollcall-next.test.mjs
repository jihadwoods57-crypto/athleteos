/* The athlete's next roll call. Run: node --test proto/redesign-2026-07/js/rollcall-next.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { upcomingWakeups, nextWakeup, alarmLine, whenLabel, daysLabel, assignedModel, nextCardHtml, nextCardRoute, pointsLine } from './rollcall-next.js';
import { weightsForAssigned } from './plan-style.js';

const NOW = new Date(2026, 8, 24, 20, 0).getTime();          // Thu 24 Sep 2026, 8:00 PM, phone clock
const at = (d, h, m) => new Date(2026, 8, d, h, m).toISOString();
const row = (o = {}) => ({ type: 'morning_roll_call', instance_id: 'aaaaaaaa-0000-0000-0000-000000000001', commitment_id: 'c1',
  title: 'Morning Roll Call', coach_name: 'Coach Brooks', message: 'Up and at it.', starts_at: at(25, 4, 45),
  status: 'pending', instance_status: 'scheduled', alarm: true, ...o });

test('upcoming wake-ups: ahead, on, not excused, not answered, deduped, soonest first', () => {
  const rows = [row({ instance_id: 'b', starts_at: at(28, 4, 45) }), row(), row(),
    row({ instance_id: 'c', instance_status: 'cancelled' }), row({ instance_id: 'd', status: 'excused' }),
    row({ instance_id: 'e', starts_at: at(24, 4, 45) }), row({ instance_id: 'f', type: 'practice' })];
  assert.deepEqual(upcomingWakeups(rows, NOW).map((r) => r.instance_id), ['aaaaaaaa-0000-0000-0000-000000000001', 'b']);
  assert.equal(nextWakeup([], NOW), null);
});

test('alarmLine: the truth about THIS phone and THIS morning', () => {
  const r = row();
  assert.equal(alarmLine(null, r), null, 'no bridge (web preview): say nothing');
  assert.deepEqual(alarmLine({ supported: true, authorization: 'authorized', armed: 1, ids: ['AAAAAAAA-0000-0000-0000-000000000001'.toLowerCase()] }, r),
    { kind: 'set', text: 'Alarm set ✓', fix: null });
  assert.deepEqual(alarmLine({ supported: true, authorization: 'authorized', armed: 1, ids: ['other'] }, r),
    { kind: 'sync', text: 'Alarm not set · Tap to fix', fix: 'sync' });
  assert.equal(alarmLine({ supported: true, authorization: 'notDetermined', armed: 0, ids: [] }, r).fix, 'ask');
  assert.equal(alarmLine({ supported: true, authorization: 'denied', armed: 0, ids: [] }, r).fix, 'settings');
  assert.equal(alarmLine({ supported: false }, r).kind, 'unsupported');
  assert.equal(alarmLine({ supported: true, authorization: 'authorized', ids: [] }, row({ alarm: false })).kind, 'coach_off');
  assert.equal(alarmLine({ supported: true, authorization: 'authorized', armed: 1 }, r).kind, 'set', 'an older shell without ids falls back to the count');
});

test('whenLabel reads Tomorrow, then weekday names', () => {
  assert.equal(whenLabel(row(), NOW), 'Tomorrow · 4:45 AM');
  assert.equal(whenLabel(row({ starts_at: at(28, 4, 45) }), NOW), 'Mon · 4:45 AM');
});

test('daysLabel says the week the way a coach does', () => {
  assert.equal(daysLabel([1, 2, 3, 4, 5]), 'Mon–Fri');
  assert.equal(daysLabel([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.equal(daysLabel([5, 1, 3]), 'Mon, Wed, Fri');
  assert.equal(daysLabel([]), '');
});

test('assignedModel: one roll call, its next mornings, its words', () => {
  const rows = [row(), row({ instance_id: 'b', starts_at: at(28, 4, 45) }), row({ instance_id: 'z', commitment_id: 'c2' })];
  const m = assignedModel(rows, 'c1', NOW);
  assert.equal(m.title, 'Morning Roll Call');
  assert.equal(m.coach, 'Coach Brooks');
  assert.equal(m.upcoming.length, 2);
  assert.equal(m.days, 'Mon, Fri');
  assert.equal(assignedModel(rows, 'nope', NOW), null);
});

test('the Home card: route, message, the alarm pill, no em dash', () => {
  const set = nextCardHtml(row(), { kind: 'set', text: 'Alarm set ✓', fix: null }, NOW);
  assert.match(set, /data-go="rollcall-assigned\/c1"/);
  assert.match(set, /Tomorrow · 4:45 AM/);
  assert.match(set, /Up and at it\./);
  assert.match(set, /status-pill g">Alarm set ✓/);
  assert.match(nextCardHtml(row(), { kind: 'ask', text: 'Alarm not set · Tap to fix', fix: 'ask' }, NOW), /class="status-pill b rn-fix"/, 'Tap to fix is selection blue, never amber');
  assert.doesNotMatch(set, /data-rn-fix/);
  const fix = nextCardHtml(row(), { kind: 'ask', text: 'Alarm not set · Tap to fix', fix: 'ask' }, NOW);
  assert.match(fix, /<button[^>]*data-rn-fix="ask"[^>]*>Alarm not set · Tap to fix</);
  assert.doesNotMatch(set + fix, /—/);
  assert.equal(nextCardHtml(null, null, NOW), '');
});

test('the points line never overclaims: the night budget is shared', () => {
  // The shared case: a Recovery Standard on the same day halves the morning (8 -> 4).
  assert.equal(Math.round(weightsForAssigned('athlete', { wakeup: true, sleep: true }).wakeup * 100), 4);
  assert.equal(pointsLine({ sleep: true }), 'Up on time counts +4 on your day. Late counts half.');
  assert.equal(pointsLine({ sleep: true, arrival: true }), 'Up on time counts +3 on your day. Late counts half.');
  assert.equal(pointsLine({}), 'Up on time counts +8 on your day. Late counts half.');
  // Unknown (the assignment screen): no number at all.
  assert.equal(pointsLine(null), 'Up on time counts toward your day. Late counts half.');
  assert.doesNotMatch(pointsLine(null), /\d/);
});

/* ---- final review C1: the REAL my_commitments row ----
   The fixtures above (and sb-stub / qc-capture) carried commitment_id long before the server did,
   which is how "No roll call ahead" shipped past every test. These build the row from the keys the
   LATEST migration that defines my_commitments actually returns, so a key the server drops fails here. */
const MIG = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
function realRowKeys() {
  const files = readdirSync(MIG).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  let body = '';
  for (const f of files) {
    const sql = readFileSync(MIG + f, 'utf8');
    const i = sql.search(/function\s+(public\.)?my_commitments\s*\(\s*p_from\s+date\s*,\s*p_to\s+date\s*\)/i);
    if (i >= 0) {
      const end = sql.indexOf('$function$;', i) >= 0 ? sql.indexOf('$function$;', i) : sql.indexOf('$$;', i);
      body = sql.slice(i, end);
    }
  }
  return [...body.matchAll(/'([a-z_]+)',\s*[^,'\n]/g)].map((m) => m[1]);
}

test('C1: the latest my_commitments returns commitment_id (the screen and the link key on it)', () => {
  const keys = realRowKeys();
  assert.ok(keys.includes('instance_id') && keys.includes('starts_at'), 'parsed the real key list');
  assert.ok(keys.includes('commitment_id'), 'my_commitments must return commitment_id');
});

test('C1: assignedModel and the Home link on a row with exactly the real keys', () => {
  const keys = realRowKeys();
  const values = {
    instance_id: 'aaaaaaaa-0000-0000-0000-00000000000a', commitment_id: 'cccccccc-0000-0000-0000-00000000000c',
    type: 'morning_roll_call', title: 'Morning Roll Call', coach_name: 'Coach Brooks', message: 'Up.',
    starts_at: at(25, 4, 45), status: 'pending', instance_status: 'scheduled', alarm: true, acknowledged_at: null,
  };
  const real = Object.fromEntries(keys.map((k) => [k, k in values ? values[k] : null]));
  const m = assignedModel([real], 'cccccccc-0000-0000-0000-00000000000c', NOW);
  assert.ok(m, 'the assignment screen finds the roll call on the real row');
  assert.equal(m.next.instance_id, 'aaaaaaaa-0000-0000-0000-00000000000a');
  assert.match(nextCardHtml(real, null, NOW), /data-go="rollcall-assigned\/cccccccc-0000-0000-0000-00000000000c"/);
});

test('C1: the Home link always carries an id; an empty id matches nothing', () => {
  const noCid = row({ commitment_id: undefined });
  assert.equal(nextCardRoute(noCid), 'rollcall-board/aaaaaaaa-0000-0000-0000-000000000001');
  assert.doesNotMatch(nextCardHtml(noCid, null, NOW), /rollcall-assigned\/"/);
  assert.equal(assignedModel([noCid], '', NOW), null);
  assert.equal(assignedModel([noCid], undefined, NOW), null);
  assert.equal(nextCardRoute(row()), 'rollcall-assigned/c1');
});
