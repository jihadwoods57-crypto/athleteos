// The Live Activity wire contract, checked from the Swift side.
//
// Nothing on this Windows machine compiles Swift, and a key the server sends that Swift does not
// read (or a key Swift REQUIRES that an older server never sends) does not throw anywhere: iOS
// drops the push and the card simply never changes. So the two spellings are compared as text.
import { readFileSync } from 'fs';
import { join } from 'path';
import { liveContentState, type LiveAttributes } from '../../supabase/functions/_shared/rollcall-live';

const swift = readFileSync(join(__dirname, 'ios', 'RollCallAttributes.swift'), 'utf8').replace(/\r\n/g, '\n');

function codingKeys(): string[] {
  const m = /enum CodingKeys: String, CodingKey \{\s*case ([^\n}]+)/.exec(swift);
  if (!m) throw new Error('ContentState CodingKeys not found');
  return m[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
}

test('every content-state key the server sends is one Swift reads, and nothing more', () => {
  const state = liveContentState({ respond_by_at: '2026-09-25T10:05:00Z', closes_at: '2026-09-25T10:30:00Z', message: 'Up.' }, 'answered');
  expect(codingKeys()).toEqual(Object.keys(state).sort());
});

test('the fields added after the first build are read leniently, so an older push still decodes', () => {
  for (const k of ['teamUp', 'teamTotal', 'place', 'points']) {
    expect(swift).toMatch(new RegExp(`try\\? c\\.decodeIfPresent\\(Int\\.self, forKey: \\.${k}\\)`));
  }
});

test('every attribute the server starts a card with is a stored property in Swift', () => {
  const attrs: Required<LiveAttributes> = {
    instanceId: 'i', title: 't', coachName: 'c', coachInitials: 'C', actionLabel: 'a', ackCode: 'k', ackUrl: 'https://x',
  };
  for (const k of Object.keys(attrs)) {
    expect(swift).toMatch(new RegExp(`public var ${k}: String\\??\\n`));
  }
});

const read = (f: string) => readFileSync(join(__dirname, 'ios', f), 'utf8').replace(/\r\n/g, '\n');

describe('roll call v3: the alarm IS the check-in', () => {
  const alarm = read('RollCallAlarm.swift');
  const intents = read('RollCallCheckInIntent.swift');
  const widget = read('RollCallWidget.swift');

  test('both alarm buttons run the board intent', () => {
    expect(alarm).toMatch(/stopIntent: RollCallAttackDayIntent\(/);
    expect(alarm).toMatch(/secondaryIntent: RollCallAttackDayIntent\(/);
  });
  test('the board intent checks in, marks the tap for the board, and opens the app', () => {
    const body = intents.slice(intents.indexOf('public struct RollCallAttackDayIntent'));
    expect(body).toMatch(/openAppWhenRun: Bool = true/);
    expect(body).toMatch(/RollCallPendingStore\.record\(instanceId: instanceId, at: at, board: true\)/);
    expect(body).toMatch(/RollCallAckPoster\.post\(code: ackCode, url: ackUrl, at: at\)/);
  });
  test('the Live Activity button does the same', () => {
    expect(widget).toMatch(/Button\(intent: RollCallAttackDayIntent\(/);
  });
  test('the old intent type stays, for alarms armed by older builds', () => {
    expect(intents).toMatch(/public struct RollCallCheckInIntent: LiveActivityIntent/);
  });
  test('no snooze: the second button is custom, never countdown', () => {
    expect(alarm).toMatch(/secondaryButtonBehavior: \.custom/);
    expect(alarm).not.toMatch(/secondaryButtonBehavior: \.countdown/);
  });
  test('the board intent is defined once, in the shared file', () => {
    expect(alarm).not.toMatch(/struct RollCallAttackDayIntent/);
  });
});
