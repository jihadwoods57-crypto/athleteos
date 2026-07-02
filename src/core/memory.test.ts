import {
  admitCandidate,
  candidateFactsFromCorrection,
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
