import { lastSyncedLabel, syncFreshness, STALE_AFTER_HOURS } from './freshness';

const NOW = new Date('2026-06-28T12:00:00Z');
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();

describe('lastSyncedLabel', () => {
  it('reads "Not synced yet" for missing/invalid times', () => {
    expect(lastSyncedLabel(null, NOW)).toBe('Not synced yet');
    expect(lastSyncedLabel(undefined, NOW)).toBe('Not synced yet');
    expect(lastSyncedLabel('not-a-date', NOW)).toBe('Not synced yet');
  });
  it('reads "just now" within the first minute (and tolerates future skew)', () => {
    expect(lastSyncedLabel(ago(0), NOW)).toBe('Synced just now');
    expect(lastSyncedLabel(new Date(NOW.getTime() + 30_000).toISOString(), NOW)).toBe('Synced just now');
  });
  it('reads minutes, then hours', () => {
    expect(lastSyncedLabel(ago(12), NOW)).toBe('Synced 12m ago');
    expect(lastSyncedLabel(ago(59), NOW)).toBe('Synced 59m ago');
    expect(lastSyncedLabel(ago(60), NOW)).toBe('Synced 1h ago');
    expect(lastSyncedLabel(ago(3 * 60), NOW)).toBe('Synced 3h ago');
  });
  it('reads yesterday, then a day count, then a date', () => {
    expect(lastSyncedLabel(ago(24 * 60), NOW)).toBe('Synced yesterday');
    expect(lastSyncedLabel(ago(4 * 24 * 60), NOW)).toBe('Synced 4 days ago');
    expect(lastSyncedLabel(ago(10 * 24 * 60), NOW)).toBe('Last synced Jun 18');
  });
  it('never emits an em dash or guilt language', () => {
    for (const m of [0, 30, 200, 24 * 60, 10 * 24 * 60]) {
      expect(lastSyncedLabel(ago(m), NOW)).not.toContain('—');
    }
  });
});

describe('syncFreshness', () => {
  it('is none for missing/invalid', () => {
    expect(syncFreshness(null, NOW)).toBe('none');
    expect(syncFreshness('nope', NOW)).toBe('none');
  });
  it('is fresh up to the stale threshold, stale beyond it', () => {
    expect(syncFreshness(ago(60), NOW)).toBe('fresh');
    expect(syncFreshness(ago(STALE_AFTER_HOURS * 60), NOW)).toBe('fresh'); // boundary inclusive
    expect(syncFreshness(ago((STALE_AFTER_HOURS + 1) * 60), NOW)).toBe('stale');
  });
  it('honors a custom stale window', () => {
    expect(syncFreshness(ago(13 * 60), NOW, 12)).toBe('stale');
    expect(syncFreshness(ago(11 * 60), NOW, 12)).toBe('fresh');
  });
});
