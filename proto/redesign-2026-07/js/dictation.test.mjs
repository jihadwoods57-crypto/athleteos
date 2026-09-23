/* Dictation in the composer (composer upgrade, 2026-09-23).
 *
 * The rules the founder's ask comes down to, as pure functions (dictation-state.js) plus the
 * wiring guarantees in dictation.js that matter most:
 *   - empty box -> mic; text (or a photo) -> send; listening -> stop, and only stop;
 *   - dictated words land at the caret, merged with what was typed, spaced and capitalised;
 *   - a refusal or failure is one plain line that says what to do;
 *   - dictation NEVER sends, and typing, sending or leaving ends it;
 *   - the mic shows only when the native side says recognition can run.
 *
 * Run: node --test proto/redesign-2026-07/js/dictation.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composerMode, splitAtCaret, mergeDictation, dictationMessage } from './dictation-state.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'dictation.js'), 'utf8');
const ROUTER = readFileSync(join(HERE, 'router.js'), 'utf8');

test('the right slot: mic when empty, send with text or a photo, stop while listening', () => {
  assert.equal(composerMode({ text: '', canDictate: true }), 'mic');
  assert.equal(composerMode({ text: '   ', canDictate: true }), 'mic', 'whitespace is empty');
  assert.equal(composerMode({ text: 'eggs', canDictate: true }), 'send');
  assert.equal(composerMode({ text: '', photo: true, canDictate: true }), 'send', 'a photo alone is a message');
  assert.equal(composerMode({ text: 'eggs', listening: true, canDictate: true }), 'stop', 'never a send while listening');
  assert.equal(composerMode({ text: '', canDictate: false }), 'send-idle', 'no dictation: the box is what it was');
});

test('the caret splits the box into before and after', () => {
  assert.deepEqual(splitAtCaret('I had eggs', 5, 5), { before: 'I had', after: ' eggs' });
  assert.deepEqual(splitAtCaret('I had eggs', 2, 5), { before: 'I ', after: ' eggs' }, 'a selection is replaced');
  assert.deepEqual(splitAtCaret('abc'), { before: 'abc', after: '' }, 'no caret: the end');
  assert.deepEqual(splitAtCaret(null, 0, 0), { before: '', after: '' });
});

test('dictated words merge with what was typed', () => {
  assert.deepEqual(mergeDictation({ before: '', after: '' }, 'two eggs and toast'), { value: 'Two eggs and toast', caret: 18 });
  assert.deepEqual(mergeDictation({ before: 'For breakfast I had', after: '' }, 'two eggs'), { value: 'For breakfast I had two eggs', caret: 28 });
  assert.equal(mergeDictation({ before: 'Lunch was fine.', after: '' }, 'dinner was late').value, 'Lunch was fine. Dinner was late');
  assert.equal(mergeDictation({ before: 'I had ', after: 'for lunch' }, 'rice').value, 'I had rice for lunch');
  assert.equal(mergeDictation({ before: 'I had', after: '.' }, 'rice').value, 'I had rice.', 'no space before punctuation');
  assert.deepEqual(mergeDictation({ before: 'Keep this', after: '' }, '   '), { value: 'Keep this', caret: 9 }, 'nothing heard leaves the box alone');
});

test('the transcript is the whole session, so a longer one replaces, never repeats', () => {
  const base = { before: 'Note:', after: '' };
  assert.equal(mergeDictation(base, 'chicken').value, 'Note: chicken');
  assert.equal(mergeDictation(base, 'chicken and rice').value, 'Note: chicken and rice');
});

test('every refusal is one plain line that says what to do, with no em dash', () => {
  for (const code of ['denied', 'unavailable', 'no-speech', 'network', 'interrupted', 'busy', 'failed', 'something-new']) {
    const line = dictationMessage(code);
    assert.ok(line && line.length < 110, `${code}: one short line`);
    assert.ok(!/—/.test(line), `${code}: no em dash`);
  }
  assert.match(dictationMessage('denied'), /Settings/, 'denied says where to fix it');
  assert.equal(dictationMessage('something-new'), dictationMessage('failed'));
});

test('dictation never sends, and typing, sending or leaving ends it', () => {
  assert.ok(!/\.send['"]?\)\.click\(|requestSubmit|\.click\(\)/.test(SRC), 'dictation.js never presses send');
  assert.match(SRC, /addEventListener\('input'[\s\S]{0,120}abort\(\)/, 'typing ends dictation');
  assert.match(SRC, /t\.closest\('\.send, \.ai-ask'\)[\s\S]{0,80}abort\(\)/, 'sending ends dictation, keeping what is on screen');
  assert.match(SRC, /addEventListener\('hashchange', abort\)/, 'leaving the screen ends it');
  assert.match(SRC, /if \(document\.hidden\) abort\(\)/, 'leaving the app ends it');
});

test('the mic shows only when the native side says recognition can run', () => {
  assert.match(SRC, /classList\.toggle\('can-dictate', !!\(st && st\.available\)\)/);
  assert.match(SRC, /window\.OnStandardNative[\s\S]{0,60}n\.dictation/, 'feature-detected, so an old binary without the bridge call keeps it hidden');
  assert.match(ROUTER, /import\('\.\/dictation\.js'\)\.then\(\(m\) => m\.initDictation\(\)\)/, 'wired once, lazily, from the router');
});
