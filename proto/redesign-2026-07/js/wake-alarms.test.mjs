/* Which mornings get a real alarm.
 *
 * Every rule here exists because breaking it rings somebody's phone wrongly, and an alarm that
 * fires when it should not is worse than one that never fires: it wakes an athlete at 5:45 for
 * something that is already over, and it is the kind of bug nobody reports, they just turn
 * notifications off.
 *
 * Run: node --test proto/redesign-2026-07/js/wake-alarms.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { alarmsFor, alarmTitle, alarmButtonLabel, MAX_ALARMS, HORIZON_DAYS, DEFAULT_BUTTON, withAckCodes, fetchAckCodes, _resetAckCodes, ACK_CODES_TTL_MS } from './wake-alarms.js';

const NOW = Date.parse('2026-09-11T12:00:00Z');
const inHours = (h) => new Date(NOW + h * 3600000).toISOString();
const row = (over = {}) => ({
  type: 'morning_roll_call',
  instance_id: 'i1',
  starts_at: inHours(18),
  verdict: null,
  status: 'pending',
  title: 'Team wake-up',
  ...over,
});

test('a wake-up still ahead is armed, on the local clock', () => {
  const at = new Date(NOW + 18 * 3600000);
  const out = alarmsFor([row()], NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].instanceId, 'i1');
  assert.equal(out[0].hour, at.getHours(), 'the alarm rings on the athlete own clock');
  assert.equal(out[0].minute, at.getMinutes());
  assert.deepEqual(out[0].weekdays, [], 'a dated instance is a one-off, never a weekly recurrence');
  assert.equal(out[0].title, 'Team wake-up');
});

test('nothing else on the board takes over a screen', () => {
  const others = [row({ type: 'practice' }), row({ type: 'lift', instance_id: 'i2' })];
  assert.deepEqual(alarmsFor(others, NOW), []);
});

test('a morning already behind us is never armed', () => {
  assert.deepEqual(alarmsFor([row({ starts_at: inHours(-1) })], NOW), [],
    'ringing for a roll call that already closed wakes an athlete for nothing they can answer');
  assert.deepEqual(alarmsFor([row({ starts_at: inHours(0) })], NOW), []);
});

test('a morning past the horizon waits for a later sync', () => {
  assert.deepEqual(alarmsFor([row({ starts_at: inHours(HORIZON_DAYS * 24 + 1) })], NOW), []);
  assert.equal(alarmsFor([row({ starts_at: inHours(HORIZON_DAYS * 24 - 1) })], NOW).length, 1);
});

test('a morning the clock has already judged is never armed', () => {
  for (const verdict of ['on_standard', 'late', 'missed', 'excused']) {
    assert.deepEqual(alarmsFor([row({ verdict })], NOW), [], `verdict ${verdict} still armed`);
  }
  assert.equal(alarmsFor([row({ verdict: 'pending' })], NOW).length, 1,
    'pending is the only state a morning still ahead of us can be in');
});

test('an athlete who already answered is not woken by it anyway', () => {
  assert.deepEqual(alarmsFor([row({ status: 'acknowledged' })], NOW), []);
  assert.deepEqual(alarmsFor([row({ status: 'excused' })], NOW), []);
});

test('one alarm per instance, nearest morning first', () => {
  const rows = [
    row({ instance_id: 'late', starts_at: inHours(40) }),
    row({ instance_id: 'soon', starts_at: inHours(14) }),
    row({ instance_id: 'soon', starts_at: inHours(15) }), // a duplicate row for the same morning
    row({ instance_id: 'mid', starts_at: inHours(30) }),
  ];
  assert.deepEqual(alarmsFor(rows, NOW).map((a) => a.instanceId), ['soon', 'mid', 'late']);
});

test('a runaway row set cannot fill a phone with alarms', () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    row({ instance_id: `i${i}`, starts_at: inHours(1 + i * 0.1) }));
  assert.equal(alarmsFor(many, NOW).length, MAX_ALARMS);
});

test('a malformed row is skipped rather than thrown on', () => {
  for (const rows of [null, undefined, [null], [{}], ['nonsense'], [row({ starts_at: 'not a date' })],
    [row({ instance_id: null })], [row({ instance_id: '' })]]) {
    assert.doesNotThrow(() => alarmsFor(rows, NOW));
    assert.deepEqual(alarmsFor(rows, NOW), []);
  }
});

test('the title is the coach own words, or an honest default', () => {
  assert.equal(alarmTitle({ title: 'Varsity lift' }), 'Varsity lift');
  assert.equal(alarmTitle({ commitment_title: 'Squad run' }), 'Squad run');
  assert.equal(alarmTitle({ title: '   ' }), 'Wake up');
  assert.equal(alarmTitle({}), 'Wake up');
  assert.equal(alarmTitle(null), 'Wake up');
  assert.equal(alarmTitle({ title: 'x'.repeat(200) }).length, 80, 'bounded before it reaches native');
});

test('the payload carries only what native needs, including the exact instant', () => {
  const [a] = alarmsFor([row()], NOW);
  assert.deepEqual(Object.keys(a).sort(),
    ['at', 'buttonLabel', 'hour', 'instanceId', 'minute', 'title', 'weekdays']);
  assert.equal(a.at, Date.parse(inHours(18)), 'the dated instant rides across the bridge');
});

test('two mornings at the same clock time on different days are two alarms, not one', () => {
  // The first build armed hour:minute only. AlarmKit's relative schedule fires at the NEXT 6:00,
  // so tomorrow and the day after collapsed into one alarm tomorrow. `at` is what keeps them apart.
  const out = alarmsFor([row({ instance_id: 'd1', starts_at: inHours(18) }), row({ instance_id: 'd2', starts_at: inHours(42) })], NOW);
  assert.equal(out.length, 2);
  assert.equal(out[0].hour, out[1].hour);
  assert.equal(out[0].minute, out[1].minute);
  assert.notEqual(out[0].at, out[1].at);
  assert.equal(out[1].at - out[0].at, 24 * 3600000);
});

/* ------------------------------------------------------ the coach configures it in the app */

