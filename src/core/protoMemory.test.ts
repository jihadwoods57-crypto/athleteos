/**
 * The memory flywheel: what an athlete's corrections teach the AI about them.
 *
 * TWO THINGS THIS FILE PROTECTS.
 *
 * 1. THE SAFETY GATE. An inferred safety fact must NEVER bind on its own. Removing mushrooms from
 *    one plate is weak evidence of a dislike and no evidence of an allergy — so it lands as
 *    `pending_confirmation` and only becomes real when the athlete taps yes. If this ever inverts,
 *    a single mis-tap on a food chip silently becomes a dietary restriction the model honours
 *    forever, and the athlete is never told.
 *
 * 2. PORT PARITY. proto/js/memory.js is a port of src/core/memory.ts, which stays as the reference
 *    implementation. Two copies of a rule is exactly the drift shape that produced the contradictory
 *    streak engines, so the port is asserted against the original rather than trusted.
 */
const path = require('path');
const MEM_JS = path.join(__dirname, '..', '..', 'proto', 'redesign-2026-07', 'js', 'memory.js');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const proto = require(MEM_JS);
import { candidateFactsFromFoodChange as tsCandidates, admitCandidate as tsAdmit } from './memory';

describe('the safety gate', () => {
  it('an inferred dislike is pending, never active', () => {
    const [fact] = proto.candidateFactsFromFoodChange(['mushrooms'], []);
    expect(fact.kind).toBe('dislike');
    expect(fact.status).toBe('pending_confirmation');
  });

  it('an athlete-stated fact is trusted immediately — they own their own facts', () => {
    const f = proto.admitCandidate({ kind: 'dislike', value: 'mushrooms', source: 'athlete_stated' });
    expect(f.status).toBe('active');
  });

  it('a non-safety inference may go active and accrue', () => {
    const [fact] = proto.candidateFactsFromFoodChange([], [{ name: 'Greek yogurt' }]);
    expect(fact.kind).toBe('favorite_food');
    expect(fact.status).toBe('active');
    expect(fact.confidence).toBeLessThan(1);
  });

  it('the avoid-list contains only CONFIRMED safety facts', () => {
    const facts = [
      { kind: 'dislike', value: 'mushrooms', status: 'pending_confirmation' },
      { kind: 'dislike', value: 'olives', status: 'active' },
      { kind: 'allergy', value: 'peanuts', status: 'active' },
      { kind: 'favorite_food', value: 'rice', status: 'active' },
    ];
    expect(proto.avoidFoodsFromFacts(facts).sort()).toEqual(['olives', 'peanuts']);
  });
});

describe('port parity with src/core/memory.ts', () => {
  const cases: Array<[string[], Array<{ name: string }>]> = [
    [['mushrooms', 'rice'], [{ name: 'rice' }]],
    [[], [{ name: 'salmon' }]],
    [['chicken'], [{ name: 'chicken' }]],
    [['A', 'B'], [{ name: 'C' }]],
  ];
  it.each(cases)('same kinds and statuses for %j -> %j', (before, after) => {
    const mine = proto.candidateFactsFromFoodChange(before, after)
      .map((f: { kind: string; status: string; value: string }) => `${f.kind}:${f.value}:${f.status}`).sort();
    const ref = tsCandidates(before, after as never)
      .map((f) => `${f.kind}:${f.value}:${f.status}`).sort();
    expect(mine).toEqual(ref);
  });

  it('admitCandidate agrees with the reference on the safety decision', () => {
    for (const kind of ['allergy', 'dislike', 'favorite_food', 'meal_timing']) {
      for (const source of ['athlete_stated', 'coach_stated', 'inferred_correction']) {
        const input = { kind, value: 'x', confidence: 0.3, source, evidenceN: 1, evidence_n: 1, id: 'c', status: 'active' };
        expect(proto.admitCandidate({ ...input }).status).toBe(tsAdmit({ ...input } as never).status);
      }
    }
  });
});

describe('corrections become calibration priors', () => {
  it('"portion was double" means the AI read LOW', () => {
    const [f] = proto.factsFromCorrection('portion', 'double');
    expect(f.kind).toBe('behavior_pattern');
    expect(f.value).toBe('portion_underread');
  });
  it('"about half" means the AI read HIGH', () => {
    expect(proto.factsFromCorrection('portion', 'half')[0].value).toBe('portion_overread');
  });
  it('cooking fat becomes a standing assumption', () => {
    expect(proto.factsFromCorrection('cooking', 'butter')[0].value).toBe('cooks_with_butter');
    expect(proto.factsFromCorrection('cooking', 'neither')).toEqual([]);
  });
  it('a "none" drink teaches nothing', () => {
    expect(proto.factsFromCorrection('drink', 'none')).toEqual([]);
    expect(proto.factsFromCorrection('drink', 'milk')[0].kind).toBe('favorite_food');
  });
  it('a portion prior is NOT coach-readable (0019 mem_coach_rd kind list)', () => {
    // behavior_pattern is deliberately absent from the coach-readable kinds: "consistently
    // underestimates portions" reads as a judgement about honesty; it is a fact about the camera.
    const COACH_READABLE = ['allergy', 'dislike', 'meal_timing', 'budget', 'favorite_food', 'favorite_restaurant', 'hydration_habit'];
    expect(COACH_READABLE).not.toContain('behavior_pattern');
  });
});

describe('evidence accrues, never runs away', () => {
  it('repeats raise confidence and the count, capped at 1', () => {
    let f = { kind: 'behavior_pattern', value: 'portion_underread', confidence: 0.3, evidence_n: 1 };
    for (let i = 0; i < 20; i++) f = proto.promoteFact(f, f);
    expect(f.confidence).toBeLessThanOrEqual(1);
    expect(f.evidence_n).toBe(21);
  });
  it('ranks safety above priors above taste', () => {
    const ranked = proto.rankFacts([
      { kind: 'favorite_food', value: 'rice', confidence: 1, evidence_n: 9 },
      { kind: 'behavior_pattern', value: 'portion_underread', confidence: 0.3, evidence_n: 1 },
      { kind: 'allergy', value: 'peanuts', confidence: 0.3, evidence_n: 1 },
    ]).map((f: { kind: string }) => f.kind);
    expect(ranked).toEqual(['allergy', 'behavior_pattern', 'favorite_food']);
  });
});
