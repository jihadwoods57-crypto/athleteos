import { loadVoiceForAthlete } from '../../supabase/functions/_shared/coach-voice-load';

// Fake supabase client: the chain is .from(t).select().eq()...maybeSingle(); we return preset data
// per table name. team_members feeds the first call, coach_voice_config the second.
function fakeSb(members: unknown, configRow: unknown) {
  return {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: table === 'team_members' ? members : configRow }),
      };
      return chain;
    },
  };
}

describe('loadVoiceForAthlete', () => {
  test('null when the athlete has no active team', async () => {
    expect(await loadVoiceForAthlete(fakeSb(null, null) as any, 'u1')).toBeNull();
  });

  test('null when the team has Voice disabled', async () => {
    const sb = fakeSb({ team_id: 't1' }, { enabled: false, config: {}, version: 3 });
    expect(await loadVoiceForAthlete(sb as any, 'u1')).toBeNull();
  });

  test('returns cfg + version + teamId when enabled', async () => {
    const sb = fakeSb(
      { team_id: 't1' },
      { enabled: true, config: { tone: 'fired', level: 'hard', approved: ['x'], prohibited: 'lazy' }, version: 5 },
    );
    expect(await loadVoiceForAthlete(sb as any, 'u1')).toEqual({
      cfg: { tone: 'fired', level: 'hard', approved: ['x'], prohibited: 'lazy' },
      version: 5,
      teamId: 't1',
    });
  });

  test('defaults cfg fields and version when config is sparse', async () => {
    const sb = fakeSb({ team_id: 't1' }, { enabled: true, config: {}, version: null });
    expect(await loadVoiceForAthlete(sb as any, 'u1')).toEqual({
      cfg: { tone: 'direct', level: 'balanced', approved: [], prohibited: '' },
      version: 1,
      teamId: 't1',
    });
  });
});
