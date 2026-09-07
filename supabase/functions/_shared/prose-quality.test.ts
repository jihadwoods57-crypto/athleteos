// These gauges exist because a banned-PHRASE list could not catch a banned SHAPE: the model kept
// the template and swapped the words. Every positive case below is real prose the live model
// produced on 2026-09-07, not an invented example.
import { scoreProse, openerVariety } from './prose-quality';

const REAL = {
  template: 'This plate holds its own for general development, steak gives you a legit protein base and the potatoes cover the fuel side well. If you are still hungry later, a cup of Greek yogurt would push protein higher.',
  templateBowl: 'This bowl leans carb-heavy for what looks like a training day. Next time, ask for double steak.',
  good: 'Bacon and sausage are carrying almost all of this, and the grits are along for the ride. Drink a glass of milk with it before you head out and you close most of the gap right now.',
};

describe('scoreProse — the opener template', () => {
  it('catches the demonstrative-plus-noun shape the model actually used', () => {
    expect(scoreProse(REAL.template).openerTemplate).toBe(true);
    expect(scoreProse(REAL.templateBowl).openerTemplate).toBe(true);
    expect(scoreProse('This is a strong dinner rebuild after training.').openerTemplate).toBe(true);
    expect(scoreProse('That plate is short on protein.').openerTemplate).toBe(true);
  });

  it('passes a read that opens on the food, the consequence or the athlete', () => {
    expect(scoreProse(REAL.good).openerTemplate).toBe(false);
    expect(scoreProse('You will be hungry by third period.').openerTemplate).toBe(false);
    expect(scoreProse('Two eggs short of what this morning needed.').openerTemplate).toBe(false);
    expect(scoreProse('Four meatballs plus rice gives you a real base.').openerTemplate).toBe(false);
  });
});

describe('scoreProse — the verdict must commit', () => {
  it('flags the hedges the model reached for once "solid" was banned', () => {
    for (const h of ['holds its own', 'sets you up well', 'is well-rounded', 'is balanced', 'works well', 'does the job']) {
      expect(scoreProse(`Dinner ${h} tonight. Add a side.`).hedgedVerdict).toBe(true);
    }
  });

  it('does not flag a verdict that could be wrong', () => {
    expect(scoreProse(REAL.good).hedgedVerdict).toBe(false);
    expect(scoreProse('Protein is too low here for a lift day.').hedgedVerdict).toBe(false);
  });

  it('only judges the FIRST sentence — a hedge later is not the verdict', () => {
    expect(scoreProse('Protein is too low here. The rest is balanced.').hedgedVerdict).toBe(false);
  });
});

describe('scoreProse — never echo the goal back', () => {
  it('catches the stock generic-goal phrasings', () => {
    expect(scoreProse('Good plate for general development.').goalParrot).toBe(true);
    expect(scoreProse('Works for general athletic development.').goalParrot).toBe(true);
    expect(scoreProse('Fine for general training today.').goalParrot).toBe(true);
  });

  it('catches the athlete\'s own goal string repeated at them', () => {
    expect(scoreProse('Great for lean muscle gain today.', { goal: 'lean muscle gain' }).goalParrot).toBe(true);
  });

  it('does not flag ordinary vocabulary that happens to overlap a short goal', () => {
    // A one-word goal is normal English; flagging it would make the metric useless.
    expect(scoreProse('Good protein here.', { goal: 'protein' }).goalParrot).toBe(false);
    expect(scoreProse(REAL.good, { goal: 'general athletic development' }).goalParrot).toBe(false);
  });
});

describe('scoreProse — homework vs coaching', () => {
  it('flags a read whose every action lives in a future meal', () => {
    expect(scoreProse('Protein is light. Next time ask for double steak.').futureOnly).toBe(true);
    expect(scoreProse('Short on protein. Tomorrow, build it around eggs.').futureOnly).toBe(true);
  });

  it('does not flag a read that gives them something to do now', () => {
    expect(scoreProse(REAL.good).futureOnly).toBe(false);
    // "next time" alongside a present action is fine — the athlete still got something to do.
    expect(scoreProse('Light on protein. Drink a glass of milk with it, and next time order double.').futureOnly).toBe(false);
  });
});

describe('scoreProse — nothing to score', () => {
  it('an empty or non-string read flags nothing', () => {
    for (const v of ['', null, undefined, 42, {}]) {
      expect(scoreProse(v)).toEqual({ openerTemplate: false, hedgedVerdict: false, goalParrot: false, futureOnly: false });
    }
  });
});

describe('openerVariety', () => {
  it('reports 1.0 when every read opens differently', () => {
    expect(openerVariety(['Bacon carries this one.', 'You will be hungry later.', 'Two eggs short today.'])).toBe(1);
  });

  it('drops as reads start sounding like each other', () => {
    expect(openerVariety(['This plate holds its own.', 'This plate holds up fine.', 'This plate holds steady.'])).toBeCloseTo(1 / 3);
  });

  it('ignores empty reads rather than counting them as variety', () => {
    expect(openerVariety(['Bacon carries this one.', '', null])).toBe(1);
  });
});
