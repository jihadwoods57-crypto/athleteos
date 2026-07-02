import {
  DEFAULT_PERSONALITY,
  clampForAudience,
  personalityDirective,
  resolvePersonality,
  type PersonalityStyle,
} from './personality';

describe('resolvePersonality — season > team > org > platform', () => {
  const season: PersonalityStyle = { style: 'military', intensity: 'firm' };
  const team: PersonalityStyle = { style: 'performance_driven', intensity: 'standard' };
  const org: PersonalityStyle = { style: 'professional', intensity: 'soft' };
  const platform: PersonalityStyle = { style: 'educational', intensity: 'standard' };

  it('picks the most specific layer that is set', () => {
    expect(resolvePersonality({ season, team, org, platform })).toEqual(season);
    expect(resolvePersonality({ team, org, platform })).toEqual(team);
    expect(resolvePersonality({ org, platform })).toEqual(org);
    expect(resolvePersonality({ platform })).toEqual(platform);
  });

  it('falls back to the solo-athlete default when nothing is set', () => {
    expect(resolvePersonality()).toEqual(DEFAULT_PERSONALITY);
    expect(resolvePersonality({ season: null, team: null })).toEqual(DEFAULT_PERSONALITY);
  });
});

describe('clampForAudience — the minor safety floor', () => {
  it('softens harsh styles for minors', () => {
    expect(clampForAudience({ style: 'military', intensity: 'firm' }, true)).toEqual({ style: 'supportive', intensity: 'standard' });
    expect(clampForAudience({ style: 'tough_love', intensity: 'standard' }, true).style).toBe('supportive');
  });

  it('caps firm intensity to standard for minors', () => {
    expect(clampForAudience({ style: 'encouraging', intensity: 'firm' }, true)).toEqual({ style: 'encouraging', intensity: 'standard' });
  });

  it('never makes the posture harsher — only gentler', () => {
    const soft: PersonalityStyle = { style: 'supportive', intensity: 'soft' };
    expect(clampForAudience(soft, true)).toEqual(soft);
  });

  it('leaves non-minors unchanged', () => {
    const firm: PersonalityStyle = { style: 'military', intensity: 'firm' };
    expect(clampForAudience(firm, false)).toEqual(firm);
  });
});

describe('personalityDirective', () => {
  it('always restates the phrasing-only boundary', () => {
    for (const style of ['encouraging', 'military', 'tough_love', 'professional'] as const) {
      const d = personalityDirective({ style, intensity: 'standard' });
      expect(d.toLowerCase()).toContain('phrasing only');
      expect(d.toLowerCase()).toContain('never change a number');
      expect(d.toLowerCase()).toContain('disclaimers');
    }
  });

  it('reflects the chosen style and intensity', () => {
    expect(personalityDirective({ style: 'military', intensity: 'firm' })).toContain('disciplined');
    expect(personalityDirective({ style: 'military', intensity: 'firm' })).toContain('hold the line');
  });
});
