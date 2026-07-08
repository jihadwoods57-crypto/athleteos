// Honesty regression guard (audit 2026-07-02, item 5): when a CONFIGURED model is asked and
// cannot answer, the app must surface an honest 'unavailable' signal — NEVER a fabricated plate
// or a sample label presented as a real reading. These lock that in against future refactors.
import { mealResultFor } from '@/core';

// Mock the client so we can simulate a configured backend that fails. AiUnavailableError comes
// through from the real module (via requireActual) so `instanceof` in the wrapper still matches.
jest.mock('./client', () => {
  const actual = jest.requireActual('./client');
  return {
    ...actual,
    isAiConfigured: true,
    analyzeMealRemote: jest.fn(),
    analyzeLabelRemote: jest.fn(),
  };
});

import { analyzeLabel, analyzeMeal } from './index';
import { AiUnavailableError, analyzeLabelRemote, analyzeMealRemote } from './client';

const mealRemote = analyzeMealRemote as jest.MockedFunction<typeof analyzeMealRemote>;
const labelRemote = analyzeLabelRemote as jest.MockedFunction<typeof analyzeLabelRemote>;

beforeEach(() => {
  mealRemote.mockReset();
  labelRemote.mockReset();
});

describe('analyzeMeal — honest failure when configured', () => {
  it('maps a rate-limit (429) to unavailable/rate_limited, not a fabricated plate', async () => {
    mealRemote.mockRejectedValueOnce(new AiUnavailableError('rate_limited'));
    const got = await analyzeMeal({ mealType: 'Dinner', goal: null });
    expect(got).toEqual({ kind: 'unavailable', reason: 'rate_limited' });
  });

  it('maps any other failure to unavailable/error, not a fabricated plate', async () => {
    mealRemote.mockRejectedValueOnce(new Error('network down'));
    const got = await analyzeMeal({ mealType: 'Lunch', goal: null });
    expect(got).toEqual({ kind: 'unavailable', reason: 'error' });
  });

  it('still returns a real grounded result on success', async () => {
    mealRemote.mockResolvedValueOnce({ kind: 'result', result: mealResultFor('Lunch') });
    const got = await analyzeMeal({ mealType: 'Lunch', goal: null });
    expect(got.kind).toBe('result');
  });

  it('passes clarifying questions straight through', async () => {
    mealRemote.mockResolvedValueOnce({ kind: 'questions', questions: ['Any drink with it?'] });
    const got = await analyzeMeal({ mealType: 'Lunch', goal: null });
    expect(got).toEqual({ kind: 'questions', questions: ['Any drink with it?'] });
  });
});

describe('analyzeLabel — honest failure when configured', () => {
  it('throws AiUnavailableError instead of returning a sample label as a real reading', async () => {
    labelRemote.mockRejectedValueOnce(new AiUnavailableError('error'));
    await expect(analyzeLabel({})).rejects.toBeInstanceOf(AiUnavailableError);
  });
});
