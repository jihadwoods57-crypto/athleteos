import { athleteKey, getAthletePlan, setAthletePlan, assignPlanToMany, type AthletePlans } from './athletePlans';
import { buildPlanDraft } from './planDraft';
import { DEFAULT_PLAN } from './coachPlan';

const slots = () => buildPlanDraft(DEFAULT_PLAN, 'gain');

describe('athleteKey', () => {
  it('prefers the backend id, falls back to name', () => {
    expect(athleteKey({ athleteId: 'uuid-1', name: 'Maya' })).toBe('uuid-1');
    expect(athleteKey({ athleteId: null, name: 'Maya' })).toBe('Maya');
    expect(athleteKey({ athleteId: '  ', name: 'Maya' })).toBe('Maya');
  });
});

describe('get/setAthletePlan', () => {
  it('returns [] for an unknown athlete', () => {
    expect(getAthletePlan({}, 'Maya')).toEqual([]);
  });

  it('sets one athlete without touching others', () => {
    const map: AthletePlans = { Andre: slots() };
    const out = setAthletePlan(map, 'Maya', slots());
    expect(getAthletePlan(out, 'Maya')).toHaveLength(4);
    expect(getAthletePlan(out, 'Andre')).toHaveLength(4);
    expect(map.Maya).toBeUndefined(); // original not mutated
  });

  it('clears an athlete when set to an empty plan', () => {
    const map: AthletePlans = { Maya: slots() };
    const out = setAthletePlan(map, 'Maya', []);
    expect(out.Maya).toBeUndefined();
  });
});

describe('assignPlanToMany', () => {
  it('copies one plan to every listed athlete, each an independent array', () => {
    const s = slots();
    const out = assignPlanToMany({}, ['Maya', 'Andre', 'Eli'], s);
    expect(Object.keys(out).sort()).toEqual(['Andre', 'Eli', 'Maya']);
    expect(out.Maya).toHaveLength(4);
    expect(out.Maya).not.toBe(out.Andre); // separate arrays
    expect(out.Maya[0]).not.toBe(out.Andre[0]); // separate slot objects
  });

  it('skips empty keys and preserves existing entries', () => {
    const out = assignPlanToMany({ Sofia: slots() }, ['Maya', ''], slots());
    expect(Object.keys(out).sort()).toEqual(['Maya', 'Sofia']);
  });
});
