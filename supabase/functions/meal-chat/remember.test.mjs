/* meal-chat's memory loop (2026-09-02), pinned structurally against the source.
 *
 * `athlete_memory_facts` was read by every AI surface and written by nothing an athlete could SAY.
 * "I'm lactose intolerant" lasted one reply. The remember tool is the writer; these checks pin the
 * three things about it that must never regress, in the same cheap-and-ugly way
 * nutrition-chat-live.test.mjs pins the invoke: because nothing in a unit test can see a tool
 * that silently stopped being offered. The pure half (kind whitelist, sanitising, dedupe key,
 * offer line) is unit-tested in _shared/memory.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');

test('the remember tool exists and is offered only to a client that renders the confirmation', () => {
  assert.match(SRC, /name: 'remember'/, 'the tool has to exist');
  assert.match(SRC, /const canRemember = body\?\.canRemember === true;/, 'capability-gated like apply_correction');
  assert.match(SRC, /\.\.\.\(canRemember \? \[REMEMBER_TOOL\] : \[\]\)/, 'and only added to the athlete tools on that flag');
});

test('a heard fact NEVER binds on its own: written pending, under the meal owner', () => {
  const write = SRC.slice(SRC.indexOf("tool?.name === 'remember'"), SRC.indexOf("tool?.name === 'flag_for_coach'"));
  assert.match(write, /status: 'pending_confirmation'/, 'memory-load reads active only; pending is the gate');
  assert.match(write, /athlete_id: mealRow\.athlete_id/, 'the fact belongs to the athlete the thread is about');
  assert.doesNotMatch(write, /status: 'active'/, 'nothing on this path may write an active fact');
});

test('the same fact said twice accrues on one row, and a rejected one is not asked again', () => {
  const write = SRC.slice(SRC.indexOf("tool?.name === 'remember'"), SRC.indexOf("tool?.name === 'flag_for_coach'"));
  assert.match(write, /factKey\(r\.kind, r\.value\) === want/, 'dedupe by the shared key');
  assert.match(write, /dup\.status === 'rejected'/, 'a no is remembered as a no');
  assert.match(write, /evidence_n: \(Number\(dup\.evidence_n\) \|\| 1\) \+ 1/, 'a repeat is evidence, not a duplicate');
});

test('the reply row carries the offer the thread renders, and only the validated fact', () => {
  const write = SRC.slice(SRC.indexOf("tool?.name === 'remember'"), SRC.indexOf("tool?.name === 'flag_for_coach'"));
  assert.match(write, /t: 'memory_offer'/, 'meta.t is what the two renderers key on');
  assert.match(write, /chatFactCandidate\(tool\.input\?\.kind, tool\.input\?\.value\)/, 'the model\'s proposal goes through the validator before anything is written');
  assert.match(write, /replace\(\/—\/g, ','\)/, 'the em-dash rail applies to this reply like every other');
});

test('the prompt tells the model when to remember and when not to', () => {
  assert.match(SRC, /REMEMBER WHAT THEY TELL YOU ABOUT THEMSELVES/);
  assert.match(SRC, /Never claim you will remember something unless you called it/, 'no promised memory without the tool');
});
