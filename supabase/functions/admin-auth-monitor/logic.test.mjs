// run: node --test supabase/functions/admin-auth-monitor/logic.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { classifyBurst, geoFromIp, describeFlags } from './logic.mjs';

test('burst at/above threshold', () => {
  assert.equal(classifyBurst(10, 15), true);
  assert.equal(classifyBurst(11, 15), true);
});
test('below threshold is not a burst', () => assert.equal(classifyBurst(9, 15), false));

test('geo parse from ipinfo org', () =>
  assert.deepEqual(geoFromIp({ country: 'US', org: 'AS15169 Google LLC' }), { country: 'US', asn: 'AS15169' }));
test('geo empty', () => assert.deepEqual(geoFromIp({}), { country: null, asn: null }));

test('describeFlags renders friendly text', () => {
  const s = describeFlags(['new_country', 'impossible_travel'], '9.9.9.9', 'RU');
  assert.ok(s.includes('new country'));
  assert.ok(s.includes('impossible travel'));
  assert.ok(s.includes('9.9.9.9'));
  assert.ok(s.includes('RU'));
});
