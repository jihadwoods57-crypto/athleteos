// The roll-call push contract, checked from the Swift side (roll call v3, Task 1).
//
// Nothing on this Windows machine compiles Swift, and a key the server writes that the extension
// does not read (or reads under another spelling) throws nowhere: the extension just passes the
// push through and no alarm is armed. So the two spellings are compared as text, the same way
// swift-contract.test.ts guards the Live Activity.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { armPayload } from '../../supabase/functions/_shared/rollcall-notice';

const NSE = join(__dirname, '..', '..', 'targets', 'NotificationService', 'NotificationService.swift');
const swift = existsSync(NSE) ? readFileSync(NSE, 'utf8').replace(/\r\n/g, '\n') : '';

/** Every key of data.rc and of one arm item, as the server writes them (Task 3 armPayload). */
export const RC_KEYS = ['v', 'kind', 'title', 'label', 'url', 'arm', 'cancel', 'set', 'diag'];
export const ARM_ITEM_KEYS = ['i', 'at', 'c'];

test('the extension exists', () => {
  expect(swift.length).toBeGreaterThan(0);
});

test('the extension reads every rc key the server writes, by that exact name', () => {
  for (const k of RC_KEYS) expect(swift).toContain(`rc["${k}"]`);
  for (const k of ARM_ITEM_KEYS) expect(swift).toContain(`x["${k}"]`);
});

test('it finds rc where Expo puts custom data (top level, "body", or "data")', () => {
  expect(swift).toContain('u["rc"]');
  expect(swift).toContain('for key in ["body", "data"]');
});

test('it reports an armed morning with the armed action and never claims success it did not have', () => {
  expect(swift).toContain('"action": "armed"');
  expect(swift).toMatch(/guard auth != "unsupported", failed == 0, armed\.count == wanted/);
});

test('it arms through the same scheduler the app uses', () => {
  expect(swift).toContain('RollCallAlarmScheduler.scheduleAt(');
  expect(swift).toContain('RollCallAlarmScheduler.cancel(instanceId:');
});

test('the server writes exactly the keys the extension reads', () => {
  const p = { ...armPayload({ kind: 'assigned', title: 'T', label: 'L', url: 'https://x', items: [{ i: 'i', at: 1, c: 'c' }], cancel: [], set: 's' }), diag: 1 };
  expect(Object.keys(p).sort()).toEqual([...RC_KEYS].sort());
  expect(Object.keys(p.arm[0]).sort()).toEqual([...ARM_ITEM_KEYS].sort());
});
