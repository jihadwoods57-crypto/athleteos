/* I4 (review 2026-09-24): A FAILED OUTCOME REPORT LEFT THE THREAD SILENT.
 *
 * correction-turn.js applied the correction, then tried twice to tell meal-chat, then gave up: the
 * numbers had moved and nothing in the thread said so. The reviewer's repro (e2e, outcome calls
 * failing) ends with protein 29 -> 50 and a thread whose last line is the athlete's own message.
 *
 * The rule now: the report is a job in the small-writes outbox, retried while its token is good;
 * past that, the plain device receipt is filed instead. Numbers never move with nothing in the
 * thread. */
import test from 'node:test';
import assert from 'node:assert/strict';

// The outbox lives in localStorage; give node one.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const SQ = await import('./sync-queue.js');
const { runChatCorrection, sendOutcome, tokenInfo } = await import('./correction-turn.js');

const T0 = Date.now();   // the token was just issued
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = `${b64({ v: 2, m: 'meal-1', u: 'ath-1', a: 'Good catch.', p: [], h: 'x', t: T0, n: 'nonce-1' })}.sig`;
const PLATE = {
  mealId: 'meal-1', protein: 29, kcal: 400, carbs: 32, fat: 19, quality: 84,
  detectedRich: [{ name: 'Grilled chicken', quantity: '3 oz', per: { protein: 21, kcal: 140, carbs: 0, fat: 6 } }],
};

/** A Supabase stand-in: `invoke` answers from a script; `from().select()` finds rows by meta->>ct
 *  in `filed` (a list of the cts already in the thread). */
function fakeSb({ invoke, filed = [], meal = true }) {
  const calls = [];
  const reads = [];
  const from = (table) => {
    let ct = null;
    const q = {
      select: () => q, eq: (col, v) => { if (col === 'meta->>ct') ct = v; return q; },
      limit: async () => { reads.push(ct); return { data: filed.includes(ct) ? [{ id: ct }] : [], error: null }; },
      maybeSingle: async () => { reads.push(table); return { data: table === 'meals' && meal ? { id: 'meal-1' } : null, error: null }; },
    };
    return q;
  };
  return { calls, reads, functions: { invoke: async (fn, { body }) => { calls.push(body); return invoke(body); } }, from };
}
const net = () => ({ data: null, error: { message: 'Failed to fetch' } });
const forbidden = () => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: 403 } } });
const act = {
  correctMeal: async (_slot, parts) => ({
    meta: { ...PLATE, protein: 50, kcal: 540, fat: 25, quality: 90 }, before: { protein: 29, carbs: 32, fat: 19, kcal: 400, quality: 84 },
    moved: true, unpriced: [], landed: parts,
  }),
  _correctionReceiptRows: () => [{ label: 'Protein', unit: 'g', from: 29, to: 50 }],
  _scheduleSyncDrain: () => {},
};

test('the token is tried for (just under) its 15 minutes, on the device clock', () => {
  const { nonce, expiresAt } = tokenInfo(TOKEN, T0);
  assert.equal(nonce, 'nonce-1');
  assert.equal(expiresAt, T0 + 14 * 60000);
  assert.equal(tokenInfo('not-a-token', T0).nonce, '');
});

test('I4: a report that cannot be delivered is queued, not dropped', async () => {
  store.clear();
  const sb = fakeSb({ invoke: net });
  const res = await runChatCorrection({
    act, sb, uid: 'ath-1', slot: 'lunch', mealId: 'meal-1', meta: PLATE, said: 'double chicken',
    data: { reply: 'Good catch.', pending: TOKEN, correction: { item: 'Grilled chicken', quantity: 'double' } },
  });
  assert.equal(res.applied, true);
  const q = SQ.readQueue();
  assert.equal(q.length, 1, 'the outcome waits in the outbox');
  assert.equal(q[0].kind, 'correction-outcome');
  assert.equal(q[0].tries, 1);
  assert.deepEqual(q[0].receipt, [{ label: 'Protein', unit: 'g', from: 29, to: 50 }], 'with the plain receipt to fall back on');
  assert.equal(q[0].body.correctionOutcome.token, TOKEN);
  assert.deepEqual(q[0].body.correctionOutcome.correction, { item: 'Grilled chicken', quantity: 'double' }, 'the correction rides back verbatim');
});

