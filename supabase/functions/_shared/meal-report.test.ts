// The bug this guard was written for: a real photo (steak, sweet potato fries, green beans, a
// shake) came back as "~0g protein · high confidence" and could never be fixed, because a
// truncated tool_use was accepted as a finished report.
import { validMealInput, rejectionOutcome } from './meal-report';

const good = {
  name: 'Steak, sweet potato fries, green beans',
  quality: 84,
  protein: 81, kcal: 985, carbs: 75, fat: 37, fiber: 10,
  detected: [{ name: 'ribeye', protein: 62, kcal: 520, carbs: 0, fat: 40 }],
  note: 'Solid dinner.', analysis: 'Good protein, real carbs.',
};

describe('a report we can stand behind', () => {
  it('accepts a complete read', () => {
    expect(validMealInput(good)).toBe(true);
  });

  it('accepts a small snack — low is not empty', () => {
    expect(validMealInput({ ...good, protein: 4, carbs: 22, fat: 1, kcal: 110 })).toBe(true);
  });

  it('accepts a zero-fat plate as long as the plate itself is not zero', () => {
    expect(validMealInput({ ...good, fat: 0 })).toBe(true);
  });
});

describe('the empty read', () => {
  it('rejects the truncated tool_use that started all this — nothing in it at all', () => {
    expect(validMealInput({})).toBe(false);
  });

  it('rejects all-zero macros, which is what the athlete actually saw', () => {
    expect(validMealInput({ ...good, protein: 0, kcal: 0, carbs: 0, fat: 0 })).toBe(false);
  });

  it('rejects a report that stopped before naming a single food', () => {
    expect(validMealInput({ ...good, detected: [] })).toBe(false);
  });

  it('rejects a half-written number', () => {
    expect(validMealInput({ ...good, protein: undefined })).toBe(false);
    expect(validMealInput({ ...good, kcal: 'eighty' })).toBe(false);
    expect(validMealInput({ ...good, carbs: null })).toBe(false);
  });

  it('rejects nonsense', () => {
    expect(validMealInput({ ...good, fat: -12 })).toBe(false);
    expect(validMealInput({ ...good, detected: 'ribeye' })).toBe(false);
    expect(validMealInput(null)).toBe(false);
    expect(validMealInput(undefined)).toBe(false);
    expect(validMealInput('{}')).toBe(false);
    expect(validMealInput([good])).toBe(false);
  });
});

describe('what we call the rejection', () => {
  it('names the token ceiling when that is what happened', () => {
    expect(rejectionOutcome('max_tokens')).toBe('truncated');
  });

  it('falls back to a generic tag otherwise', () => {
    expect(rejectionOutcome('end_turn')).toBe('invalid_tool_input');
    expect(rejectionOutcome(null)).toBe('invalid_tool_input');
    expect(rejectionOutcome(undefined)).toBe('invalid_tool_input');
  });
});
