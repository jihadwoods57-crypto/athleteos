import {
  composeMessage,
  appendMessage,
  messageDeliveryNote,
  messagingAllowed,
  messagingGateNote,
  MAX_MESSAGE_LEN,
  MESSAGING_ADULT_AGE,
} from './messaging';
import type { ChatMsg } from './types';

describe('composeMessage', () => {
  it('trims and returns a real body', () => {
    expect(composeMessage('  hey there  ')).toBe('hey there');
  });
  it('returns null for empty / whitespace-only drafts', () => {
    expect(composeMessage('')).toBeNull();
    expect(composeMessage('   \n  ')).toBeNull();
    expect(composeMessage(undefined as unknown as string)).toBeNull();
  });
  it('caps an over-long paste at MAX_MESSAGE_LEN', () => {
    const long = 'a'.repeat(MAX_MESSAGE_LEN + 50);
    expect(composeMessage(long)!.length).toBe(MAX_MESSAGE_LEN);
  });
});

describe('appendMessage', () => {
  const base: ChatMsg[] = [{ who: 'them', text: 'hi' }];
  it('appends a composed message from the given author', () => {
    const next = appendMessage(base, 'me', '  on it  ');
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ who: 'me', text: 'on it' });
  });
  it('ignores an empty draft and does not mutate the thread', () => {
    const next = appendMessage(base, 'me', '   ');
    expect(next).toBe(base); // same reference, unchanged
  });
  it('does not mutate the input thread when appending', () => {
    appendMessage(base, 'me', 'new');
    expect(base).toHaveLength(1);
  });
});

describe('messageDeliveryNote', () => {
  it('is honest that an off-backend message is local-only', () => {
    const note = messageDeliveryNote(false);
    expect(note.toLowerCase()).toContain('this device');
    expect(note).not.toContain('—');
  });
  it('never claims delivery while no delivery path exists (live is local-only too)', () => {
    // deliverMessage is an unwired stub: nothing is ever sent to a real person on
    // either flag state. The composer note must not tell a live coach "Delivered"
    // while their intervention silently goes nowhere.
    const note = messageDeliveryNote(true);
    expect(note.toLowerCase()).not.toContain('delivered');
    expect(note.toLowerCase()).toContain('this device');
    expect(note).not.toContain('—');
  });
});

describe('messagingAllowed (beta minor-messaging governance)', () => {
  it('allows an adult athlete to message anyone', () => {
    expect(messagingAllowed({ athleteAge: MESSAGING_ADULT_AGE, counterpartAuthorized: false })).toBe(true);
    expect(messagingAllowed({ athleteAge: 25, counterpartAuthorized: false })).toBe(true);
  });
  it('blocks a minor athlete from an unauthorized counterpart', () => {
    expect(messagingAllowed({ athleteAge: 16, counterpartAuthorized: false })).toBe(false);
    expect(messagingAllowed({ athleteAge: 17, counterpartAuthorized: false })).toBe(false);
  });
  it('allows a minor athlete only with an authorized relationship (coach/guardian)', () => {
    expect(messagingAllowed({ athleteAge: 16, counterpartAuthorized: true })).toBe(true);
  });
  it('fails closed when the age is unknown / non-finite (treated as a minor)', () => {
    expect(messagingAllowed({ athleteAge: undefined, counterpartAuthorized: false })).toBe(false);
    expect(messagingAllowed({ athleteAge: null, counterpartAuthorized: false })).toBe(false);
    expect(messagingAllowed({ athleteAge: NaN, counterpartAuthorized: false })).toBe(false);
    // ...but an authorized relationship still opens it.
    expect(messagingAllowed({ athleteAge: undefined, counterpartAuthorized: true })).toBe(true);
  });
  it('gate note is empty when allowed and explains the limit when blocked (no em dash)', () => {
    expect(messagingGateNote(true)).toBe('');
    const note = messagingGateNote(false);
    expect(note.toLowerCase()).toContain('under 18');
    expect(note).not.toContain('—');
  });
});