test('I4: while the token is good, a retry sends the report; a delivered one is done', async () => {
  const job = SQ.readQueue()[0];
  const down = fakeSb({ invoke: net });
  assert.equal(await sendOutcome(job, down, T0 + 60000), false, 'still offline: try again later');
  assert.equal(down.calls[0].correctionOutcome.token, TOKEN);
  const up = fakeSb({ invoke: () => ({ data: { ok: true }, error: null }) });
  assert.equal(await sendOutcome(job, up, T0 + 120000), true);
  assert.equal(up.calls.length, 1);
});

test('I4: past the token\'s life the plain receipt is filed, so the thread records the change', async () => {
  const job = { ...SQ.readQueue()[0] };
  const sb = fakeSb({ invoke: (body) => (body.correctionOutcome ? net() : { data: { ok: true }, error: null }) });
  assert.equal(await sendOutcome(job, sb, T0 + 16 * 60000), true);
  assert.deepEqual(sb.calls, [{ mealId: 'meal-1', correctionReceipt: [{ label: 'Protein', unit: 'g', from: 29, to: 50 }], receiptCt: 'nonce-1:f' }],
    'no token (it is spent), not in Nia\'s voice: the pre-token receipt, under its own ct');
  assert.deepEqual(sb.reads, ['nonce-1:r', 'nonce-1:f'], 'asked first whether a receipt is already in');
  assert.equal(job.fallback, true, 'and the fallback gets fresh tries of its own');
});

test('R2 I4: a refused token falls back at once; a receipt already in is never filed twice', async () => {
  const job = { ...SQ.readQueue()[0], fallback: false };
  const refused = fakeSb({ invoke: (body) => (body.correctionOutcome ? forbidden() : { data: { ok: true }, error: null }) });
  assert.equal(await sendOutcome(job, refused, T0 + 60000), true);
  assert.deepEqual(refused.calls.map((b) => Object.keys(b).sort().join(',')), ['correctionOutcome,correctionReceipt,mealId', 'correctionReceipt,mealId,receiptCt']);
  for (const ct of ['nonce-1:r', 'nonce-1:f']) {
    const landed = fakeSb({ invoke: net, filed: ['nonce-1', ct] });
    assert.equal(await sendOutcome({ ...job, fallback: true }, landed, T0 + 20 * 60000), true);
    assert.equal(landed.calls.length, 0, `${ct} is in the thread: nothing more to file`);
  }
});

test('R2 I4: Nia\'s row landed but the receipt did not: the receipt is filed by its own ct', async () => {
  const job = { ...SQ.readQueue()[0], fallback: true };
  const sb = fakeSb({ invoke: () => ({ data: { ok: true }, error: null }), filed: ['nonce-1'] });
  assert.equal(await sendOutcome(job, sb, T0 + 20 * 60000), true);
  assert.deepEqual(sb.calls.map((b) => b.receiptCt), ['nonce-1:f']);
  // And straight from a delivered outcome whose server receipt insert failed (receipt: false).
  const live = fakeSb({ invoke: (b) => ({ data: b.correctionOutcome ? { ok: true, receipt: false } : { ok: true }, error: null }) });
  assert.equal(await sendOutcome({ ...job, fallback: false }, live, T0 + 1000), true);
  assert.deepEqual(live.calls.map((b) => (b.correctionOutcome ? 'outcome' : b.receiptCt)), ['outcome', 'nonce-1:f']);
});

test('I4: nothing moved, nothing owed: a spent question-only report leaves the outbox', async () => {
  const sb = fakeSb({ invoke: net });
  assert.equal(await sendOutcome({ mealId: 'm', ct: 'n', body: {}, receipt: [], expiresAt: T0 }, sb, T0 + 1), true);
  assert.equal(sb.calls.length, 0);
});

