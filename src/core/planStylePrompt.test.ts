/**
 * The Intuitive language rail (supabase/functions/_shared/plan-style.ts).
 *
 * This guard is the last thing standing between a model slip and a calorie figure landing in
 * front of someone who is deliberately not tracking them — so it is tested from both directions:
 * every harmful form must be CAUGHT, and every innocent form must NOT be, because a false
 * positive costs a paid retry and can end in canned copy, losing real feedback to catch a phrase
 * that was never harmful.
 *
 * Imported directly from the edge-function shared module (plain TS, no Deno APIs in this file).
 */
import {
  asPlanStyle, styleShowsNumbers, buildStyleDirective, composeSystem,
  violatesStyleLanguage, styleCorrectionMessage, SAFE_INTUITIVE, PLAN_STYLES,
// No .ts extension: Deno requires it in the edge function's own imports, but tsc rejects it here
// unless allowImportingTsExtensions is on. Same file, both resolvers happy.
} from '../../supabase/functions/_shared/plan-style';

describe('style resolution helpers', () => {
  test('asPlanStyle accepts the three styles and rejects everything else', () => {
    for (const s of PLAN_STYLES) expect(asPlanStyle(s)).toBe(s);
    expect(asPlanStyle('INTUITIVE')).toBe('intuitive');
    expect(asPlanStyle(' guided ')).toBe('guided');
    for (const bad of [null, undefined, '', 'keto', 42, {}]) expect(asPlanStyle(bad)).toBeNull();
  });

  test('only Intuitive hides numbers', () => {
    expect(styleShowsNumbers('structured')).toBe(true);
    expect(styleShowsNumbers('guided')).toBe(true);
    expect(styleShowsNumbers('intuitive')).toBe(false);
    expect(styleShowsNumbers(null)).toBe(true); // no style resolved => today's behaviour
  });
});

describe('directive composition', () => {
  test('no style produces no directive — today\'s prompt, byte for byte', () => {
    expect(buildStyleDirective(null)).toBe('');
    expect(composeSystem('BASE', '', null)).toBe('BASE');
  });

  test('voice comes first, style second, base last', () => {
    const out = composeSystem('BASE', 'VOICE', 'intuitive');
    expect(out.indexOf('VOICE')).toBeLessThan(out.indexOf('PLAN STYLE'));
    expect(out.indexOf('PLAN STYLE')).toBeLessThan(out.indexOf('BASE'));
  });

  test('either shaping layer can be absent without leaving blank padding', () => {
    expect(composeSystem('BASE', 'VOICE', null)).toBe('VOICE\n\nBASE');
    expect(composeSystem('BASE', '', 'guided')).toBe(`${buildStyleDirective('guided')}\n\nBASE`);
  });

  test('the Intuitive directive states the ban in absolute terms', () => {
    const d = buildStyleDirective('intuitive').toLowerCase();
    expect(d).toContain('never state a calorie or macro figure');
    expect(d).toContain('never moralize food');
    // It must also tell the model what IS allowed, or it produces uselessly vague prose.
    expect(d).toContain('kitchen quantities');
  });
});

describe('the guard only applies to Intuitive', () => {
  const loaded = 'This plate delivers 45g of protein and 800 calories. Solid cheat meal.';
  test.each(['structured', 'guided', null] as const)('%s is never language-checked', (style) => {
    expect(violatesStyleLanguage(loaded, style as any)).toBeNull();
  });
  test('Intuitive catches it', () => {
    expect(violatesStyleLanguage(loaded, 'intuitive')).not.toBeNull();
  });
});

describe('macro figures are caught in every form a model actually emits', () => {
  const CAUGHT = [
    'That plate gave you about 45g of protein.',
    'Roughly 45 g of protein there.',
    'You landed around 2,400 calories today.',
    'That is 800 kcal on the plate.',
    'About 300 cal in that bowl.',
    'Call it 30 grams of protein.',
    'It came to thirty grams of protein.',
    'Around two hundred calories.',
    'protein: 45 on this one',
    'Fat = 22 here.',
    'You got 45 of protein from the chicken.',
  ];
  test.each(CAUGHT)('caught: %s', (text) => {
    const v = violatesStyleLanguage(text, 'intuitive');
    expect(v).not.toBeNull();
    expect(v!.kind).toBe('figure');
  });
});

