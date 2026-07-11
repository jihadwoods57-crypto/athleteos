/**
 * NO FABRICATED PERSONA: S.coach (the athlete's linked coach) and S.coachIdentity (the
 * coach's own profile identity) must derive from real server-hydrated state and degrade to
 * honest neutral copy — never "Coach Mark · Central Catholic". Locks the getter contracts
 * every athlete/coach surface now gates on (hasCoach / isNamed / state).
 *
 * Same node+jsdom bootstrap as wireTogglesCapture.test.ts: globals before the proto graph.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, S, act } = require('../../proto/redesign-2026-07/js/state.js');

beforeEach(() => {
  dom.window.localStorage.clear();
  act._wipeUserScopedState();
});

describe('S.coach — the athlete’s real linked coach', () => {
  test('no team link → hasCoach false, honest generic copy, never a persona', () => {
    expect(RT.myCoach).toBeNull();
    const c = S.coach;
    expect(c.hasCoach).toBe(false);
    expect(c.isNamed).toBe(false);
    expect(c.name).toBe('Your coach');
    expect(c.nameMid).toBe('your coach');
    expect(c.initials).toBe('C');
    expect(c.team).toBe('');
    expect(JSON.stringify(c)).not.toMatch(/Coach Mark|Central Catholic/);
  });

  test('real link with a named head coach → real name, initials, team', () => {
    RT.myCoach = { teamId: 't1', teamName: 'Central HS Varsity', name: 'Sarah Jones' };
    const c = S.coach;
    expect(c.hasCoach).toBe(true);
    expect(c.isNamed).toBe(true);
    expect(c.name).toBe('Sarah Jones');
    expect(c.nameMid).toBe('Sarah Jones');
    expect(c.initials).toBe('SJ');
    expect(c.role).toBe('Head Coach');
    expect(c.team).toBe('Central HS Varsity');
  });

  test('real link but head-coach name unknown → linked, still no invented name', () => {
    RT.myCoach = { teamId: 't1', teamName: 'Central HS Varsity', name: '' };
    const c = S.coach;
    expect(c.hasCoach).toBe(true);
    expect(c.isNamed).toBe(false);
    expect(c.name).toBe('Your coach');
    expect(c.role).toBe('');
  });

  test('sign-out wipes the coach link', async () => {
    RT.myCoach = { teamId: 't1', teamName: 'Central HS', name: 'Sarah Jones' };
    await act.signOut();
    expect(RT.myCoach).toBeNull();
    expect(S.coach.hasCoach).toBe(false);
  });
});

describe('S.coachIdentity — the coach’s own honest four-state identity', () => {
  test('loading until the first hydrate attempt completes', () => {
    RT.teamLoading = true;
    expect(S.coachIdentity.state).toBe('loading');
  });

  test('offline is never misreported as minting', () => {
    RT.teamLoading = false;
    RT.teamOffline = true;
    RT.team = null;
    expect(S.coachIdentity.state).toBe('offline');
  });

  test('confirmed no team row → minting', () => {
    RT.teamLoading = false;
    RT.teamOffline = false;
    RT.team = null;
    expect(S.coachIdentity.state).toBe('minting');
  });

  test('live: server-confirmed name, team, and code', () => {
    RT.teamLoading = false;
    RT.teamOffline = false;
    RT.profile = { name: 'Dana Rivera' };
    RT.team = { id: 't9', name: 'Eastview Track', code: 'RIVERA' };
    const ci = S.coachIdentity;
    expect(ci.state).toBe('live');
    expect(ci.name).toBe('Dana Rivera');
    expect(ci.initials).toBe('DR');
    expect(ci.teamName).toBe('Eastview Track');
    expect(ci.code).toBe('RIVERA');
    expect(ci.hasIdentity).toBe(true);
  });

  test('unknown identity degrades to neutral, never "Coach Mark"', () => {
    RT.teamLoading = false;
    const ci = S.coachIdentity;
    expect(ci.name).toBe('Coach');
    expect(ci.teamName).toBe('Your team');
    expect(ci.hasIdentity).toBe(false);
    expect(JSON.stringify(ci)).not.toMatch(/Coach Mark|Central Catholic/);
  });
});
