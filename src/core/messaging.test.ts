import { composeMessage, appendMessage, messageDeliveryNote, MAX_MESSAGE_LEN } from './messaging';
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
  it('confirms delivery only when the backend is live', () => {
    expect(messageDeliveryNote(true).toLowerCase()).toContain('delivered');
  });
});
