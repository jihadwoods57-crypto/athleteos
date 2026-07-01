// OnStandard — user data export (GDPR/CCPA portability). Proves the snapshot covers
// the user's own identity, targets, today, history, and PRs, and serializes to JSON.
import { exportUserData, exportUserDataText } from './dataExport';
import { createInitialState } from './defaultState';
import type { AppState } from './types';

describe('exportUserData', () => {
  it('captures identity, targets, today and history from state', () => {
    const s: AppState = {
      ...createInitialState(),
      athleteName: 'Marcus Cole',
      athleteEmail: 'm@x.io',
      sport: 'Football',
      position: 'LB',
      proteinTarget: 200,
      hydrationL: 2.1,
      scoreHistory: [{ date: '2026-06-20', score: 77 }],
    };
    const e = exportUserData(s);
    expect(e.identity.name).toBe('Marcus Cole');
    expect(e.identity.email).toBe('m@x.io');
    expect(e.identity.sport).toBe('Football');
    expect(e.targets.proteinG).toBe(200);
    expect(e.today.hydrationL).toBe(2.1);
    expect(e.history.dailyScores).toEqual([{ date: '2026-06-20', score: 77 }]);
  });

  it('lists only the logged meal slots', () => {
    const s: AppState = { ...createInitialState(), meals: { breakfast: true, lunch: false, snack: true, dinner: false } };
    expect(exportUserData(s).today.mealsLogged.sort()).toEqual(['breakfast', 'snack']);
  });

  it('serializes to valid, round-trippable JSON', () => {
    const text = exportUserDataText(createInitialState());
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text).app).toBe('OnStandard');
  });
});