test('a coach who turned the alarm off gets no alarm', () => {
  assert.deepEqual(alarmsFor([row({ alarm: false })], NOW), [],
    'taking over a phone at 5:45 is the coach decision, and they said no');
});

test('a wake-up from before the switch existed still rings', () => {
  // 0234 resolves a missing flag to true server-side. If the client disagreed, turning the
  // feature on would silently do nothing for every roll call that already exists.
  assert.equal(alarmsFor([row({ alarm: undefined })], NOW).length, 1);
  assert.equal(alarmsFor([row({ alarm: true })], NOW).length, 1);
  const { alarm, ...noFlag } = row();
  assert.equal(alarmsFor([noFlag], NOW).length, 1, 'an absent key is not an off switch');
});

test('the alarm button says what the coach typed', () => {
  const [a] = alarmsFor([row({ action_label: 'Let’s go' })], NOW);
  assert.equal(a.buttonLabel, 'Let’s go');
});

test('a coach who named no button gets the app own roll-call word', () => {
  assert.equal(alarmButtonLabel({}), DEFAULT_BUTTON);
  assert.equal(alarmButtonLabel({ action_label: '   ' }), DEFAULT_BUTTON);
  assert.equal(alarmButtonLabel(null), DEFAULT_BUTTON);
  // Pinned to commitments.js DEFAULT_ACTION.morning_roll_call. The alarm, the lock-screen card
  // and the in-app row must say ONE word; the alarm used to invent its own.
  assert.equal(DEFAULT_BUTTON, 'I’m Up');
});

test('the button label is bounded, because iOS truncates it without saying so', () => {
  // 24 is the coach composer own maxlength; this is the backstop for anything that gets past it.
  assert.equal(alarmButtonLabel({ action_label: 'y'.repeat(200) }).length, 24);
});

/* The window codes (roll-call-ack's mint). Alarms are armed days ahead, so the code that lets Stop
   check in with the app closed has to be fetched for the week and handed to each alarm. */
