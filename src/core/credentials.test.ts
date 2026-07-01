import { checkPassword, credentialsOk, validateCredentials } from './credentials';

describe('checkPassword', () => {
  it('rejects short passwords', () => {
    expect(checkPassword('a1b2').ok).toBe(false);
  });
  it('requires a letter and a number', () => {
    expect(checkPassword('12345678').ok).toBe(false);
    expect(checkPassword('abcdefgh').ok).toBe(false);
    expect(checkPassword('abcd1234').ok).toBe(true);
  });
});

describe('validateCredentials', () => {
  it('flags a bad email', () => {
    expect(validateCredentials('nope', 'abcd1234').email).toBeTruthy();
  });
  it('passes a good email + password with no confirm', () => {
    expect(credentialsOk(validateCredentials('a@b.io', 'abcd1234'))).toBe(true);
  });
  it('flags a confirm mismatch only when confirm is provided', () => {
    expect(validateCredentials('a@b.io', 'abcd1234', 'abcd1234').confirm).toBeUndefined();
    expect(validateCredentials('a@b.io', 'abcd1234', 'nope').confirm).toBeTruthy();
    // confirm omitted -> never a confirm error (sign-in form)
    expect(validateCredentials('a@b.io', 'abcd1234').confirm).toBeUndefined();
  });
  it('credentialsOk is false whenever any field errors', () => {
    expect(credentialsOk(validateCredentials('bad', 'short'))).toBe(false);
  });
});