/* ---- review round 3 ---- */

test('R3 I4: a follow-up question the server could not file keeps the job (question: false)', async () => {
  const job = { ...SQ.readQueue()[0], fallback: false };
  const sb = fakeSb({ invoke: () => ({ data: { ok: true, receipt: true, question: false }, error: null }) });
  assert.equal(await sendOutcome(job, sb, T0 + 1000), false, 'not done: the retry asks the server to file it again');
});

test('R3 I4: a 403 on a meal that is gone drops the job without filing anything', async () => {
  const job = { ...SQ.readQueue()[0], fallback: false };
  const sb = fakeSb({ invoke: forbidden, meal: false });
  assert.equal(await sendOutcome(job, sb, T0 + 1000), true);
  assert.equal(sb.calls.length, 1, 'only the refused report, no receipt for a meal that is gone');
});

test('R4 I1: a 403 with the meal still there becomes the fallback, which a later launch still files', async () => {
  store.clear();
  const job = { uid: 'ath-1', kind: 'correction-outcome', ref: 'nonce-1', ct: 'nonce-1', mealId: 'meal-1', body: { correctionOutcome: { token: TOKEN } },
    receipt: [{ label: 'Protein', unit: 'g', from: 29, to: 50 }], expiresAt: T0 + 14 * 60000, queuedAt: T0 };
  SQ.putJob(job);
  // Refused, then offline: the receipt does not land.
  const refused = fakeSb({ invoke: (b) => (b.correctionOutcome ? forbidden() : net()) });
  assert.equal(await sendOutcome(job, refused, T0 + 1000), false);
  assert.equal(job.fallback, true);
  assert.equal('noRevive' in job, false, 'nothing stops a launch from reviving it');
  // Exhausted, then (after the token's life) back online: revived and filed.
  SQ.patchJob(SQ.keyOf(job), { tries: SQ.MAX_TRIES });
  const back = fakeSb({ invoke: () => ({ data: { ok: true }, error: null }) });
  assert.equal(await sendOutcome({ ...SQ.readQueue()[0] }, back, T0 + 17 * 60000), true);
  assert.deepEqual(back.calls.map((b) => b.receiptCt), ['nonce-1:f'], 'the receipt is filed');
});

test('R4 I2: a 503 (the server could not read the meal) is retried, never taken as done', async () => {
  const unavailable = () => ({ data: null, error: { message: 'non-2xx', context: { status: 503 } } });
  const job = { uid: 'ath-1', kind: 'correction-outcome', ref: 'n5', ct: 'n5', mealId: 'meal-1', body: { correctionOutcome: { token: TOKEN } },
    receipt: [{ label: 'Protein', unit: 'g', from: 29, to: 50 }], expiresAt: T0 + 14 * 60000, queuedAt: T0 };
  assert.equal(await sendOutcome({ ...job }, fakeSb({ invoke: unavailable }), T0 + 1000), false, 'the report');
  assert.equal(await sendOutcome({ ...job, fallback: true }, fakeSb({ invoke: unavailable }), T0 + 1000), false, 'the plain receipt');
});

test('R5.4: a correction job older than 24 hours is dropped, fallback or not', async () => {
  const job = { uid: 'ath-1', kind: 'correction-outcome', ref: 'n9', ct: 'n9', mealId: 'meal-1', body: { correctionOutcome: { token: TOKEN } },
    receipt: [{ label: 'Protein', unit: 'g', from: 29, to: 50 }], expiresAt: T0 + 14 * 60000, queuedAt: T0 };
  for (const fallback of [false, true]) {
    const sb = fakeSb({ invoke: net });
    assert.equal(await sendOutcome({ ...job, fallback }, sb, T0 + 25 * 3600000), true, `fallback ${fallback}`);
    assert.equal(sb.calls.length, 0, 'nothing sent a day later');
  }
  const young = fakeSb({ invoke: net });
  assert.equal(await sendOutcome({ ...job, fallback: true }, young, T0 + 23 * 3600000), false, 'a day is the limit, not less');
});
