// run: node --test supabase/functions/admin-mfa-recover/logic.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { parseRecoverBody } from './logic.mjs';

test('rejects empty code', () => {
  assert.deepEqual(parseRecoverBody({}), { ok: false, error: 'code required' });
});
test('rejects non-string code', () => {
  assert.deepEqual(parseRecoverBody({ code: 123 }), { ok: false, error: 'code required' });
});
test('trims and accepts a code', () => {
  assert.deepEqual(parseRecoverBody({ code: '  abc123  ' }), { ok: true, code: 'abc123' });
});
