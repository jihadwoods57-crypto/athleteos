/* Permission before anything reaches the third-party AI (0243, Guideline 5.1.2(i), G-L5 / A-R2).
 *
 * The rule on this side: the answer is remembered per account, a pre-account (onboarding) answer
 * lands on the account once and only fills an empty record, a failed write is retried, a known
 * yes never re-asks, a known Not now never nags, and every AI moment in the app goes through the
 * one door. The server holds the same line (supabase/functions/_shared/ai-consent.test.mjs).
 *
 * Run: node --test proto/redesign-2026-07/js/ai-consent.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis.window || {};
const JS = dirname(fileURLToPath(import.meta.url));
const C = await import('./ai-consent.js');

/** A fake Supabase: one profiles row per id, and a set_ai_consent RPC that can be made to fail. */
function fakeSb(rows = {}, { rpcFails = false, readFails = false, minors = [] } = {}) {
  const calls = [];
  return {
    calls,
    auth: null,
    from: () => ({
      select: () => ({
        eq: (_c, id) => ({
          maybeSingle: async () => (readFails ? { data: null, error: { message: 'down' } }
            : { data: id in rows ? { ai_consent: rows[id] } : null, error: null }),
        }),
      }),
    }),
    rpc: async (fn, args) => {
      if (fn === 'my_ai_consent') {
        // The fake answers for the single account the test reads (the first key).
        const id = Object.keys(rows)[0];
        if (readFails) return { data: null, error: { message: 'down' } };
        return { data: { ai_consent: id in rows ? rows[id] : null, minor_pending: minors.includes(id) }, error: null };
      }
      calls.push([fn, args]);
      if (rpcFails) return { error: { message: 'offline' } };
      return { error: null };
    },
  };
}

test.beforeEach(() => { store.clear(); window.sb = null; });

test('never asked is null; the server answer is cached per account', async () => {
  assert.equal(C.aiConsentCached('u1'), null);
  window.sb = fakeSb({ u1: true });
  assert.equal(await C.refreshAiConsent('u1'), true);
  window.sb = fakeSb({ u2: false });
  assert.equal(await C.refreshAiConsent('u2'), false);
  assert.equal(C.aiConsentCached('u1'), true);
  assert.equal(C.aiConsentCached('u2'), false);
});

test('the onboarding answer lands on an EMPTY account record once, and never overrides a later choice', async () => {
  await C.setAiConsent(null, true);                 // the demo, no account yet
  assert.equal(C.aiConsentCached(null), true);
  const sb = fakeSb({ u1: null });
  window.sb = sb;
  assert.equal(await C.refreshAiConsent('u1'), true);
  assert.deepEqual(sb.calls, [['set_ai_consent', { p_consent: true }]]);
  assert.equal(C.aiConsentCached(null), null, 'written once, then forgotten');
  // A second account on the same phone that already answered No keeps its No.
  await C.setAiConsent(null, true);
  const sb2 = fakeSb({ u2: false });
  window.sb = sb2;
  assert.equal(await C.refreshAiConsent('u2'), false);
  assert.deepEqual(sb2.calls, []);
});

test('a write that fails offline is kept and written at the next read', async () => {
  window.sb = fakeSb({ u1: null }, { rpcFails: true });
  assert.equal(await C.setAiConsent('u1', true), false);
  assert.equal(C.aiConsentCached('u1'), true, 'this phone knows the answer at once');
  const sb = fakeSb({ u1: null });
  window.sb = sb;
  assert.equal(await C.refreshAiConsent('u1'), true);
  assert.deepEqual(sb.calls, [['set_ai_consent', { p_consent: true }]]);
});

test('an unreachable server keeps the last known answer', async () => {
  window.sb = fakeSb({ u1: true });
  await C.refreshAiConsent('u1');
  window.sb = fakeSb({}, { readFails: true });
  assert.equal(await C.refreshAiConsent('u1'), true);
});

test('ensureAiConsent: a known yes never asks; a known Not now never nags', async () => {
  window.sb = fakeSb({ u1: true });
  assert.equal(await C.ensureAiConsent('u1'), true);
  window.sb = fakeSb({ u2: false });
  assert.equal(await C.ensureAiConsent('u2'), false);
});

