// Proto is plain ESM JS (allowJs) — same import pattern as scoreParity.test.ts.
// @ts-ignore
import { dobFromParts, ageOn, passwordStrength, weakPasswordReason, standardForGoal, TOS_VERSION } from '../../proto/redesign-2026-07/js/ob-helpers.js';

describe('dobFromParts', () => {
  test('valid date, string inputs, zero-pads', () => expect(dobFromParts('7', '9', '2010')).toBe('2010-07-09'));
  test('rejects impossible calendar dates', () => expect(dobFromParts(2, 30, 2010)).toBeNull());
  test('rejects year below 1900', () => expect(dobFromParts(1, 1, 1899)).toBeNull());
  test('rejects non-numeric input', () => expect(dobFromParts('a', 'b', 'c')).toBeNull());
});

describe('ageOn — the 13th-birthday boundary', () => {
  test('turns 13 today → 13', () => expect(ageOn('2013-07-09', '2026-07-09')).toBe(13));
  test('turns 13 tomorrow → still 12', () => expect(ageOn('2013-07-10', '2026-07-09')).toBe(12));
  test('null dob → null', () => expect(ageOn(null, '2026-07-09')).toBeNull());
});

describe('passwordStrength', () => {
  test('11 chars fails the 12-char floor', () => expect(passwordStrength('abcdefghijk').ok).toBe(false));
  test('12 plain lowercase = ok, score 1 (Fair)', () =>
    expect(passwordStrength('abcdefghijkl')).toEqual({ ok: true, score: 1, label: 'Fair' }));
  test('12 chars with 2 character classes = score 2 (Good)', () =>
    expect(passwordStrength('abcdefghij12').score).toBe(2));
  test('12+ chars with full variety = score 3 (Strong)', () =>
    expect(passwordStrength('Abcdefgh1234!')).toEqual({ ok: true, score: 3, label: 'Strong' }));
  test('a long passphrase with a space = Strong (length rewards)', () =>
    expect(passwordStrength('correct horse staple').label).toBe('Strong'));
  test('empty = score 0', () => expect(passwordStrength('').score).toBe(0));
});

describe('weakPasswordReason', () => {
  test('a common password is rejected', () => expect(weakPasswordReason('password123', '')).toBeTruthy());
  test('the app name is rejected', () => expect(weakPasswordReason('onstandard-rules', '')).toBeTruthy());
  test('using the email as the password is rejected', () =>
    expect(weakPasswordReason('jordan@team.com', 'jordan@team.com')).toBeTruthy());
  test('an email local-part inside the password is rejected', () =>
    expect(weakPasswordReason('jordan-blake-9', 'jordan@team.com')).toBeTruthy());
  test('a strong unrelated passphrase passes', () =>
    expect(weakPasswordReason('mountain river lantern', 'jordan@team.com')).toBeNull());
});

describe('standardForGoal', () => {
  test('clamps meals to 2–4', () => {
    expect(standardForGoal('gain', 9).meals).toBe(4);
    expect(standardForGoal('gain', 1).meals).toBe(2);
    expect(standardForGoal('gain').meals).toBe(3);
  });
  test('meal count appears in the first row title', () =>
    expect(standardForGoal('gain', 4).rows[0][1]).toContain('Four meals'));
  test('every goal key has focus copy; unknown falls back', () => {
    for (const g of ['gain', 'lose', 'maintain', 'perform', 'performance', 'build', 'health', 'nonsense']) {
      expect(standardForGoal(g).focus.length).toBeGreaterThan(10);
    }
  });
  test('general profile relabels the weights (55/20/15/10)', () => {
    const rows = standardForGoal('lose', 3, 'general').rows;
    expect(rows[0][2]).toContain('55%');
    expect(rows[1][2]).toContain('20%');
  });
  test('athlete profile keeps 50/25/15/10', () => {
    const rows = standardForGoal('gain').rows;
    expect(rows[0][2]).toContain('50%');
    expect(rows[1][2]).toContain('25%');
  });
});

describe('TOS_VERSION', () => {
  test('is the spec date tag', () => expect(TOS_VERSION).toBe('2026-07-09'));
});
