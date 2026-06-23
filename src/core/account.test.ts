import { accountRows } from './account';
import { APP_VERSION, ROSTER, TRAINER_CLIENTS } from './constants';

describe('accountRows', () => {
  it('always returns the three settings rows in order', () => {
    for (const role of [null, 'athlete', 'parent', 'sports_perf_coach', 'personal_trainer', 'nutritionist'] as const) {
      const rows = accountRows(role);
      expect(rows.map((r) => r.key)).toEqual(['team', 'plan', 'help']);
      expect(rows.every((r) => r.label && r.hint && r.detail)).toBe(true);
    }
  });

  it('derives the coach team row from the live roster (never invented)', () => {
    const team = accountRows('sports_perf_coach')[0];
    expect(team.hint).toBe(`${ROSTER.length} athletes`);
    expect(team.detail).toContain(String(ROSTER.length));
  });

  it('derives the trainer team row from the client book + distinct orgs', () => {
    const team = accountRows('personal_trainer')[0];
    const orgs = new Set(TRAINER_CLIENTS.map((c) => c.org)).size;
    expect(team.hint).toBe(`${TRAINER_CLIENTS.length} clients`);
    expect(team.detail).toContain(String(TRAINER_CLIENTS.length));
    expect(team.detail).toContain(String(orgs));
  });

  it('treats a null role as the athlete', () => {
    expect(accountRows(null)[0]).toEqual(accountRows('athlete')[0]);
    expect(accountRows(null)[0].hint).toBe('Eastside HS');
  });

  it('shows a linked-state team row for the parent', () => {
    expect(accountRows('parent')[0].hint).toBe('Linked');
  });

  it('surfaces the app version in the help row', () => {
    const help = accountRows('sports_perf_coach')[2];
    expect(help.hint).toBe(APP_VERSION);
    expect(help.detail).toContain(APP_VERSION);
  });

  it('keeps copy free of em dashes (design ban)', () => {
    for (const role of [null, 'parent', 'sports_perf_coach', 'personal_trainer', 'nutritionist'] as const) {
      for (const row of accountRows(role)) {
        expect(row.detail).not.toContain('—');
        expect(row.hint).not.toContain('—');
      }
    }
  });
});
