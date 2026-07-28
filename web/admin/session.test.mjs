// run: node --test web/admin/session.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { shouldExpire } from './session.mjs';

const IDLE = 30 * 60 * 1000;
const ABS = 12 * 60 * 60 * 1000;

test('idle trips', () =>
  assert.equal(shouldExpire({ lastActivity: 0, loginAt: 0, now: IDLE + 1, idleMs: IDLE, absoluteMs: ABS }), 'idle'));
test('absolute trips even if active', () =>
  assert.equal(shouldExpire({ lastActivity: ABS, loginAt: 0, now: ABS + 1, idleMs: IDLE, absoluteMs: ABS }), 'absolute'));
test('active session ok', () =>
  assert.equal(shouldExpire({ lastActivity: 1000, loginAt: 0, now: 2000, idleMs: IDLE, absoluteMs: ABS }), null));
test('absolute takes precedence over idle', () =>
  assert.equal(shouldExpire({ lastActivity: 0, loginAt: 0, now: ABS + 1, idleMs: IDLE, absoluteMs: ABS }), 'absolute'));
