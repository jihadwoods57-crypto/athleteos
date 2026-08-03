// The opener is the first thing the athlete reads after logging a plate, and now it is a real
// message in a thread rather than a report card the client redrew each paint. So the bar is: does
// it sound like a person on their staff, and can it ever say something it should not?
import { composeOpenerText } from './meal-opener';

const read = (over: Record<string, unknown> = {}) => ({
  name: 'Steak, sweet potato fries, green beans',
  quality: 84, protein: 81, kcal: 985, carbs: 75, fat: 37, fiber: 10,
  detected: [
    { name: 'Ribeye steak', confidence: 'high' },
    { name: 'Sweet potato fries', confidence: 'high' },
    { name: 'Green beans', confidence: 'high' },
  ],
  note: 'Solid dinner.',
  analysis: 'Real protein with vegetables and a starch is what a training day should look like.',
  ...over,
});

describe('it reads like a person, not a form', () => {
  const out = composeOpenerText(read(), {
    planStyle: 'structured', late: false, mealName: 'Dinner',
    day: { proteinIncludingThisMeal: 81, proteinTarget: 180, mealsRemaining: 2 },
  });

  it('names what it can see, in plain words', () => {
    expect(out).toContain('ribeye steak, sweet potato fries and green beans');
  });

  it('gives the numbers as an estimate, not a measurement', () => {
    expect(out).toContain("I'd put it around 81g of protein and 985 calories");
  });

  it('connects the plate to the day', () => {
    expect(out).toContain('81 of 180g for the day with 2 required meals left');
  });

  it('carries the analysis through in the model\'s own words', () => {
    expect(out).toContain('Real protein with vegetables');
  });

  it('has no section headers, labels or bullets anywhere in it', () => {
    for (const banned of ['WHAT WENT WELL', 'NEXT TIME', 'Biggest opportunity', '•', '- ', '\n']) {
      expect(out).not.toContain(banned);
    }
  });

  it('fits the column the database actually has', () => {
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThanOrEqual(1000);
  });
});

describe('timing is stated first, because it is the part the athlete controls', () => {
  it('says so when the meal was on time', () => {
    expect(composeOpenerText(read(), { late: false, mealName: 'Dinner' })).toMatch(/^Good timing on dinner\./);
  });

  it('says so when it was late — and that logging it late still counted', () => {
    const out = composeOpenerText(read(), { late: true, mealName: 'Dinner' });
    expect(out).toMatch(/^Late on dinner/);
    expect(out).toContain('still counts');
  });

  it('says nothing about timing when the deadline is unknown', () => {
    const out = composeOpenerText(read(), { late: null });
    expect(out).not.toContain('Good timing');
    expect(out).not.toContain('Late on');
  });
});

describe('uncertainty is stated when it is real, and only then', () => {
  it('flags a guess the model was unsure about', () => {
    const out = composeOpenerText(read({ detected: [{ name: 'some kind of stew', confidence: 'low' }] }), {});
    expect(out).toContain('guess from the photo');
  });

  it('does not hedge a confident read — a hedge on every meal is noise', () => {
    expect(composeOpenerText(read(), {})).not.toContain('guess from the photo');
  });
});

describe('Intuitive plans never see a number', () => {
  const out = composeOpenerText(read(), {
    planStyle: 'intuitive', late: false, mealName: 'Dinner',
    day: { proteinIncludingThisMeal: 81, proteinTarget: 180, mealsRemaining: 2 },
  });

  it('suppresses the macro sentence and the day math', () => {
    // The rule is that no calorie or macro FIGURE reaches this athlete. Ordinary food language
    // is fine and is the point of the style - what is banned is the number.
    expect(out).not.toContain('81');
    expect(out).not.toContain('985');
    expect(out).not.toContain('180');
    expect(out).not.toMatch(/\d+\s*(?:g|grams?|kcal|calories)/i);
  });

  it('still says what was on the plate — the composition IS the feedback', () => {
    expect(out).toContain('ribeye steak');
  });
});

describe('it refuses rather than posting something empty or unsafe', () => {
  it('returns nothing when there is nothing to say', () => {
    expect(composeOpenerText({}, {})).toBe('');
    expect(composeOpenerText({ detected: [] }, { late: null })).toBe('');
  });

  it('returns nothing when the assembled text would breach the plan-style rail', () => {
    // The style rail is the last gate: even prose assembled from an already-railed model
    // response must pass before it is persisted. Better a missing bubble than a banned word.
    const out = composeOpenerText(
      read({ analysis: 'That is roughly 45g of protein on the plate.', detected: [] }),
      { planStyle: 'intuitive', late: null },
    );
    expect(out).toBe('');

    // ...and a moralizing framing is refused the same way.
    expect(composeOpenerText(
      read({ analysis: 'A cheat day like this one is nothing to feel guilty about.', detected: [] }),
      { planStyle: 'intuitive', late: null },
    )).toBe('');
  });

  it('drops the macro line when the read has no macros', () => {
    const out = composeOpenerText(read({ protein: 0, kcal: 0 }), { late: false, mealName: 'Dinner' });
    expect(out).not.toContain("I'd put it around");
  });
});

/* Regression, founder report 2026-08-02. The athlete logged a ~29g breakfast and the AI told them
   they were "near 0 of 155g for the day" — because the caller handed this composer the PRE-meal day
   total (the engine sums only SCORED slots, and this plate was still being read when the analysis
   request was built). The contract is now unambiguous in the name: `proteinIncludingThisMeal`, read
   AFTER the meal lands. See OpenerContext. */
describe('the day sentence counts the plate the athlete just logged', () => {
  it('states the total INCLUDING this meal, never the total before it', () => {
    const out = composeOpenerText(read({ protein: 29, kcal: 660 }), {
      planStyle: 'structured', late: false, mealName: 'Breakfast',
      day: { proteinIncludingThisMeal: 29, proteinTarget: 155, mealsRemaining: 2 },
    });
    expect(out).toContain('That puts you near 29 of 155g for the day');
    expect(out).not.toContain('near 0 of 155g');
  });

  it('names the denominator, so it cannot read as contradicting the day-requirements counter', () => {
    // The log card's "1 of 4 in today" counts every required day item (weigh-in, check-in), not
    // meals. Saying "2 meals left" beside it read as a contradiction; "2 required meals left" does
    // not, and is the number this field actually carries.
    const day = { proteinIncludingThisMeal: 29, proteinTarget: 155 };
    const at = (mealsRemaining: number) =>
      composeOpenerText(read(), { late: false, mealName: 'Breakfast', day: { ...day, mealsRemaining } });
    expect(at(2)).toContain('with 2 required meals left');
    expect(at(1)).toContain('with one required meal left');
    expect(at(0)).toContain('with your required meals in');
  });

  it('says nothing about the day when the engine gave it no numbers', () => {
    const out = composeOpenerText(read(), { late: false, mealName: 'Breakfast', day: null });
    expect(out).not.toContain('That puts you');
  });
});

describe('long reads are trimmed like prose, not like a buffer', () => {
  it('ends on a sentence, never mid-word', () => {
    const long = 'This plate does a lot of things right and here is the reason why. '.repeat(30);
    const out = composeOpenerText(read({ analysis: long }), { late: false, mealName: 'Dinner' });
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out).toMatch(/[.!?…]$/);
  });
});