test('I6: a minor waiting on a parent is never offered the sheet and never counts as yes', async () => {
  const sb = fakeSb({ kid: true }, { minors: ['kid'] });
  window.sb = sb;
  assert.equal(await C.refreshAiConsent('kid'), true, 'their own answer is kept');
  assert.equal(C.aiMinorPending('kid'), true);
  assert.equal(await C.ensureAiConsent('kid', { ask: true }), false, 'no sheet, no yes');
  assert.deepEqual(sb.calls, []);
  assert.match(C.AI_MINOR_LINE, /parent or guardian approves/);
});

test('M9: an onboarding answer older than a few hours never lands on the next account', async () => {
  localStorage.setItem('os.aiConsent.local', JSON.stringify({ v: '1', at: Date.now() - 5 * 3600 * 1000 }));
  const sb = fakeSb({ u9: null });
  window.sb = sb;
  assert.equal(await C.refreshAiConsent('u9'), null);
  assert.deepEqual(sb.calls, []);
});

test('ensureAiConsent with no way to show the sheet sends nothing and records nothing', async () => {
  const sb = fakeSb({ u1: null });
  window.sb = sb;
  assert.equal(await C.ensureAiConsent('u1'), false);
  assert.deepEqual(sb.calls, []);
  assert.equal(C.aiConsentCached('u1'), null);
});

test('a server skip forgets a stale yes, so the next AI moment asks', async () => {
  window.sb = fakeSb({ u1: true });
  await C.refreshAiConsent('u1');
  assert.equal(C.isConsentSkip({ ok: false, skipped: 'ai_consent_required' }), true);
  assert.equal(C.isConsentSkip({ reply: 'hi' }), false);
  C.noteAiConsentRequired('u1');
  assert.equal(C.aiConsentCached('u1'), null);
});

test('the sheet names the provider, what is sent, and the training promise the policy makes', () => {
  const a = C.aiConsentSheetHtml('athlete');
  assert.match(a, /Anthropic \(Claude\)/);
  for (const w of ['meal photos', 'goal', 'weight goal', 'position', 'allergies', 'coach’s standard']) assert.match(a, new RegExp(w));
  assert.match(a, /does not use it to train its models/);
  assert.match(a, />Continue<\/button>/);
  assert.match(a, />Not now<\/button>/);
  const policy = readFileSync(join(JS, '..', '..', '..', 'web', 'landing', 'privacy.html'), 'utf8');
  assert.match(policy, /not used to train Anthropic/, 'the sheet and the published policy make the same promise');
  const op = C.aiConsentSheetHtml('coach');
  assert.match(op, /only if that athlete has said yes too/);
});

/* Every AI moment goes through the one door. A new caller of an AI function that skips it fails
   here, not in App Review. */
test('every AI moment asks first', () => {
  const src = (p) => readFileSync(join(JS, p), 'utf8');
  const cam = src('screens/camera.js');
  assert.ok(cam.indexOf('ensureAiConsent(RT.userId') < cam.indexOf('act.logMeal(slot)'), 'camera asks before the photo is queued');
  const st = src('state.js');
  assert.match(st, /aiConsentCached\(job\.uid\) !== true && \(await refreshAiConsent\(job\.uid\)\) !== true\) return aiOff\(\)/);
  assert.match(st, /if \(isConsentSkip\(data\)\) \{ noteAiConsentRequired\(job\.uid\); return aiOff\(\); \}/);
  const demo = src('ob2-meal.js');
  assert.ok(demo.indexOf('ensureAiConsent(RT.userId || null') < demo.indexOf("functions.invoke('analyze-meal'"), 'the demo asks before the photo goes out');
  assert.match(demo, /aiConsent: true/);
  for (const p of ['screens/meal.js', 'screens/nutrition-chat.js', 'screens/trust.js', 'screens/coach.js']) {
    assert.match(src(p), /ensureAiConsent\(RT\.userId/, `${p} asks before the AI replies`);
  }
  assert.match(src('screens/settings.js'), /id="pv-ai"/, 'Privacy has the row to change it');
});

// G-P8: the coach's side of a meal thread carries the AI disclaimer on the AI's first words.
test('coach-side thread: the AI disclaimer rides the first AI reply, once', () => {
  const src = readFileSync(join(JS, 'screens', 'coach.js'), 'utf8');
  assert.match(src, /import \{[^}]*aiDisclaimer[^}]*\} from '\.\.\/components\.js'/);
  assert.equal((src.match(/\$\{aiDisclaimer\(\)\}/g) || []).length, 1, 'under the opening');
  assert.match(src, /it\.comment\.role === 'ai' && !isCorrectionReceipt\(it\.comment\)\) === item \? aiDisclaimer\(\) : ''/);
});
