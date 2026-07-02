// OnStandard — invite deep-link parsing.
import { parseInviteCode } from './inviteLink';

describe('parseInviteCode', () => {
  it('extracts and uppercases a code from a scheme URL', () => {
    expect(parseInviteCode('onstandard://join?code=eagles24')).toBe('EAGLES24');
  });

  it('extracts from an https universal link with extra params', () => {
    expect(parseInviteCode('https://onstandard.app/join?ref=sms&code=AB12CD')).toBe('AB12CD');
  });

  it('returns null when the URL carries no code', () => {
    expect(parseInviteCode('onstandard://join')).toBeNull();
    expect(parseInviteCode('https://onstandard.app/')).toBeNull();
  });

  it('ignores a non-code query and does not misfire', () => {
    expect(parseInviteCode('onstandard://open?screen=home')).toBeNull();
  });
});
