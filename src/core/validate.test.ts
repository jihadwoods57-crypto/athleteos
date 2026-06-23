import { accountStepValid, isValidEmail, isValidName } from './validate';

describe('isValidName', () => {
  it('accepts a name with at least two non-space characters', () => {
    expect(isValidName('Jihad Carter')).toBe(true);
    expect(isValidName('Jo')).toBe(true);
    expect(isValidName('  Al  ')).toBe(true); // trims, still >= 2
  });

  it('rejects empty / whitespace-only / single-character names', () => {
    expect(isValidName('')).toBe(false);
    expect(isValidName('   ')).toBe(false);
    expect(isValidName('J')).toBe(false);
    expect(isValidName(' a ')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('accepts a well-formed address (trimming surrounding space)', () => {
    expect(isValidEmail('you@email.com')).toBe(true);
    expect(isValidEmail('jihad.carter@eastside.k12.us')).toBe(true);
    expect(isValidEmail('  coach@team.io  ')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('plainaddress')).toBe(false);
    expect(isValidEmail('no@dot')).toBe(false);
    expect(isValidEmail('@nolocal.com')).toBe(false);
    expect(isValidEmail('two @spaces.com')).toBe(false);
    expect(isValidEmail('a@b@c.com')).toBe(false);
  });
});

describe('accountStepValid', () => {
  it('is true only when both name and email validate', () => {
    expect(accountStepValid('Jihad Carter', 'you@email.com')).toBe(true);
    expect(accountStepValid('J', 'you@email.com')).toBe(false);
    expect(accountStepValid('Jihad Carter', 'bad-email')).toBe(false);
    expect(accountStepValid('', '')).toBe(false);
  });
});
