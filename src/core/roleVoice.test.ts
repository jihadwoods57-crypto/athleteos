import { ateEnoughLine, experienceKind, experienceVoice, overseerNoun, showSquad } from './roleVoice';

describe('experienceKind', () => {
  it('general profile is the client experience; athlete/gain/absent stay athletic', () => {
    expect(experienceKind('general')).toBe('client');
    expect(experienceKind('athlete')).toBe('athlete');
    expect(experienceKind('gain')).toBe('athlete');
    expect(experienceKind(undefined)).toBe('athlete');
  });
});

describe('overseerNoun', () => {
  it('clients always answer to a trainer; athletes default to coach', () => {
    expect(overseerNoun('client', ['coach'])).toBe('trainer');
    expect(overseerNoun('athlete', ['coach'])).toBe('coach');
    expect(overseerNoun('athlete', [])).toBe('coach');
    // Trainer-only-linked athlete (hybrid book) reads trainer.
    expect(overseerNoun('athlete', ['trainer'])).toBe('trainer');
    expect(overseerNoun('athlete', ['coach', 'trainer'])).toBe('coach');
  });
});

describe('showSquad', () => {
  it('team furniture is off for clients by default', () => {
    expect(showSquad('athlete')).toBe(true);
    expect(showSquad('client')).toBe(false);
  });
});

describe('ateEnoughLine (the anti-crash-diet positive)', () => {
  it('fires only for general profile inside the two-sided window', () => {
    // 2000 vs 2000 target: dev 0 -> adherence 1 -> fires.
    expect(ateEnoughLine('general', 2000, 2000)).toContain('without under-eating');
    // 2200 vs 2000: dev 10% -> still full credit -> fires.
    expect(ateEnoughLine('general', 2200, 2000)).not.toBeNull();
  });
  it('never fires on an under-eaten day (the score would not credit it either)', () => {
    // 1400 vs 2000: dev 30% -> adherence ~0.33 -> no line.
    expect(ateEnoughLine('general', 1400, 2000)).toBeNull();
  });
  it('never fires for athletes, zero targets, or empty days', () => {
    expect(ateEnoughLine('athlete', 2000, 2000)).toBeNull();
    expect(ateEnoughLine('general', 2000, 0)).toBeNull();
    expect(ateEnoughLine('general', 0, 2000)).toBeNull();
  });
  it('copy is em-dash free', () => {
    expect(ateEnoughLine('general', 2000, 2000)).not.toContain('—');
  });
});

describe('experienceVoice', () => {
  it('clients get ownership + adult register; athletes keep the season frame', () => {
    const client = experienceVoice('client');
    const athlete = experienceVoice('athlete');
    expect(client.goalEyebrow).toBe('YOUR GOAL');
    expect(athlete.goalEyebrow).toBe('SEASON GOAL');
    expect(client.dayDoneLine).toContain('showed up');
    for (const v of [client, athlete]) {
      expect(v.dayDoneLine).not.toContain('—');
      expect(v.comebackDetail).not.toContain('—');
    }
  });
});