const MINT = {
  ok: true,
  ack_url: 'https://x.supabase.co/functions/v1/roll-call-ack',
  codes: [
    { instance_id: 'i1', code: 'c0de-1', opens_at: '2026-09-12T05:50:00Z', closes_at: '2026-09-12T06:30:00Z' },
    { instance_id: 'i9', code: 'c0de-9', opens_at: '2026-09-13T05:50:00Z', closes_at: '2026-09-13T06:30:00Z' },
  ],
};

test('each alarm carries its own window code and the URL to post it to', () => {
  const alarms = alarmsFor([row(), row({ instance_id: 'i2', starts_at: inHours(40) })], NOW);
  const out = withAckCodes(alarms, MINT);
  assert.equal(out[0].ackCode, 'c0de-1');
  assert.equal(out[0].ackUrl, MINT.ack_url);
  // No code minted for i2: it still arms, and the app drains the tap instead.
  assert.equal(out[1].ackCode, undefined);
  assert.equal(out[1].ackUrl, undefined);
});

test('a failed or odd mint arms every alarm exactly as before', () => {
  const alarms = alarmsFor([row()], NOW);
  for (const bad of [null, undefined, { ok: false }, { ok: true, ack_url: 'http://plain/ack', codes: MINT.codes }, { ok: true, codes: 'x' }]) {
    const out = withAckCodes(alarms, bad);
    assert.equal(out.length, 1);
    assert.equal(out[0].ackCode, undefined);
    assert.equal(out[0].instanceId, 'i1');
  }
});

test('the mint is asked once, with the athlete own session, and cached', async () => {
  _resetAckCodes();
  const calls = [];
  const client = { functions: { invoke: async (name, opts) => { calls.push([name, opts]); return { data: MINT, error: null }; } } };
  const a = await fetchAckCodes(client, NOW, ['i1']);
  const b = await fetchAckCodes(client, NOW + 60000, ['i1', 'i9']);
  assert.deepEqual(calls, [['roll-call-ack', { body: { action: 'codes' } }]]);
  assert.equal(a, b);
  // A new instance the cache has never seen asks again.
  await fetchAckCodes(client, NOW + 120000, ['i-new']);
  assert.equal(calls.length, 2);
  // After the TTL, it asks again even for known ids.
  await fetchAckCodes(client, NOW + 120000 + ACK_CODES_TTL_MS, ['i1']);
  assert.equal(calls.length, 3);
});

test('a mint that fails costs nothing but the code', async () => {
  _resetAckCodes();
  const client = { functions: { invoke: async () => ({ data: null, error: { message: '401' } }) } };
  assert.equal(await fetchAckCodes(client, NOW), null);
  _resetAckCodes();
  assert.equal(await fetchAckCodes(null, NOW), null);
  _resetAckCodes();
  const throwing = { functions: { invoke: async () => { throw new Error('offline'); } } };
  assert.equal(await fetchAckCodes(throwing, NOW), null);
});

test('a failed mint is cached too, so a signed-out phone does not ask on every foreground beat', async () => {
  _resetAckCodes();
  let n = 0;
  const client = { functions: { invoke: async () => { n++; return { data: null, error: { message: '401' } }; } } };
  assert.equal(await fetchAckCodes(client, NOW, ['i1']), null);
  assert.equal(await fetchAckCodes(client, NOW + 60000, ['i1']), null);
  assert.equal(await fetchAckCodes(client, NOW + 29 * 60000, ['i1']), null);
  assert.equal(n, 1);
  await fetchAckCodes(client, NOW + ACK_CODES_TTL_MS, ['i1']);
  assert.equal(n, 2, 'the TTL still ends the negative cache');
});

test('a morning the mint had no code for is not re-asked every beat', async () => {
  _resetAckCodes();
  let n = 0;
  const client = { functions: { invoke: async () => { n++; return { data: MINT, error: null }; } } };
  await fetchAckCodes(client, NOW, ['i1', 'i2']); // i2 has no code in MINT
  const again = await fetchAckCodes(client, NOW + 60000, ['i1', 'i2']);
  assert.equal(n, 1);
  assert.equal(again, MINT);
});
