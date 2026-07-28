// Trust Pass policy editor (0097/0099 consumer): the client clamp must never let the coach set a
// value the DB check constraint (length 1..60, eligibility 1..30) would reject. jsdom globals must
// exist before the proto state graph evaluates — same pattern as protoSessionWipe.test.ts.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');

describe('act.setTrustPolicy clamps to the DB bounds', () => {
  beforeEach(() => { RT.trustPolicy = { length_days: 10, eligibility_days: 7 }; RT.team = null; });

  it('clamps pass length to 1..60', () => {
    act.setTrustPolicy({ length_days: 999 });
    expect(RT.trustPolicy.length_days).toBe(60);
    act.setTrustPolicy({ length_days: 0 });
    expect(RT.trustPolicy.length_days).toBe(1);
  });
  it('clamps eligibility to 1..30', () => {
    act.setTrustPolicy({ eligibility_days: 50 });
    expect(RT.trustPolicy.eligibility_days).toBe(30);
    act.setTrustPolicy({ eligibility_days: -5 });
    expect(RT.trustPolicy.eligibility_days).toBe(1);
  });
  it('a partial patch preserves the other field', () => {
    act.setTrustPolicy({ length_days: 14 });
    expect(RT.trustPolicy).toEqual({ length_days: 14, eligibility_days: 7 });
  });
  it('garbage falls back to a safe default', () => {
    act.setTrustPolicy({ length_days: NaN });
    expect(RT.trustPolicy.length_days).toBe(10);
  });
});
