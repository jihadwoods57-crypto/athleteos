/* The third-party AI consent rule (0243, 5.1.2(i)).
 *
 * Only an explicit yes counts; never asked and "Not now" are both no; an unreadable answer is a
 * no; and every function that calls Anthropic with a person's data actually asks the rule.
 *
 * Run: node --test supabase/functions/_shared/ai-consent.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  consentGiven, consentedIds, firstWithoutConsent, loadConsentRows, missingConsent,
  filterConsented, consentSkipBody, AI_CONSENT_REQUIRED,
} from './ai-consent.mjs';

test('only an explicit true is consent; null (never asked) and false (Not now) are not', () => {
  assert.equal(consentGiven(true), true);
  assert.equal(consentGiven(null), false);
  assert.equal(consentGiven(undefined), false);
  assert.equal(consentGiven(false), false);
  assert.equal(consentGiven('true'), false);
});

test('consentedIds keeps order and drops people with no row', () => {
  const rows = [{ id: 'a', ai_consent: true }, { id: 'b', ai_consent: null }, { id: 'c', ai_consent: false }, { id: 'd', ai_consent: true }];
  assert.deepEqual(consentedIds(['d', 'a', 'b', 'c', 'zz'], rows), ['d', 'a']);
});

test('firstWithoutConsent names the data subject before the caller', () => {
  const rows = [{ id: 'coach', ai_consent: true }];
  assert.equal(firstWithoutConsent(['athlete', 'coach'], rows), 'athlete');
  assert.equal(firstWithoutConsent(['athlete', 'coach'], [...rows, { id: 'athlete', ai_consent: true }]), null);
  assert.equal(firstWithoutConsent(['athlete', 'athlete'], [{ id: 'athlete', ai_consent: false }]), 'athlete');
});

test('an unreadable answer fails closed', async () => {
  const broken = { rpc: async () => ({ data: null, error: { message: 'down' } }) };
  assert.deepEqual(await loadConsentRows(broken, ['a']), []);
  assert.equal(await missingConsent(broken, ['a']), 'a');
  const throws = { rpc: () => { throw new Error('boom'); } };
  assert.equal(await missingConsent(throws, ['a']), 'a');
  assert.equal(await missingConsent(null, ['a']), 'a');
});

test('filterConsented reads in chunks and returns only yes', async () => {
  const table = { a: true, b: null, c: true, d: false };
  const calls = [];
  const svc = { rpc: async (fn, { p_ids: ids }) => { assert.equal(fn, 'ai_consent_effective'); calls.push(ids.length); return { data: ids.map((id) => ({ id, ai_consent: table[id] ?? null })), error: null }; } };
  assert.deepEqual(await filterConsented(svc, ['a', 'b', 'c', 'd', 'a'], 2), ['a', 'c']);
  assert.deepEqual(calls, [2, 2]);
});

test('the skip body is a normal answer with a plain code', () => {
  assert.deepEqual(consentSkipBody('athlete'), { ok: false, skipped: AI_CONSENT_REQUIRED, error: AI_CONSENT_REQUIRED, who: 'athlete' });
  assert.equal(consentSkipBody('you').who, 'you');
});

/* Inventory: every edge function that calls Anthropic must consult the consent rule. A new AI
   function that forgets it fails here, not in App Review. beta-board is the one exception: it
   serves anonymous TestFlight testers on a web page, holds no app account, and its page carries
   its own notice. */
const FN = join(process.cwd(), 'supabase', 'functions');
const AI_FUNCTIONS = ['analyze-meal', 'meal-chat', 'athlete-summary', 'ai-followup', 'coach-voice-nudge', 'deep-analysis', 'monthly-report', 'assist', 'plan-generate', 'dining-menu'];
for (const fn of AI_FUNCTIONS) {
  test(`${fn} checks AI consent before calling the model`, () => {
    const src = readFileSync(join(FN, fn, 'index.ts'), 'utf8');
    assert.match(src, /from '\.\.\/_shared\/ai-consent\.mjs'/, `${fn} must import the consent rule`);
    assert.match(src, /missingConsent\(|filterConsented\(/, `${fn} must call it`);
  });
}

test('the inventory is complete: no other function talks to Anthropic', async () => {
  const { readdirSync, existsSync } = await import('node:fs');
  const talkers = readdirSync(FN).filter((d) => {
    const p = join(FN, d, 'index.ts');
    if (!existsSync(p)) return false;
    return /anthropic/i.test(readFileSync(p, 'utf8')) && /messages\.create|api\.anthropic\.com/.test(readFileSync(p, 'utf8'));
  });
  const unknown = talkers.filter((d) => !AI_FUNCTIONS.includes(d) && d !== 'beta-board');
  assert.deepEqual(unknown, [], `new AI caller(s) without a consent check: ${unknown.join(', ')}`);
});

test('the effective answer is the server rule: a yes from a minor waiting on a guardian is a no (I6)', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '0243_ai_consent.sql'), 'utf8');
  assert.match(sql, /and not \(public\.is_provable_minor\(p\) and not public\.has_verified_guardian_consent\(p\)\)/);
  assert.match(sql, /function public\.ai_consent_effective\(p_ids uuid\[\]\)/);
  assert.match(readFileSync(join(process.cwd(), 'supabase', 'functions', '_shared', 'ai-consent.mjs'), 'utf8'), /rpc\('ai_consent_effective'/);
});
