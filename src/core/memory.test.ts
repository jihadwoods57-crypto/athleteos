import {
  admitCandidate,
  avoidFoodsFromFacts,
  candidateFactsFromCorrection,
  candidateFactsFromFoodChange,
  promoteFact,
  retrieveForTask,
  safetyConstraints,
  type MemoryFact,
} from './memory';
import type { MealResult } from './content';
import type { EditableFood } from './mealEdit';

const fact = (over: Partial<MemoryFact>): MemoryFact => ({
  id: 'f', kind: 'favorite_food', value: 'rice', confidence: 0.5, source: 'inferred_log', evidenceN: 1, status: 'active', ...over,
});

describe('memory — the LLM never writes a safety fact without confirmation', () => {
  it('routes an inferred allergy to confirmation, never active', () => {
    const admitted = admitCandidate(fact({ kind: 'allergy', source: 'inferred_correction', status: 'active' }));
    expect(admitted.status).toBe('pending_confirmation');
  });

  it('routes a coach-stated allergy to confirmation (athlete must confirm)', () => {
    expect(admitCandidate(fact({ kind: 'allergy', source: 'coach_stated' })).status).toBe('pending_confirmation');
  });

  it('accepts an athlete-stated fact directly', () => {
    expect(admitCandidate(fact({ kind: 'allergy', source: 'athlete_stated' })).status).toBe('active');
  });

  it('safetyConstraints only ever come from confirmed (active) safety facts', () => {
    const facts = [
      fact({ kind: 'allergy', value: 'peanut', status: 'pending_confirmation' }),
      fact({ kind: 'dislike', value: 'broccoli', status: 'active', source: 'athlete_stated' }),
    ];
    const c = safetyConstraints(facts);
    expect(c).toHaveLength(1);
    expect(c[0].value).toBe('broccoli');
  });
});

describe('memory — corrections propose, never commit safety facts', () => {
  const before = { name: 'Bowl', quality: 70, protein: 30, kcal: 500, carbs: 40, fat: 15, detected: ['broccoli', 'rice'], note: '' } as MealResult;
  const after = [{ name: 'chicken' }, { name: 'rice' }] as EditableFood[];

  it('a removed food becomes a dislike candidate that needs confirmation', () => {
    const cands = candidateFactsFromCorrection(before, after);
    const dislike = cands.find((f) => f.kind === 'dislike');
    expect(dislike?.value).toBe('broccoli');
    expect(dislike?.status).toBe('pending_confirmation');
    expect(dislike?.confidence).toBeLessThan(0.5);
  });

  it('an added food becomes a favorite candidate (non-safety, can accrue)', () => {
    const fav = candidateFactsFromCorrection(before, after).find((f) => f.kind === 'favorite_food');
    expect(fav?.value).toBe('chicken');
  });
});

describe('memory flywheel — write path over raw food names (audit item 13)', () => {
  it('candidateFactsFromFoodChange mirrors the MealResult version, keyed on names', () => {
    const cands = candidateFactsFromFoodChange(['broccoli', 'rice'], [{ name: 'chicken' }, { name: 'rice' }] as EditableFood[]);
    expect(cands.find((f) => f.kind === 'dislike')?.value).toBe('broccoli');
    expect(cands.find((f) => f.kind === 'favorite_food')?.value).toBe('chicken');
  });

  it('no change (same foods, only reordered/re-cased) proposes nothing', () => {
    expect(candidateFactsFromFoodChange(['Rice', 'Chicken'], [{ name: 'chicken' }, { name: 'rice' }] as EditableFood[])).toEqual([]);
  });

  it('an empty before never infers a dislike (no first-log noise)', () => {
    const cands = candidateFactsFromFoodChange([], [{ name: 'eggs' }] as EditableFood[]);
    expect(cands.some((f) => f.kind === 'dislike')).toBe(false);
  });

  it('the store learns dislikes only: admit + filter leaves a pending safety fact', () => {
    // Mirrors learnFromCorrection: candidates -> admitCandidate -> keep pending_confirmation.
    const learned = candidateFactsFromFoodChange(['broccoli', 'rice'], [{ name: 'chicken' }, { name: 'rice' }] as EditableFood[])
      .map(admitCandidate)
      .filter((f) => f.status === 'pending_confirmation');
    expect(learned).toHaveLength(1);
    expect(learned[0]).toMatchObject({ kind: 'dislike', value: 'broccoli', status: 'pending_confirmation' });
  });
});

describe('memory flywheel — read path (avoidFoodsFromFacts)', () => {
  it('lists only confirmed (active) safety facts, lowercased and de-duped', () => {
    const facts = [
      fact({ kind: 'allergy', value: 'Peanut', status: 'active', source: 'athlete_stated' }),
      fact({ kind: 'dislike', value: 'peanut', status: 'active', source: 'athlete_stated' }), // dup after lowercasing
      fact({ kind: 'allergy', value: 'Shellfish', status: 'pending_confirmation' }),           // unconfirmed -> excluded
      fact({ kind: 'favorite_food', value: 'chicken', status: 'active' }),                     // non-safety -> excluded
    ];
    expect(avoidFoodsFromFacts(facts).sort()).toEqual(['peanut']);
  });

  it('returns an empty list when there are no confirmed safety facts', () => {
    expect(avoidFoodsFromFacts([fact({ kind: 'favorite_food', value: 'rice' })])).toEqual([]);
  });
});

describe('memory — retrieval + promotion', () => {
  it('surfaces safety facts first', () => {
    const facts = [fact({ kind: 'favorite_food' }), fact({ kind: 'allergy', source: 'athlete_stated' })];
    expect(retrieveForTask(facts, 'meal_coaching', null)[0].kind).toBe('allergy');
  });

  it('promoteFact raises confidence and evidence with repetition', () => {
    const p = promoteFact(fact({ confidence: 0.4, evidenceN: 2 }), fact({}));
    expect(p.evidenceN).toBe(3);
    expect(p.confidence).toBeGreaterThan(0.4);
  });
});
