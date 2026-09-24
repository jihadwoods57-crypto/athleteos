// run: node --test supabase/functions/_shared/expo-push.test.mjs
//
// The regression this file exists for: Expo answers a fully-refused batch with HTTP 200. Every
// assertion about `sent` here is really an assertion that we never again report a push that was
// refused as a push that landed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTickets, mergeOutcomes, sendExpoPush, emptyOutcome } from './expo-push.mjs';

const msg = (to) => ({ to, title: 't', body: 'b' });
const okTicket = { status: 'ok', id: 'x' };
const errTicket = (error) => ({ status: 'error', message: 'nope', details: { error } });

test('a 200 whose tickets are all errors counts as ZERO sent', () => {
  // This is the exact body Expo returned for com.onstandard.app for the life of the product.
  const messages = [msg('ExponentPushToken[a]'), msg('ExponentPushToken[b]')];
  const body = { data: [errTicket('InvalidCredentials'), errTicket('InvalidCredentials')] };
  const out = readTickets(messages, body, true);
  assert.equal(out.sent, 0, 'HTTP 200 is not delivery');
  assert.equal(out.failed, 2);
  assert.deepEqual(out.errors, ['InvalidCredentials', 'InvalidCredentials']);
  assert.deepEqual(out.dead, [], 'bad credentials is our fault, not the phone\'s — keep the token');
});

test('a mixed batch counts only the ok tickets, and attributes the failure to its own token', () => {
  const messages = [msg('tok-a'), msg('tok-b'), msg('tok-c')];
  const body = { data: [okTicket, errTicket('DeviceNotRegistered'), okTicket] };
  const out = readTickets(messages, body, true);
  assert.equal(out.sent, 2);
  assert.equal(out.failed, 1);
  assert.deepEqual(out.dead, ['tok-b'], 'the dead token is the one whose ticket failed, by index');
});

test('DeviceNotRegistered is the only error that retires a token', () => {
  const messages = [msg('tok-a'), msg('tok-b')];
  const body = { data: [errTicket('MessageRateExceeded'), errTicket('MessageTooBig')] };
  const out = readTickets(messages, body, true);
  assert.equal(out.sent, 0);
  assert.deepEqual(out.dead, [], 'a rate limit is temporary; deleting the token would lose the phone');
});

test('a request-level rejection fails every message in the chunk', () => {
  const messages = [msg('a'), msg('b'), msg('c')];
  const out = readTickets(messages, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] }, true);
  assert.equal(out.sent, 0);
  assert.equal(out.failed, 3);
  assert.deepEqual(out.errors, ['PUSH_TOO_MANY_EXPERIENCE_IDS']);
});

test('a non-200, an unreadable body, and a short ticket array all count as not sent', () => {
  assert.equal(readTickets([msg('a')], null, false).sent, 0);
  assert.equal(readTickets([msg('a')], 'not json', true).sent, 0);
  assert.equal(readTickets([msg('a')], { data: 'nonsense' }, true).sent, 0);
  const short = readTickets([msg('a'), msg('b')], { data: [okTicket] }, true);
  assert.equal(short.sent, 1);
  assert.equal(short.failed, 1, 'a message with no ticket was not delivered');
});

test('mergeOutcomes sums counts, unions dead tokens and de-duplicates the reason', () => {
  const merged = mergeOutcomes([
    { sent: 2, failed: 1, dead: ['x'], errors: ['InvalidCredentials'] },
    { sent: 0, failed: 3, dead: ['x', 'y'], errors: ['InvalidCredentials', 'MessageTooBig'] },
  ]);
  assert.equal(merged.sent, 2);
  assert.equal(merged.failed, 4);
  assert.deepEqual(merged.dead, ['x', 'y']);
  assert.deepEqual(merged.errors, ['InvalidCredentials', 'MessageTooBig'],
    'one cause reads as one cause, however many phones hit it');
});

test('sendExpoPush chunks at 100 and reports the total honestly', async () => {
  const messages = Array.from({ length: 250 }, (_, i) => msg(`tok-${i}`));
  const seen = [];
  const fakeFetch = async (_url, init) => {
    const chunk = JSON.parse(init.body);
    seen.push(chunk.length);
    return { ok: true, json: async () => ({ data: chunk.map(() => okTicket) }) };
  };
  const out = await sendExpoPush(messages, fakeFetch);
  assert.deepEqual(seen, [100, 100, 50]);
  assert.equal(out.sent, 250);
  assert.equal(out.failed, 0);
});

test('sendExpoPush survives a thrown fetch and reports the chunk as failed, not sent', async () => {
  const out = await sendExpoPush([msg('a'), msg('b')], async () => { throw new Error('offline'); });
  assert.equal(out.sent, 0);
  assert.equal(out.failed, 2);
  assert.equal(out.errors[0], 'offline');
});

test('nothing to send is not a failure', async () => {
  assert.deepEqual(await sendExpoPush([], async () => { throw new Error('never called'); }), emptyOutcome());
  assert.deepEqual(await sendExpoPush([{ title: 'no token' }], async () => { throw new Error('never called'); }), emptyOutcome());
});

// ---- 2026-09-24: transportFailed, and a timeout on every request ----
test('transportFailed: a request that never produced tickets, and only that', () => {
  assert.equal(readTickets([{ to: 'a' }], null, false).transportFailed, true, 'non-2xx');
  assert.equal(readTickets([{ to: 'a' }], null, true).transportFailed, true, 'unreadable body');
  assert.equal(readTickets([{ to: 'a' }], { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] }).transportFailed, true, 'request-level rejection');
  assert.equal(readTickets([{ to: 'a' }], { data: [{ status: 'error', details: { error: 'InvalidCredentials' } }] }).transportFailed, false,
    'a per-ticket refusal is not a transport failure');
  assert.equal(readTickets([{ to: 'a' }], { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }).transportFailed, false);
  assert.equal(readTickets([{ to: 'a' }], { data: [{ status: 'ok', id: '1' }] }).transportFailed, false);
});

test('transportFailed survives the merge, and a thrown fetch sets it', async () => {
  assert.equal(mergeOutcomes([emptyOutcome(), { ...emptyOutcome(), transportFailed: true }]).transportFailed, true);
  assert.equal(mergeOutcomes([emptyOutcome(), emptyOutcome()]).transportFailed, false);
  const out = await sendExpoPush([{ to: 'a' }], async () => { throw new Error('network down'); });
  assert.equal(out.transportFailed, true);
  assert.equal(out.sent, 0);
});

test('every request carries an abort signal, and a request past the timeout is abandoned', async () => {
  let sawSignal = false;
  const hang = (_url, init) => new Promise((_resolve, reject) => {
    sawSignal = !!init.signal;
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const t0 = Date.now();
  const out = await sendExpoPush([{ to: 'a' }], hang, 50);
  assert.ok(sawSignal, 'the fetch is given a signal');
  assert.ok(Date.now() - t0 < 5_000, 'the hung request is abandoned at the timeout');
  assert.equal(out.transportFailed, true);
  assert.equal(out.sent, 0);
});
