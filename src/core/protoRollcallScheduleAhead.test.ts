/**
 * Schedule ahead (0215): the coach manages the NEXT roll call and the week.
 *
 * The proto has no build step, so a template that throws does so at tap time on a phone. These
 * render the three new states through the REAL screen module under jsdom, seeded through the
 * harness seams, and pin the copy a coach reads:
 *   - a day ahead: "Scheduled", the schedule card with the time picker and Skip, no ring of zeros
 *   - a skipped day: "Skipped", Put it back, no message card
 *   - Home: the "Next roll call" card once today's has closed, with Change and a two-tap Skip
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { seedBoardForHarness, todayISO, shiftISO } = require('../../proto/redesign-2026-07/js/commitment-data.js');
const { coachCommitments, commitmentBoardCard, seedScheduleForHarness } = require('../../proto/redesign-2026-07/js/screens/coach-commitments.js');

const today = todayISO();
const tomorrow = shiftISO(today, 1);

/** One wake-up occurrence as commitment_board reports it after 0215. */
const occurrence = (over: Record<string, unknown> = {}) => {
  const day = String(over.occurs_on || tomorrow);
  const base = Date.parse(`${day}T10:00:00Z`); // 6:00 AM New York in summer
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    instance_id: `inst-${day}`, commitment_id: 'c1', type: 'morning_roll_call',
    title: 'Wake-Up Roll Call', message: 'Everyone up and ready to go?', standing_message: 'Everyone up and ready to go?',
    message_override: null, action_label: null,
    occurs_on: day, instance_status: 'scheduled', skipped: false,
    starts_at: iso(base), respond_by_at: iso(base + 5 * 60000), ends_at: null,
    opens_at: iso(base), closes_at: iso(base + 30 * 60000),
    starts_min: 360, respond_by_min: 365, rule_starts_min: 360, starts_override_min: null,
    grace_min: 5, timezone: 'America/New_York', audience_kind: 'team', audience_label: null,
    note: null, schedule_set_at: null, schedule_set_by_name: null, total: 2, answered: 0,
    rows: [
      { response_id: 'r1', athlete_id: 'a1', name: 'Ava Brooks', status: 'pending', verdict: 'pending', acknowledged_at: null },
      { response_id: 'r2', athlete_id: 'a2', name: 'Ben Cole', status: 'pending', verdict: 'pending', acknowledged_at: null },
    ],
    ...over,
  };
};

describe('the roll-call board, a day ahead', () => {
  test('renders as a setup screen: Scheduled, the schedule card, the strip, no ring', () => {
    const inst = occurrence();
    seedBoardForHarness([inst], tomorrow);
    seedScheduleForHarness({ commitmentId: 'c1', upcoming: [occurrence({ occurs_on: today, instance_id: 'inst-today' }), inst] });
    const html = coachCommitments.render({ sub: inst.instance_id });
    expect(html).toContain('Tomorrow');
    expect(html).toContain('Scheduled');
    expect(html).toContain('Goes out');
    expect(html).toContain('id="wk-sched-time"');
    expect(html).toContain('Skip this day');
    expect(html).toContain('Save for this day');
    expect(html).toContain('Who gets it');
    expect(html).toContain('wk-strip');
    expect(html).not.toContain('wk-ring-n');       // no ring of zeros on a day that has not happened
    expect(html).not.toContain('Waiting on');      // nobody is late for a morning that has not come
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  test('a moved day says so, and offers the way back to the rule', () => {
    const inst = occurrence({ starts_override_min: 390, starts_min: 390, schedule_set_by_name: 'Coach Reyes', schedule_set_at: new Date().toISOString(), note: 'Late game' });
    seedBoardForHarness([inst], tomorrow);
    seedScheduleForHarness({ commitmentId: 'c1', upcoming: [inst] });
    const html = coachCommitments.render({ sub: inst.instance_id });
    expect(html).toContain('Moved to 6:30 AM this day only. Usually 6:00 AM.');
    expect(html).toContain('Moved by Coach Reyes · Late game');
    expect(html).toContain('id="wk-sched-reset"');
    expect(html).toContain('Back to 6:00 AM');
    expect(html).toContain('wk-dot');              // the strip marks the changed day
  });

  test('a skipped day: Skipped, Put it back, and no message card', () => {
    const inst = occurrence({ skipped: true, instance_status: 'cancelled', schedule_set_by_name: 'Coach Reyes', schedule_set_at: new Date().toISOString() });
    seedBoardForHarness([inst], tomorrow);
    seedScheduleForHarness({ commitmentId: 'c1', upcoming: [inst] });
    const html = coachCommitments.render({ sub: inst.instance_id });
    expect(html).toContain('Skipped');
    expect(html).toContain('Nobody gets a roll call this day');
    expect(html).toContain('Put it back');
    expect(html).not.toContain('id="wk-sched-time"');
    expect(html).not.toContain('wk-msgcard');
    expect(html).not.toContain('undefined');
  });
});

describe('Home: the next roll call', () => {
  test('shows tomorrow once today is closed, with Change and a Skip that needs two taps', () => {
    const closedToday = occurrence({
      occurs_on: today, instance_id: 'inst-today',
      starts_at: '2020-01-01T10:00:00Z', respond_by_at: '2020-01-01T10:05:00Z', opens_at: '2020-01-01T10:00:00Z', closes_at: '2020-01-01T10:30:00Z',
    });
    const next = occurrence({ message: 'Feet on the floor. Bus at 7.' });
    seedBoardForHarness([], today);
    seedScheduleForHarness({ commitmentId: 'c1', upcoming: [closedToday, next] });
    const html = commitmentBoardCard();
    expect(html).toContain('Next roll call · Tomorrow');
    expect(html).toContain('6:00 AM');
    expect(html).toContain('2 will get it');
    expect(html).toContain('Feet on the floor. Bus at 7.');
    expect(html).toContain('data-wk-day="' + tomorrow + '"');
    expect(html).toContain('data-wk-skip=');
    expect(html).not.toContain('for sure');       // the first tap only arms it
  });

  test('says nothing when nothing is ahead', () => {
    seedBoardForHarness([], today);
    seedScheduleForHarness({ commitmentId: 'c1', upcoming: [] });
    expect(commitmentBoardCard()).toBe('');
  });

  test('a skipped next day offers Put it back instead of Skip', () => {
    seedBoardForHarness([], today);
    seedScheduleForHarness({ commitmentId: 'c1', upcoming: [occurrence({ skipped: true, instance_status: 'cancelled' })] });
    const html = commitmentBoardCard();
    expect(html).toContain('Skipped');
    expect(html).toContain('data-wk-unskip=');
    expect(html).not.toContain('data-wk-skip=');
  });
});