describe('ordinary food and life language is NOT a violation', () => {
  // Every one of these is language an Intuitive read SHOULD be free to use. A false positive
  // here burns a paid retry and can degrade real feedback into canned copy.
  const CLEAN = [
    'Chicken, rice and something green — that is a plate that tends to hold people.',
    'About a cup of rice and two eggs.',
    'You had 6 oz of chicken there.',
    'That is 3 meals logged today.',
    'You got 8 hours of sleep, which usually shows up in how the afternoon goes.',
    'You are at 100 oz of water — hydration is on track.',
    'Two protein sources on that plate.',
    'Half a cup of oats with fruit.',
    'Your consistency this week has been good.',
    'No shame in a late log — it still counts.',
    'Worth noticing how full this one left you a couple of hours later.',
    'Energy held steady on the days you ate breakfast.',
    'That is 4 days in a row.',
  ];
  test.each(CLEAN)('clean: %s', (text) => {
    expect(violatesStyleLanguage(text, 'intuitive')).toBeNull();
  });
});

describe('food moralizing is caught', () => {
  const CAUGHT = [
    'That was a cheat meal, so make it up tomorrow.',
    'Try to avoid junk food this weekend.',
    'No need to feel guilty about it.',
    'You earned it after that session.',
    'You can burn it off at practice.',
    'Time to get back on track.',
    'That was a good choice at dinner.',
    'Bad foods are what set you back.',
    'Clean eating is the goal here.',
    'Go ahead and treat yourself.',
    'A bit indulgent, but fine.',
    'A weekend splurge.',
  ];
  test.each(CAUGHT)('caught: %s', (text) => {
    const v = violatesStyleLanguage(text, 'intuitive');
    expect(v).not.toBeNull();
    expect(v!.kind).toBe('moralizing');
  });

  test('punctuation and hyphenation cannot smuggle a term through', () => {
    expect(violatesStyleLanguage('That was a cheat-day.', 'intuitive')).not.toBeNull();
    expect(violatesStyleLanguage('Total junk food!', 'intuitive')).not.toBeNull();
    expect(violatesStyleLanguage('guilt-free, promise', 'intuitive')).not.toBeNull();
  });

  test('a term at the very start or end of the text still matches', () => {
    expect(violatesStyleLanguage('cheat', 'intuitive')).not.toBeNull();
    expect(violatesStyleLanguage('that was junk', 'intuitive')).not.toBeNull();
  });

  test('empty and whitespace text is never a violation', () => {
    for (const t of ['', '   ', '\n']) expect(violatesStyleLanguage(t, 'intuitive')).toBeNull();
    expect(violatesStyleLanguage(undefined as any, 'intuitive')).toBeNull();
  });
});

describe('the correction turn names the specific hit', () => {
  test('a figure violation quotes the figure and says why', () => {
    const v = violatesStyleLanguage('about 45g of protein', 'intuitive')!;
    const msg = styleCorrectionMessage(v);
    expect(msg).toContain('45g');
    expect(msg.toLowerCase()).toContain('calorie or macro figure');
    // The retry must not narrate the correction back to the athlete.
    expect(msg.toLowerCase()).toContain('do not mention the rule');
  });

  test('a moralizing violation quotes the phrase', () => {
    const v = violatesStyleLanguage('that was a cheat meal', 'intuitive')!;
    expect(styleCorrectionMessage(v)).toContain('cheat meal');
  });
});

describe('the deterministic fallback copy is itself style-safe', () => {
  // Escalation step 3 ships this text verbatim to an Intuitive athlete — if it tripped the guard
  // the whole ladder would be circular.
  test.each(Object.entries(SAFE_INTUITIVE))('SAFE_INTUITIVE.%s passes its own guard', (_k, text) => {
    expect(violatesStyleLanguage(text as string, 'intuitive')).toBeNull();
  });

  test('it claims nothing specific about a plate it has not seen', () => {
    // Safe copy is only safe because it is non-specific; a fabricated detail would be worse
    // than the violation it replaces.
    expect(SAFE_INTUITIVE.note).not.toMatch(/chicken|rice|salad|protein/i);
    expect(SAFE_INTUITIVE.analysis).not.toMatch(/chicken|rice|salad/i);
  });
});
