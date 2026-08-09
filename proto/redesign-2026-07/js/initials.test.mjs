/* The avatar monogram rule.
 *
 * This exists because seven surfaces each derived initials with `name[0]`, and `[0]` indexes a
 * UTF-16 code unit: a name starting with an emoji got sliced mid-surrogate and the avatar
 * rendered a replacement glyph. The astral cases below are the regression; the rest pin the
 * one answer every surface now gives for the same person.
 *
 * Run: node --test proto/redesign-2026-07/js/initials.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialsOf } from './initials.js';

test('the ordinary case: first and last', () => {
  assert.equal(initialsOf('Marcus Hill'), 'MH');
  assert.equal(initialsOf('marcus hill'), 'MH');
  assert.equal(initialsOf('  Marcus   Hill  '), 'MH');
});

test('a middle name is skipped, not sampled — first and LAST is what initials means', () => {
  assert.equal(initialsOf('Mary Jane Watson'), 'MW');
  assert.equal(initialsOf('Jose de la Cruz'), 'JC');
});

test('one word gives one letter; three would be a logo, not an avatar', () => {
  assert.equal(initialsOf('Prince'), 'P');
  assert.equal(initialsOf('Mary Jane Watson').length, 2);
});

/* The bug this file was written for. */
test('an astral first character is never sliced in half', () => {
  assert.equal(initialsOf('🐐 Jayden O’Brien-Washington 🔥'), 'JO');
  assert.equal(initialsOf('🔥🔥🔥 Tre'), 'T');
  assert.equal(initialsOf('Kai 🐐'), 'K');
  // Every returned glyph is a whole code point, so no lone surrogate can escape.
  for (const name of ['🐐 Jayden 🔥', '👨‍👩‍👧 Family Name', '🏈 Coach D']) {
    for (const ch of initialsOf(name)) assert.ok(ch.codePointAt(0) < 0xd800 || ch.codePointAt(0) > 0xdfff);
  }
});

test('leading punctuation is skipped', () => {
  assert.equal(initialsOf('“Big” Mike Johnson'), 'BJ'); // the quoted nickname is still a word
  assert.equal(initialsOf("'Lil Ray"), 'LR');
  assert.equal(initialsOf('-- Dash Rendar'), 'DR');
});

test('non-Latin scripts keep their own first letter', () => {
  assert.equal(initialsOf('Ана Петрова'), 'АП');
  assert.equal(initialsOf('Ángel Núñez'), 'ÁN');
  assert.equal(initialsOf('李 明'), '李明');
});

test('a digit counts, so a handle like "3K Ross" still has a monogram', () => {
  assert.equal(initialsOf('3K Ross'), '3R');
});

test('nothing usable falls back rather than rendering an empty circle', () => {
  assert.equal(initialsOf('', 'A'), 'A');
  assert.equal(initialsOf('   ', 'C'), 'C');
  assert.equal(initialsOf(null, 'T'), 'T');
  assert.equal(initialsOf(undefined, '?'), '?');
  assert.equal(initialsOf('🔥🔥', 'A'), 'A');
  assert.equal(initialsOf('· — ·', '?'), '?');
});

test('max:1 gives the single-letter chip its one glyph', () => {
  assert.equal(initialsOf('Marcus Hill', 'A', 1), 'M');
  assert.equal(initialsOf('🐐 Jayden Washington', 'A', 1), 'J');
  assert.equal(initialsOf('', 'A', 1), 'A');
});
