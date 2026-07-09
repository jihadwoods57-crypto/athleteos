// Proves sign-out ALWAYS confirms before erasing, wires the erase to the destructive button only,
// and tells the truth about local-only data. Guards the Profile-button regression (a bare
// onPress={signOut} that skipped the dialog and erased unsynced data on one tap).
import { confirmSignOut, isLocalOnly, signOutMessage, type ConfirmButton } from './confirmSignOut';

jest.mock('@/ui/haptics', () => ({ haptics: { tap: jest.fn() } }));

describe('confirmSignOut', () => {
  it('never signs out immediately — the erase is behind the destructive button', () => {
    const signOut = jest.fn();
    let buttons: ConfirmButton[] = [];
    confirmSignOut({ userId: 'u1', realDataConsent: true, signOut }, (_t, _m, b) => (buttons = b));
    expect(signOut).not.toHaveBeenCalled();
    const destructive = buttons.find((b) => b.style === 'destructive');
    const cancel = buttons.find((b) => b.style === 'cancel');
    expect(destructive).toBeDefined();
    expect(cancel).toBeDefined();
    destructive!.onPress!();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('warns that local-only history is gone for an unsynced / no-consent user', () => {
    expect(isLocalOnly({ userId: null, realDataConsent: false, signOut: jest.fn() })).toBe(true);
    expect(isLocalOnly({ userId: 'u1', realDataConsent: false, signOut: jest.fn() })).toBe(true);
    expect(isLocalOnly({ userId: 'u1', realDataConsent: true, signOut: jest.fn() })).toBe(false);
    expect(signOutMessage(true)).toMatch(/not backed up|will be gone/i);
    expect(signOutMessage(false)).toMatch(/stays safe/i);
  });
});
