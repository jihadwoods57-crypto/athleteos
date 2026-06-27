// AthleteOS — user data export (pure TS, no RN imports).
// Apple 5.1.1(v) + GDPR/CCPA: a user (or a minor's guardian) can take a copy of
// their own data. This builds a structured, human-readable snapshot of everything
// the app holds about THIS user locally — identity, targets, today's log, history,
// and performance PRs. Pure: a screen turns it into a share/JSON file.
import type { AppState } from './types';

export interface UserDataExport {
  exportedBy: string;
  app: string;
  identity: {
    name: string;
    email: string;
    sport: string;
    position: string;
    primaryGoal: string | null;
    ageAtSetup: number;
  };
  targets: { proteinG: number; calories: number; weightLb: number };
  today: {
    mealsLogged: string[];
    savedPlates: Record<string, unknown>;
    hydrationL: number;
    tasksDone: number;
    checkinSubmitted: boolean;
  };
  history: {
    dailyScores: AppState['scoreHistory'];
    weight: AppState['weightHistory'];
    nutrition: AppState['nutritionHistory'];
  };
  performance: AppState['perfEntries'];
}

/** Build the structured export of the signed-in user's own data. Pure. */
export function exportUserData(s: AppState): UserDataExport {
  const meals = s.meals ?? {};
  return {
    exportedBy: s.athleteName?.trim() || 'AthleteOS user',
    app: 'AthleteOS',
    identity: {
      name: s.athleteName ?? '',
      email: s.athleteEmail ?? '',
      sport: s.sport ?? '',
      position: s.position ?? '',
      primaryGoal: s.primaryGoal ?? null,
      ageAtSetup: s.baseAge ?? 0,
    },
    targets: {
      proteinG: s.proteinTarget ?? 0,
      calories: s.calTarget ?? 0,
      weightLb: s.weightTarget ?? 0,
    },
    today: {
      mealsLogged: (Object.keys(meals) as (keyof typeof meals)[]).filter((k) => meals[k]),
      savedPlates: s.mealFoods ?? {},
      hydrationL: s.hydrationL ?? 0,
      tasksDone: (s.tasks ?? []).filter((t) => t.done).length,
      checkinSubmitted: Boolean(s.ciSubmitted),
    },
    history: {
      dailyScores: s.scoreHistory ?? [],
      weight: s.weightHistory ?? [],
      nutrition: s.nutritionHistory ?? [],
    },
    performance: s.perfEntries ?? [],
  };
}

/** Pretty-printed JSON of the export, for a share sheet / saved file. */
export function exportUserDataText(s: AppState): string {
  return JSON.stringify(exportUserData(s), null, 2);
}
