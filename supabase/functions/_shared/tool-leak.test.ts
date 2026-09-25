// The real leak (2026-09-25, founder's breakfast): the model closed the `analysis` field and opened
// the next one INSIDE the string, and meal-opener's `[<>]` strip turned it into words Nia said.
import { scrubToolLeak, leakedEnum } from './tool-leak.ts';
import { repairMealReport } from './meal-verify';
import { composeOpenerText } from './meal-opener.ts';

const RAW = 'Lunch is your next shot to close that gap, so lean toward a chicken or beef-forward plate then.</analysis>\n<parameter name="descriptionSignal">match';
const STRIPPED = 'Lunch is your next shot to close that gap, so lean toward a chicken or beef-forward plate then./analysis parameter name="descriptionSignal"match';
const CLEAN = 'Lunch is your next shot to close that gap, so lean toward a chicken or beef-forward plate then.';

describe('scrubToolLeak', () => {
  it('cuts the leaked field syntax, raw or with the brackets already stripped', () => {
    expect(scrubToolLeak(RAW)).toBe(CLEAN);
    expect(scrubToolLeak(STRIPPED)).toBe(CLEAN);
    expect(scrubToolLeak('Good plate.</parameter>\n<parameter name="note">x')).toBe('Good plate.');
    expect(scrubToolLeak('Solid. <invoke name="reply">')).toBe('Solid.');
  });

  it('leaves ordinary prose alone', () => {
    for (const s of ['Land around **65g of protein** at lunch.', 'Rice & beans, 1/2 cup.', 'Aim for 3/4 of the plate as protein/veg.', '']) {
      expect(scrubToolLeak(s)).toBe(s);
    }
  });

  it('recovers an enum the model wrote inside the leak', () => {
    expect(leakedEnum(RAW, 'descriptionSignal', ['match', 'photo_heavier', 'photo_lighter', 'no_photo'])).toBe('match');
    expect(leakedEnum(STRIPPED, 'descriptionSignal', ['match', 'photo_heavier'])).toBe('match');
    expect(leakedEnum('nothing here', 'descriptionSignal', ['match'])).toBeNull();
  });
});

describe('Nia\'s chat text is scrubbed wherever meal-chat reads it from the model', () => {
  it('every tool.input message/ack read goes through scrubToolLeak', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src: string = require('fs').readFileSync(require('path').join(__dirname, '..', 'meal-chat', 'index.ts'), 'utf8');
    const reads = src.match(/String\(r?tool\??\.input\?\.(?:message|ack) \?\? ''\)/g) || [];
    const scrubbed = src.match(/scrubToolLeak\(String\(r?tool\??\.input\?\.(?:message|ack) \?\? ''\)\)/g) || [];
    expect(reads.length).toBeGreaterThan(0);
    expect(scrubbed.length).toBe(reads.length);
  });
});

describe('the meal read never carries a leak into what Nia says', () => {
  it('repairMealReport cleans the prose fields and recovers descriptionSignal', () => {
    const rep = repairMealReport({
      name: 'Yogurt parfait', quality: 70, protein: 44, kcal: 600, carbs: 80, fat: 12, fiber: 6,
      detected: [{ name: 'Yogurt parfait', protein: 44, kcal: 600, carbs: 80, fat: 12 }],
      note: 'Carb-heavy breakfast.', analysis: RAW,
    });
    expect(rep.input.analysis).toBe(CLEAN);
    expect(rep.input.descriptionSignal).toBe('match');
    expect(rep.repaired).toContain('tool_leak:analysis');
  });

  it('the opener cleans a leaked read an older client hands back', () => {
    const out = composeOpenerText({ name: 'Parfait', quality: 70, protein: 44, kcal: 600, analysis: RAW } as never);
    expect(out).toContain('beef-forward plate then.');
    expect(out).not.toMatch(/parameter|descriptionSignal|\/analysis/);
  });
});
