import { buildVoiceDirective, buildVoiceSystem, type VoiceConfig } from '../../supabase/functions/_shared/coach-voice';

const cfg: VoiceConfig = { tone: 'fired', level: 'hard', approved: ['Eat like it matters'], prohibited: 'lazy, fat' };

describe('buildVoiceDirective', () => {
  test('includes tone, level, an approved phrase, banned words, and the safety rails', () => {
    const d = buildVoiceDirective(cfg);
    expect(d).toContain('Fired up');            // tone directive
    expect(d).toContain('Hold the line');       // level directive
    expect(d).toContain('Eat like it matters'); // approved phrase echoed
    expect(d).toContain('NEVER use these words'); // banned block
    expect(d).toContain('You are AI');          // safety hard rail
    expect(d).toContain('Never create a requirement'); // deterministic-authority rail
  });

  test('omits the nudge-specific length + tool lines (so an analysis paragraph is not capped)', () => {
    const d = buildVoiceDirective(cfg);
    expect(d).not.toContain('report_nudge');
    expect(d).not.toContain('One or two short sentences');
  });
});

describe('buildVoiceSystem (nudge — must stay byte-identical)', () => {
  test('is the directive plus the exact nudge tail', () => {
    expect(buildVoiceSystem(cfg)).toBe(
      buildVoiceDirective(cfg) +
        '\n- One or two short sentences. No hype, no em dashes, no emoji.' +
        '\nAlways answer by calling report_nudge.',
    );
  });

  test('still ends by instructing the nudge tool call', () => {
    expect(buildVoiceSystem(cfg)).toContain('Always answer by calling report_nudge.');
  });
});
