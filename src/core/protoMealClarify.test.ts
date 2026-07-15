/**
 * HONEST VISION — The Clarifying Moment
 * (docs/superpowers/specs/2026-07-15-honest-vision-clarifying-moment-design.md).
 *
 * buildClarifications zips the model's clarifying questions with the athlete's typed answers
 * into the exact shape the analyze-meal edge function's 'finalize' phase accepts. The honest
 * contract: an unanswered question is DROPPED (so the model estimates that part rather than
 * being handed a blank), lengths are capped and newlines collapsed (a pasted answer can't
 * inflate the finalize call), and order is preserved.
 *
 * meal-intel.js is pure + Node-importable (same pattern as protoStreakGrace/scoreParity).
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const { buildClarifications } = require('../../proto/redesign-2026-07/js/meal-intel.js');

describe('buildClarifications', () => {
  it('pairs each answered question with its answer, in order', () => {
    const out = buildClarifications(
      ['Anything under the pancakes?', 'One palm of chicken or two?'],
      ['Two sausage links', 'Two palms'],
    );
    expect(out).toEqual([
      { question: 'Anything under the pancakes?', answer: 'Two sausage links' },
      { question: 'One palm of chicken or two?', answer: 'Two palms' },
    ]);
  });

  it('drops a question the athlete left blank (or whitespace only)', () => {
    const out = buildClarifications(
      ['Hidden protein?', 'Grilled or fried?', 'Any sauce?'],
      ['Eggs underneath', '   ', 'Ranch'],
    );
    expect(out).toEqual([
      { question: 'Hidden protein?', answer: 'Eggs underneath' },
      { question: 'Any sauce?', answer: 'Ranch' },
    ]);
  });

  it('returns [] when nothing is answered (the Skip path)', () => {
    expect(buildClarifications(['Q1', 'Q2'], [])).toEqual([]);
    expect(buildClarifications(['Q1', 'Q2'], ['', '  '])).toEqual([]);
  });

  it('tolerates fewer answers than questions', () => {
    expect(buildClarifications(['Q1', 'Q2', 'Q3'], ['only first'])).toEqual([
      { question: 'Q1', answer: 'only first' },
    ]);
  });

  it('collapses newlines and caps question/answer length', () => {
    const longQ = 'q'.repeat(400);
    const longA = 'a'.repeat(700);
    const [c] = buildClarifications([longQ], [`line1\nline2\r\nline3 ${longA}`]);
    expect(c.question.length).toBe(300);
    expect(c.answer.includes('\n')).toBe(false);
    expect(c.answer.length).toBe(500);
  });

  it('is defensive against non-array / null input', () => {
    expect(buildClarifications(null, null)).toEqual([]);
    expect(buildClarifications(undefined, ['a'])).toEqual([]);
    expect(buildClarifications(['Q1'], null)).toEqual([]);
  });
});
