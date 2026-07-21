/**
 * FIRST-DAY ACTIVATION — live wiring (state.js getters over DAY + RT). Locks the founder-flagged
 * fix end-to-end: a just-activated athlete's Home never shows overdue/Off-Standard for windows
 * that closed before they signed up. Runs under node with jsdom installed manually (same pattern
 * as protoSessionWipe.test.ts) — globals must exist BEFORE the proto module graph evaluates.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { S, RT, act } = require('../../proto/redesign-2026-07/js/state.js');
const { DAY } = require('../../proto/redesign-2026-07/js/day.js');

const t = new Date();
const todayISO = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
// A local 6:34 PM stamp on today's date — round-trips through toISOString to the same local
// wall-clock (activationMin = 1114) regardless of the runner's timezone.
const activatedToday634pm = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 18, 34).toISOString();
const activatedYesterday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1, 18, 34).toISOString();

const lunch = (e: any) => e.items.find((i: any) => i.id === 'lunch'); // lunch is a daily requirement (due 2:00 PM)

beforeEach(() => {
  dom.window.localStorage.clear();
  act._wipeUserScopedState();
  DAY.date = todayISO;
});

test('activated today at 6:34 PM → Home is Not-yet-scored and lunch reads Not required (never overdue)', () => {
  RT.activationDate = activatedToday634pm;
  expect(S.activation.isActivationDay).toBe(true);
  expect(S.notYetScored).toBe(true);
  // Lunch's 2:00 PM window closed long before 6:34 PM — it is excused today, not overdue.
  const l = lunch(S.exec);
  expect(l.state).toBe('not_required');
  expect(S.exec.overdue.some((i: any) => i.id === 'lunch')).toBe(false);
});

test('activated yesterday → fully scored today (no first-day grace)', () => {
  RT.activationDate = activatedYesterday;
  expect(S.activation.isActivationDay).toBe(false);
  expect(S.notYetScored).toBe(false);
  expect(S.activation.activationMin).toBeNull();
});

test('no activation stamp (existing athlete) → unaffected, fully scored', () => {
  RT.activationDate = null;
  expect(S.activation.isActivationDay).toBe(false);
  expect(S.notYetScored).toBe(false);
});

test('server committed_at is the cross-device activation backstop when the local stamp is absent', () => {
  RT.activationDate = null;
  RT.profile = { committedAt: activatedToday634pm };
  expect(S.notYetScored).toBe(true);
  expect(lunch(S.exec).state).toBe('not_required');
});

test('activation-day Home renders "Not scored yet" and never "Off Standard" or an overdue lunch', () => {
  RT.activationDate = activatedToday634pm;
  const home = require('../../proto/redesign-2026-07/js/screens/home.js').default;
  const html: string = home.render();
  expect(html).toContain('Not scored yet');
  expect(html).not.toContain('Off Standard');
  expect(html).toContain("won't count against you today"); // the fairness note
  // the lunch row, if shown, must read Not required — never the red Overdue pill
  expect(html).not.toMatch(/Lunch[\s\S]{0,80}Overdue/);
});

describe('activation anchors to the account birthday, not a stale device stamp', () => {
  const isoDaysAgo = (days: number, h = 12, mi = 0) =>
    new Date(t.getFullYear(), t.getMonth(), t.getDate() - days, h, mi).toISOString();

  test('created today but committed_at is 11 days stale → still activation day (created_at wins)', () => {
    // Reproduces the founder's row: created today, committed_at carried from 11 days ago.
    RT.activationDate = isoDaysAgo(11, 12, 35); // stale local carry too
    RT.profile = { createdAt: activatedToday634pm, committedAt: isoDaysAgo(11, 12, 35) };
    expect(S.activation.isActivationDay).toBe(true);
    expect(S.notYetScored).toBe(true);
    expect(lunch(S.exec).state).toBe('not_required'); // lunch window closed pre-signup → excused
  });

  test('created today + committed_at same day → uses committed_at to refine the minute', () => {
    const createdEarly = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 9, 0).toISOString();
    RT.activationDate = null;
    RT.profile = { createdAt: createdEarly, committedAt: activatedToday634pm };
    expect(S.activation.isActivationDay).toBe(true);
    expect(S.activation.activationMin).toBe(1114); // 6:34 PM, the finer commit minute
  });

  test('created yesterday (established user) → fully active even if a commit stamp is today', () => {
    RT.activationDate = activatedToday634pm;
    RT.profile = { createdAt: isoDaysAgo(1, 18, 34), committedAt: activatedToday634pm };
    expect(S.activation.isActivationDay).toBe(false);
    expect(S.notYetScored).toBe(false);
  });

  test('no created_at (older client) → falls back to the commit stamp (prior behavior)', () => {
    RT.activationDate = activatedToday634pm;
    RT.profile = {}; // no createdAt
    expect(S.notYetScored).toBe(true);
  });
});
