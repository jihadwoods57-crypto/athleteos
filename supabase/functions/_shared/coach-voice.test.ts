// Pure-logic tests for Coach Voice (0094 consumer). No Deno/network — the edge fn's I/O is not
// covered here; this locks the prompt-shaping and the banned-word rail that protect the athlete.
import { buildVoiceSystem, violatesProhibited, prohibitedTerms, type VoiceConfig } from './coach-voice';

const base: VoiceConfig = { tone: 'direct', level: 'balanced', approved: [], prohibited: '' };

describe('prohibitedTerms', () => {
  it('splits, trims, lowercases, drops empties', () => {
    expect(prohibitedTerms('Skinny, FAT ,, lazy')).toEqual(['skinny', 'fat', 'lazy']);
  });
  it('empty string yields no terms', () => {
    expect(prohibitedTerms('')).toEqual([]);
    expect(prohibitedTerms('   ,  ')).toEqual([]);
  });
});

describe('violatesProhibited', () => {
  it('matches a banned word as a whole word, case-insensitively', () => {
    expect(violatesProhibited('You looked lazy today.', 'lazy')).toBe(true);
    expect(violatesProhibited('You looked LAZY today.', 'lazy')).toBe(true);
  });
  it('does not fire on a substring (fat in fatigue)', () => {
    expect(violatesProhibited('Push through the fatigue.', 'fat')).toBe(false);
  });
  it('handles punctuation around the word', () => {
    expect(violatesProhibited('Stop being lazy!', 'lazy')).toBe(true);
    expect(violatesProhibited('"skinny"', 'skinny')).toBe(true);
  });
  it('no banned list -> never violates', () => {
    expect(violatesProhibited('anything at all', '')).toBe(false);
  });
  it('matches any term in a comma list', () => {
    expect(violatesProhibited('nice work, not fat at all', 'skinny, fat, lazy')).toBe(true);
  });
});

describe('buildVoiceSystem', () => {
  it('includes the selected tone and accountability directives', () => {
    const sys = buildVoiceSystem({ ...base, tone: 'fired', level: 'hard' });
    expect(sys).toContain('Fired up');
    expect(sys).toContain('Hold the line');
  });
  it('falls back to direct/balanced for unknown values', () => {
    const sys = buildVoiceSystem({ ...base, tone: 'nonsense', level: 'nonsense' });
    expect(sys).toContain('Direct and plain');
    expect(sys).toContain('Even mix');
  });
  it('lists approved phrases the AI may echo', () => {
    const sys = buildVoiceSystem({ ...base, approved: ['That’s the standard.'] });
    expect(sys).toContain('MAY echo');
    expect(sys).toContain('That’s the standard.');
  });
  it('names banned words when set', () => {
    const sys = buildVoiceSystem({ ...base, prohibited: 'skinny, fat' });
    expect(sys).toContain('NEVER use these words');
    expect(sys).toContain('skinny');
  });
  it('always carries the non-negotiable hard rails', () => {
    const sys = buildVoiceSystem(base);
    expect(sys).toContain('Never sign as the coach');
    expect(sys.toLowerCase()).toContain('medical'); // medical-advice rail present
    expect(sys).toContain('report_nudge');
  });
  it('caps approved phrases so a huge list cannot bloat the prompt', () => {
    const many = Array.from({ length: 30 }, (_, i) => `phrase ${i}`);
    const sys = buildVoiceSystem({ ...base, approved: many });
    expect(sys).toContain('phrase 0');
    expect(sys).not.toContain('phrase 20');
  });
});
