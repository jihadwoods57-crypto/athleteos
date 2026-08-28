// The opener is the first thing the athlete reads after logging a plate — a real message in the
// thread. The bar (founder 2026-08-04): it must sound like a nutrition coach texting an athlete
// they know, and it must NEVER repeat what the screen already shows — the photo, the score, the
// macros, the foods. Takeaway first, one or two concrete moves, day framed forward, real history.
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
  highlights: ['Front-load a plate like this after your hardest sessions.'],
  ...over,
});

describe('it coaches instead of narrating the screen', () => {
  const out = composeOpenerText(read(), {
    planStyle: 'structured', late: false, mealName: 'Dinner',
    day: { proteinIncludingThisMeal: 81, proteinTarget: 180, mealsRemaining: 2 },
  });

  it('leads with the takeaway — the model\'s own read comes first', () => {
    expect(out.startsWith('Real protein with vegetables')).toBe(true);
  });

  it('NEVER restates the meal\'s own macros — the breakdown card owns those numbers', () => {
    expect(out).not.toContain("I'd put it around");
    expect(out).not.toContain('81g of protein');
    expect(out).not.toContain('985');
  });

  it('does not list the foods back — the athlete can see the photo', () => {
    expect(out).not.toContain('I can see');
    expect(out.toLowerCase()).not.toContain('ribeye steak, sweet potato fries and green beans');
  });

  it('carries a concrete recommendation in the model\'s own words', () => {
    expect(out).toContain('Front-load a plate like this');
  });

  it('frames the day FORWARD as the next decision — per-meal math, not a progress restatement', () => {
    // gap 99 across 2 meals → "around 50g each": the decision, pre-computed, rounded like a
    // coach rounds ("around 50", never "49.5").
    expect(out).toContain('Land around 50g of protein at each of your last 2 meals');
    expect(out).toContain('without forcing the last one');
    expect(out).not.toContain('That puts you near');
    expect(out).not.toContain('still to go');
  });

  it('does not praise timing — on-time lives in the score chips now', () => {
    expect(out).not.toContain('Good timing');
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

describe('the forward day framing covers every arithmetic case', () => {
  const at = (day: Record<string, unknown>) =>
    composeOpenerText(read(), { planStyle: 'structured', late: false, mealName: 'Dinner', day });

  it('a closed target is celebrated, not recomputed', () => {
    const out = at({ proteinIncludingThisMeal: 185, proteinTarget: 180, mealsRemaining: 1 });
    expect(out).toContain('closes out your protein for the day');
    expect(out).not.toContain('still to go');
  });

  it('one meal left names the exact number to bring in', () => {
    expect(at({ proteinIncludingThisMeal: 120, proteinTarget: 180, mealsRemaining: 1 }))
      .toContain('One meal left. Bring it in around 60g of protein');
  });

  it('a short day with no meals left points at a snack', () => {
    expect(at({ proteinIncludingThisMeal: 120, proteinTarget: 180, mealsRemaining: 0 }))
      .toContain('protein-forward snack');
  });

  it('says nothing about the day when the engine gave it no numbers', () => {
    const out = composeOpenerText(read(), { late: false, mealName: 'Dinner', day: null });
    expect(out).not.toContain('Land around');
    expect(out).not.toContain('closes out');
  });

  /* NO EM DASHES, on every branch (critique 2026-08-28). The ban is documented, every
     model-written path strips the character, and this composer still carried four hardcoded ones
     for weeks in the single most-read AI message the product writes. Asserting the copy of one
     branch is not enough — the test that was here asserted the em dash. So: sweep every
     arithmetic case, plus late, plus the low-confidence hedge, and check the character itself. */
  it('never emits an em dash on any branch', () => {
    const days = [
      { proteinIncludingThisMeal: 185, proteinTarget: 180, mealsRemaining: 1 },
      { proteinIncludingThisMeal: 120, proteinTarget: 180, mealsRemaining: 1 },
      { proteinIncludingThisMeal: 120, proteinTarget: 180, mealsRemaining: 0 },
      { proteinIncludingThisMeal: 90, proteinTarget: 180, mealsRemaining: 3 },
      null,
    ];
    for (const day of days) {
      for (const late of [true, false, null]) {
        const out = composeOpenerText(read(), { planStyle: 'structured', late, mealName: 'Dinner', day });
        expect(out).not.toContain('—');
      }
    }
  });
});

describe('real history is woven in — the thread remembers', () => {
  it('includes exactly ONE pattern line, sanitized — the message stays four sentences of coach', () => {
    const out = composeOpenerText(read(), {
      planStyle: 'structured', late: false, mealName: 'Dinner',
      patterns: [
        "You've hit your protein bar in 3 of your last 4 dinners.",
        'A second pattern that must not appear.',
      ],
    });
    expect(out).toContain('3 of your last 4 dinners');
    expect(out).not.toContain('second pattern');
  });

  it('a numeric pattern is dropped for an Intuitive athlete without killing the message', () => {
    const out = composeOpenerText(read({ analysis: 'A plate that tends to hold people through a hard week.' }), {
      planStyle: 'intuitive', late: false, mealName: 'Dinner',
      patterns: ['You averaged 42g of protein at dinner this week.'],
    });
    expect(out).toContain('hold people');
    expect(out).not.toContain('42g');
  });
});

describe('timing speaks only when late', () => {
  it('holds the standard on a late log — and credits the log', () => {
    const out = composeOpenerText(read(), { late: true, mealName: 'Dinner' });
    expect(out).toContain('late still counts');
  });

  it('says nothing about timing when on time or unknown', () => {
    for (const late of [false, null]) {
      const out = composeOpenerText(read(), { late, mealName: 'Dinner' });
      expect(out).not.toContain('Good timing');
      expect(out).not.toContain('Late on');
    }
  });
});

describe('uncertainty is stated when it is real, and only then', () => {
  it('flags a guess the model was unsure about — voiced as an expert inviting a detail, never an apology (founder 2026-08-11)', () => {
    const out = composeOpenerText(read({ detected: [{ name: 'some kind of stew', confidence: 'low' }] }), {});
    expect(out).toContain("tell me and I'll tighten the numbers");
    expect(out).not.toContain('guess from the photo');
  });

  it('does not hedge a confident read — a hedge on every meal is noise', () => {
    expect(composeOpenerText(read(), {})).not.toContain("tighten the numbers");
  });
});

describe('Intuitive plans never see a number', () => {
  const out = composeOpenerText(read({ analysis: 'A plate that sets up a strong afternoon.' }), {
    planStyle: 'intuitive', late: false, mealName: 'Dinner',
    day: { proteinIncludingThisMeal: 81, proteinTarget: 180, mealsRemaining: 2 },
  });

  it('suppresses the day math entirely', () => {
    expect(out).not.toContain('180');
    expect(out).not.toContain('99');
    expect(out).not.toMatch(/\d+\s*(?:g|grams?|kcal|calories)/i);
  });
});

describe('it refuses rather than posting something empty or unsafe', () => {
  it('returns nothing when there is nothing to say', () => {
    expect(composeOpenerText({}, {})).toBe('');
    expect(composeOpenerText({ detected: [] }, { late: null })).toBe('');
  });

  it('returns nothing when the assembled text would breach the plan-style rail', () => {
    const out = composeOpenerText(
      read({ analysis: 'That is roughly 45g of protein on the plate.', detected: [], highlights: [] }),
      { planStyle: 'intuitive', late: null },
    );
    expect(out).toBe('');

    expect(composeOpenerText(
      read({ analysis: 'A cheat day like this one is nothing to feel guilty about.', detected: [], highlights: [] }),
      { planStyle: 'intuitive', late: null },
    )).toBe('');
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
