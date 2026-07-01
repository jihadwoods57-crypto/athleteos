// OnStandard — store-level tests for the performance (PR) track. Drives the real
// logPr/deletePr actions and asserts persistence + that the daily score is
// untouched (performance is a separate development track).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { useStore } from './useStore';
import { computeDerived, performanceSummaries, CUSTOM_METRIC_KEY } from '@/core';

const state = () => useStore.getState();

beforeEach(() => {
  state().resetDemo();
});

describe('logPr', () => {
  it('starts with an empty (honest) performance log', () => {
    expect(state().perfEntries).toEqual([]);
  });

  it('logs a catalog PR with a stable id and persists it', () => {
    state().logPr({ metricKey: 'bench', value: 225, date: '2026-06-20' });
    const entries = state().perfEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].metricKey).toBe('bench');
    expect(entries[0].value).toBe(225);
    expect(entries[0].id).toBe('pr_1');
  });

  it('assigns collision-free ids as more PRs are logged', () => {
    state().logPr({ metricKey: 'bench', value: 200, date: '2026-06-18' });
    state().logPr({ metricKey: 'bench', value: 210, date: '2026-06-20' });
    const ids = state().perfEntries.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('pr_1');
    expect(ids).toContain('pr_2');
  });

  it('keeps the log sorted oldest -> newest', () => {
    state().logPr({ metricKey: 'bench', value: 210, date: '2026-06-20' });
    state().logPr({ metricKey: 'bench', value: 200, date: '2026-06-10' });
    expect(state().perfEntries.map((e) => e.value)).toEqual([200, 210]);
  });

  it('records a custom metric with its label/unit/dir', () => {
    state().logPr({
      metricKey: CUSTOM_METRIC_KEY,
      value: 12,
      date: '2026-06-20',
      customLabel: 'Pull-ups',
      customUnit: 'reps',
      customDir: 'higher',
    });
    const e = state().perfEntries[0];
    expect(e.customLabel).toBe('Pull-ups');
    expect(e.customUnit).toBe('reps');
    expect(e.customDir).toBe('higher');
  });

  it('ignores a non-numeric value', () => {
    state().logPr({ metricKey: 'bench', value: Number.NaN, date: '2026-06-20' });
    expect(state().perfEntries).toHaveLength(0);
  });

  it('does NOT change the daily Accountability Score (separate track)', () => {
    const before = computeDerived(state()).athleteScore;
    state().logPr({ metricKey: 'bench', value: 225, date: '2026-06-20' });
    state().logPr({ metricKey: 'sprint40', value: 4.6, date: '2026-06-21' });
    expect(computeDerived(state()).athleteScore).toBe(before);
  });

  it('feeds performanceSummaries end-to-end', () => {
    state().logPr({ metricKey: 'bench', value: 200, date: '2026-06-10' });
    state().logPr({ metricKey: 'bench', value: 225, date: '2026-06-20' });
    const summaries = performanceSummaries(state().perfEntries);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].best).toBe(225);
    expect(summaries[0].latestIsPr).toBe(true);
  });
});

describe('deletePr', () => {
  it('removes a logged PR by id', () => {
    state().logPr({ metricKey: 'bench', value: 200, date: '2026-06-18' });
    state().logPr({ metricKey: 'squat', value: 315, date: '2026-06-20' });
    const target = state().perfEntries.find((e) => e.metricKey === 'bench')!;
    state().deletePr(target.id);
    expect(state().perfEntries.map((e) => e.metricKey)).toEqual(['squat']);
  });

  it('is a no-op for an unknown id', () => {
    state().logPr({ metricKey: 'bench', value: 200, date: '2026-06-18' });
    state().deletePr('pr_999');
    expect(state().perfEntries).toHaveLength(1);
  });
});
