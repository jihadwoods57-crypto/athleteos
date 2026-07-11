import { practiceHeader, inviteLink, inviteShareText } from './practiceIdentity';

describe('practiceHeader', () => {
  it('shows the real trainer name + real practice name once both have hydrated', () => {
    const h = practiceHeader({ name: 'Jordan Reyes' }, { id: 'p1', name: 'Reyes Performance', code: 'ABCD12' });
    expect(h.trainerName).toBe('Jordan Reyes');
    expect(h.practiceName).toBe('Reyes Performance');
    expect(h.initials).toBe('JR');
    expect(h.hasIdentity).toBe(true);
  });

  it('never fabricates a demo persona when identity has not hydrated yet', () => {
    const h = practiceHeader(null, null);
    expect(h.trainerName).toBe('Trainer');
    expect(h.practiceName).toBe('Your practice');
    expect(h.hasIdentity).toBe(false);
    expect(h.trainerName).not.toBe('Tracy Boone');
    expect(h.practiceName).not.toContain('Tracy Boone');
  });

  it('is honest about a partial hydrate (name in, practice not yet)', () => {
    const h = practiceHeader({ name: 'Sam Lee' }, null);
    expect(h.trainerName).toBe('Sam Lee');
    expect(h.practiceName).toBe('Your practice');
    expect(h.hasIdentity).toBe(false);
  });

  it('treats a blank/whitespace name as not-yet-real, not as an empty display name', () => {
    const h = practiceHeader({ name: '   ' }, { name: '  ' });
    expect(h.trainerName).toBe('Trainer');
    expect(h.practiceName).toBe('Your practice');
    expect(h.hasIdentity).toBe(false);
  });

  it('caps initials at two letters from a multi-word real name', () => {
    expect(practiceHeader({ name: 'Mary Jane Watson' }, null).initials).toBe('MJ');
  });
});

describe('inviteLink', () => {
  it('builds the shipped deep-link format with an uppercased code', () => {
    expect(inviteLink('abcd12')).toBe('https://onstandard.app/join?code=ABCD12');
  });

  it('is empty when there is no real code yet (never links to a dead code)', () => {
    expect(inviteLink(null)).toBe('');
    expect(inviteLink(undefined)).toBe('');
    expect(inviteLink('')).toBe('');
    expect(inviteLink('   ')).toBe('');
  });
});

describe('inviteShareText', () => {
  it('carries the real code and the matching link, naming the real practice', () => {
    const text = inviteShareText('abcd12', 'Reyes Performance');
    expect(text).toContain('ABCD12');
    expect(text).toContain('https://onstandard.app/join?code=ABCD12');
    expect(text).toContain('Reyes Performance');
  });

  it('falls back to an honest neutral practice noun when the name has not hydrated', () => {
    const text = inviteShareText('ABCD12', null);
    expect(text).toContain('my practice');
    expect(text).not.toContain('Tracy Boone');
  });

  it('is empty when there is no real code yet (never invites to a dead code)', () => {
    expect(inviteShareText(null, 'Reyes Performance')).toBe('');
    expect(inviteShareText('', 'Reyes Performance')).toBe('');
  });

  it('keeps copy free of em dashes (design ban)', () => {
    expect(inviteShareText('ABCD12', 'Reyes Performance')).not.toContain('—');
  });
});
