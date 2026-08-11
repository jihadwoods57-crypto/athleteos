// Trust Pass policy editor (0196 consumer): the client clamp must never let an operator set a
// value the DB check constraint would reject, and must keep the two credit fields coherent with
// each other. jsdom globals must exist before the proto state graph evaluates — same pattern as
// protoSessionWipe.test.ts.
//
// This file previously asserted the PRE-0196 policy: a two-field { length_days, eligibility_days }
// shape on RT.trustPolicy, bounded 1..60 / 1..30 by migration 0097. 0196 rebuilt the pass as a
// grantable reward and replaced that with four fields on RT.passPolicy. The test kept asserting
// the old shape and had been red on master ever since — invisible, because `npm run verify` chains
// nine gates with && and died at the FOURTH (lint:score) on files the repo does not even own, so
// jest never ran. Bounds below are read straight off 0196's check constraints; if a migration
// moves one, this test is the thing that should fail.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');

// 0196: default_credits 1..14 · default_window_days 1..14 · eligibility_days 1..30 · max_credits 1..14
const SHIPPED_DEFAULT = { default_credits: 3, default_window_days: 2, eligibility_days: 7, max_credits: 5 };

describe('act.setTrustPolicy clamps to 0196 bounds', () => {
  beforeEach(() => { RT.passPolicy = { ...SHIPPED_DEFAULT }; RT.team = null; RT.practice = null; });

  it('clamps default credits to 1..max_credits', () => {
    act.setTrustPolicy({ default_credits: 999 });
    expect(RT.passPolicy.default_credits).toBe(5); // the book's ceiling, not the table's 14
    act.setTrustPolicy({ default_credits: 0 });
    expect(RT.passPolicy.default_credits).toBe(1);
  });

  it('clamps the default window to 1..14', () => {
    act.setTrustPolicy({ default_window_days: 99 });
    expect(RT.passPolicy.default_window_days).toBe(14);
    act.setTrustPolicy({ default_window_days: -3 });
    expect(RT.passPolicy.default_window_days).toBe(1);
  });

  it('clamps eligibility to 1..30', () => {
    act.setTrustPolicy({ eligibility_days: 50 });
    expect(RT.passPolicy.eligibility_days).toBe(30);
    act.setTrustPolicy({ eligibility_days: -5 });
    expect(RT.passPolicy.eligibility_days).toBe(1);
  });

  it('clamps max credits to 1..14', () => {
    act.setTrustPolicy({ max_credits: 999 });
    expect(RT.passPolicy.max_credits).toBe(14);
    act.setTrustPolicy({ max_credits: 0 });
    expect(RT.passPolicy.max_credits).toBe(1);
  });

  it('a partial patch preserves every other field', () => {
    act.setTrustPolicy({ eligibility_days: 12 });
    expect(RT.passPolicy).toEqual({ ...SHIPPED_DEFAULT, eligibility_days: 12 });
  });

  it('garbage falls back to the shipped default, not NaN', () => {
    act.setTrustPolicy({ default_credits: NaN });
    expect(RT.passPolicy.default_credits).toBe(3);
    act.setTrustPolicy({ max_credits: 'seven' as any });
    expect(RT.passPolicy.max_credits).toBe(5);
  });

  it('rounds a fractional value rather than storing it', () => {
    act.setTrustPolicy({ eligibility_days: 7.6 });
    expect(RT.passPolicy.eligibility_days).toBe(8);
  });

  // The invariant 0196's table cannot express: each credit field is independently legal at 1..14,
  // so { default_credits: 10, max_credits: 3 } is a valid row that grant_pass would refuse and
  // pass-grant.js would render as "10 camera-free meals / Max 3 per grant" before granting 3.
  it('lowering the ceiling pulls the default down with it', () => {
    act.setTrustPolicy({ default_credits: 10, max_credits: 12 });
    expect(RT.passPolicy).toMatchObject({ default_credits: 10, max_credits: 12 });
    act.setTrustPolicy({ max_credits: 3 });
    expect(RT.passPolicy.default_credits).toBe(3);
    expect(RT.passPolicy.max_credits).toBe(3);
  });

  it('a default above the ceiling is refused in the same patch', () => {
    act.setTrustPolicy({ default_credits: 14, max_credits: 4 });
    expect(RT.passPolicy.default_credits).toBe(4);
    expect(RT.passPolicy.max_credits).toBe(4);
  });

  it('never stores a policy grant_pass would refuse', () => {
    for (const d of [-1, 0, 1, 3, 9, 14, 99]) {
      for (const m of [-1, 0, 1, 4, 14, 99]) {
        RT.passPolicy = { ...SHIPPED_DEFAULT };
        act.setTrustPolicy({ default_credits: d, max_credits: m });
        const p = RT.passPolicy;
        expect(p.max_credits).toBeGreaterThanOrEqual(1);
        expect(p.max_credits).toBeLessThanOrEqual(14);
        expect(p.default_credits).toBeGreaterThanOrEqual(1);
        expect(p.default_credits).toBeLessThanOrEqual(p.max_credits);
      }
    }
  });
});
