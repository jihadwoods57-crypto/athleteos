// run: node --test supabase/functions/admin-alert/logic.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { buildResendPayload, shouldSend } from './logic.mjs';

test('resend payload shape', () => {
  const p = buildResendPayload({ from: 'a@x', to: 'b@x', subject: 'S', body: 'B' });
  assert.equal(p.from, 'a@x');
  assert.deepEqual(p.to, ['b@x']);
  assert.equal(p.subject, 'S');
  assert.equal(p.text, 'B');
});

test('dedupe suppresses a repeat kind', () => {
  assert.equal(shouldSend(['new_country'], 'new_country'), false);
});
test('dedupe allows a fresh kind', () => {
  assert.equal(shouldSend(['new_country'], 'impossible_travel'), true);
  assert.equal(shouldSend([], 'new_country'), true);
});
