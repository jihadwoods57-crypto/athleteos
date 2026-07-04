import { buildAssistantBrief, praiseMessageFor, BRIEF_MAX_ACTIONS } from './assistantBrief';
import { teamWeeklyReport } from './weeklyReport';
import type { AtRiskInput } from './attention';

/** A roster with two clear at-risk athletes, one healthy, one star mover. */
const ROSTER: AtRiskInput[] = [
  { name: 'Kam Bell', athleteId: 'a-kam', score: 58, comp: 40, dir: 'down', proteinMissed: 3 },
  { name: 'Lewis Ray', athleteId: 'a-lewis', score: 72, comp: 65, dir: 'flat', checkinDaysAgo: 4 },
  { name: 'Troy Hall', athleteId: 'a-troy', score: 88, comp: 90, dir: 'flat' },
  { name: 'Boone West', athleteId: 'a-boone', score: 96, comp: 95, dir: 'up' },
];

const report = (roster: AtRiskInput[]) =>
  teamWeeklyReport(roster.map((r) => ({ name: r.name, score: r.score, comp: r.comp, dir: r.dir })), 'week');

describe('buildAssistantBrief — coach', () => {
  const brief = buildAssistantBrief({ role: 'coach', roster: ROSTER, report: report(ROSTER), scope: 'week' });

  it('opens with the honest review line and names who needs attention', () => {
    expect(brief.text).toContain('Reviewed all 4 athletes');
    expect(brief.text).toContain('Kam and Lewis need you');
    expect(brief.text).not.toContain('—');
  });

  it('triage actions carry evidence + a ready message, worst first', () => {
    expect(brief.actions.length).toBe(2);
    expect(brief.actions[0].name).toBe('Kam Bell'); // worst risk first
    expect(brief.actions[0].reason).toContain('Protein missed 3 of 7');
    expect(brief.actions[0].suggestion.length).toBeGreaterThan(10);
    expect(brief.actions[0].tone).toBe('alert');
    expect(brief.actions.length).toBeLessThanOrEqual(BRIEF_MAX_ACTIONS);
  });

  it('earns the praise lane from the real best mover (never manufactured)', () => {
    expect(brief.praise).toHaveLength(1);
    expect(brief.praise[0].name).toBe('Boone West');
    expect(brief.praise[0].tone).toBe('praise');
    expect(brief.praise[0].suggestion).toContain('Boone');
    expect(brief.text).toContain('Boone is your best mover at 96');
  });

  it('grounds the narration in exactly the named athletes and stays bounded', () => {
    expect(brief.grounding).toEqual(expect.arrayContaining(['Kam Bell', 'Lewis Ray', 'Boone West']));
    expect(brief.grounding).not.toContain('Troy Hall');
    const needs = brief.narrationData.needs_attention as { name: string }[];
    expect(needs.map((n) => n.name)).toEqual(['Kam Bell', 'Lewis Ray']);
  });

  it('an all-clear roster reads as a rare good day, not silence', () => {
    const clear: AtRiskInput[] = [
      { name: 'A One', score: 90, comp: 92, dir: 'flat' },
      { name: 'B Two', score: 85, comp: 88, dir: 'flat' },
    ];
    const b = buildAssistantBrief({ role: 'coach', roster: clear, report: report(clear), scope: 'today' });
    expect(b.actions).toHaveLength(0);
    expect(b.text).toContain('Nobody is below the line');
  });

  it('an empty roster gets the activation nudge, never a fabricated stat', () => {
    const b = buildAssistantBrief({ role: 'coach', roster: [], report: report([]), scope: 'week' });
    expect(b.text).toContain('No athletes on your roster yet');
    expect(b.kpis.total).toBe(0);
  });
});

describe('buildAssistantBrief — trainer (retention first)', () => {
  it('leads with quiet clients before the accountability read', () => {
    const book: AtRiskInput[] = [
      { name: 'Maria Cole', athleteId: 'c-1', score: 62, comp: 55, dir: 'down', last: '4 days ago' },
      { name: 'Dan Reeve', athleteId: 'c-2', score: 84, comp: 82, dir: 'flat', last: 'today' },
    ];
    const b = buildAssistantBrief({ role: 'trainer', roster: book, report: report(book), scope: 'week' });
    expect(b.text).toContain('Maria has gone quiet');
    expect(b.text).toContain('paying clients drift');
    expect((b.narrationData as { quiet_clients?: unknown[] }).quiet_clients).toHaveLength(1);
    expect(b.directive).toContain('PAY');
  });

  it('coach briefs never carry the retention framing', () => {
    const b = buildAssistantBrief({ role: 'coach', roster: ROSTER, report: report(ROSTER), scope: 'week' });
    expect(b.text).not.toContain('drift');
    expect('quiet_clients' in b.narrationData).toBe(false);
    expect(b.directive).toContain('coach');
  });
});

describe('praiseMessageFor', () => {
  it('is specific, first-name, and em-dash free', () => {
    const msg = praiseMessageFor('Boone West', 96);
    expect(msg).toContain('Boone');
    expect(msg).toContain('96');
    expect(msg).not.toContain('—');
  });
});

describe('clientResultText (trainer proof-of-value)', () => {
  const { clientResultText } = require('./assistantBrief');
  it('is scope-honest, factual, and em-dash free', () => {
    const t = clientResultText({ name: 'Maria Cole', score: 84, comp: 82, dir: 'up' }, 'today');
    expect(t).toContain('Maria');
    expect(t).toContain('84 today');
    expect(t).toContain('82% on plan');
    expect(t).toContain('trending up');
    expect(t).not.toContain('—');
    const w = clientResultText({ name: 'Dan Reeve', score: 71, comp: 60, dir: 'down' }, 'week');
    expect(w).toContain('this week');
    expect(w).toContain('room to climb');
  });
});
