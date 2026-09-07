// The bug this guard was written for: a real photo (steak, sweet potato fries, green beans, a
// shake) came back as "~0g protein · high confidence" and could never be fixed, because a
// truncated tool_use was accepted as a finished report.
import { repairMealReport } from './meal-verify';
import { mealInputRejection, validMealInput, rejectionOutcome } from './meal-report';

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

/* The yes/no answer was all telemetry ever got, so one meal in six failed as the same four words
   and nobody could tell a missing fat figure from an empty plate (2026-09-07). */
describe('mealInputRejection names the reason', () => {
  const ok = { protein: 30, kcal: 500, carbs: 40, fat: 20, detected: [{ name: 'steak' }] };

  it('returns null for a report that is fine, and agrees with validMealInput', () => {
    expect(mealInputRejection(ok)).toBeNull();
    expect(validMealInput(ok)).toBe(true);
  });

  it('names the missing macro rather than shrugging', () => {
    expect(mealInputRejection({ ...ok, fat: undefined })).toBe('missing:fat');
    expect(mealInputRejection({ ...ok, protein: null })).toBe('missing:protein');
    expect(mealInputRejection({ ...ok, kcal: '' })).toBe('missing:kcal');
    expect(mealInputRejection({ ...ok, carbs: true })).toBe('missing:carbs');
  });

  it('separates a bad number from a missing one', () => {
    expect(mealInputRejection({ ...ok, fat: 'heavy' })).toBe('not_a_number:fat');
    expect(mealInputRejection({ ...ok, fat: -3 })).toBe('negative:fat');
  });

  it('distinguishes an empty read from a missing food list', () => {
    expect(mealInputRejection({ ...ok, protein: 0, kcal: 0, carbs: 0, fat: 0 })).toBe('all_macros_zero');
    expect(mealInputRejection({ ...ok, detected: [] })).toBe('detected_empty');
    expect(mealInputRejection({ ...ok, detected: 'steak' })).toBe('detected_not_an_array');
  });

  it('rejects a non-object before it looks for fields', () => {
    for (const v of [null, undefined, 'report', 42, []]) expect(mealInputRejection(v)).toBe('not_an_object');
  });

  it('stays short enough for the outcome column', () => {
    for (const v of [{}, { ...ok, detected: [] }, null, { ...ok, fat: -1 }]) {
      expect(String(mealInputRejection(v)).length).toBeLessThanOrEqual(30);
    }
  });
});

/* THE SALVAGE CONTRACT (2026-09-07). analyze-meal now runs repairMealReport on a report that
   fails the gate and adopts it only if the repaired version validates. One meal in seven was
   failing as `missing:protein` — a total omitted while every food still carried its own macros —
   and each rejection threw away a call we had paid for. These pin what may and may not be saved. */
describe('repair-then-validate salvages an arithmetic gap, never an empty read', () => {
  const foods = [
    { name: 'steak', protein: 40, kcal: 400, carbs: 0, fat: 26 },
    { name: 'potatoes', protein: 5, kcal: 200, carbs: 45, fat: 1 },
  ];

  it('rebuilds a missing TOTAL from the per-food macros the model did return', () => {
    const broken = { kcal: 600, carbs: 45, fat: 27, detected: foods } as Record<string, unknown>;
    expect(mealInputRejection(broken)).toBe('missing:protein');
    const fixed = repairMealReport(broken, 'Dinner').input;
    expect(validMealInput(fixed)).toBe(true);
    expect(Number(fixed.protein)).toBe(45); // 40 + 5, straight from the items
  });

  it('will not invent a read when there are no foods to sum', () => {
    const empty = { kcal: 600, carbs: 45, fat: 27, detected: [] } as Record<string, unknown>;
    expect(validMealInput(repairMealReport(empty, 'Dinner').input)).toBe(false);
  });

  it('will not rescue a report whose foods carry no macros either', () => {
    const nameOnly = { kcal: 600, carbs: 45, fat: 27, detected: [{ name: 'steak' }] } as Record<string, unknown>;
    expect(validMealInput(repairMealReport(nameOnly, 'Dinner').input)).toBe(false);
  });

  it('leaves a valid report valid — salvage is not a rewrite', () => {
    const good = { protein: 45, kcal: 600, carbs: 45, fat: 27, detected: foods } as Record<string, unknown>;
    expect(validMealInput(repairMealReport(good, 'Dinner').input)).toBe(true);
  });
});
