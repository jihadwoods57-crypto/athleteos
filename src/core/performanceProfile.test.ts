import { buildProfileView, type ProfileInputs } from './performanceProfile';
import type { MemoryFact } from './memory';

const fact = (over: Partial<MemoryFact>): MemoryFact => ({
  id: 'f', kind: 'favorite_food', value: 'rice', confidence: 1, source: 'athlete_stated', evidenceN: 1, status: 'active', ...over,
});

describe('buildProfileView', () => {
  const base: ProfileInputs = {
    athleteId: 'a1',
    recentScores: [60, 65, 70, 75, 80, 85, 88],
    facts: [
      fact({ kind: 'favorite_food', value: 'chicken' }),
      fact({ kind: 'allergy', value: 'peanut' }),
      fact({ kind: 'dislike', value: 'broccoli', status: 'pending_confirmation' }), // not confirmed -> excluded
    ],
  };

  it('derives consistency from the score history and marks the upward trend', () => {
    const v = buildProfileView(base);
    expect(v.consistency.last7).toBe(75);
    expect(v.consistency.trend).toBe('up');
    expect(v.strengths).toContain('trending up');
  });

  it('surfaces only CONFIRMED safety facts in preferences', () => {
    const v = buildProfileView(base);
    expect(v.preferences.allergies).toEqual(['peanut']);
    expect(v.preferences.dislikes).toEqual([]); // pending_confirmation dislike is excluded
    expect(v.preferences.favoriteFoods).toContain('chicken');
  });

  it('flags weakness on a downward, below-standard history', () => {
    const v = buildProfileView({ ...base, recentScores: [70, 65, 60, 58, 55] });
    expect(v.weaknesses).toContain('trending down');
    expect(v.weaknesses).toContain('below standard recently');
  });

  it('passes through the coach feedback log', () => {
    const v = buildProfileView({ ...base, profileRow: { feedback_log: [{ authorId: 'c1', scope: 'team', text: 'great week', at: 'now' }] } });
    expect(v.feedback).toHaveLength(1);
  });
});
