// Server bell-feed mapping (proto/redesign-2026-07/js/notif-feed.js) — turns 0027
// `notifications` rows (coach nudges, join events, digests) into bell rows.
// @ts-ignore
import { feedRowFromServer, splitServerRows, fmtWhen } from '../../proto/redesign-2026-07/js/notif-feed.js';

const NOW = Date.parse('2026-07-16T12:00:00Z');
const at = (iso: string, over: object = {}) =>
  ({ id: 'n1', kind: 'nudge', title: 'Coach sent a nudge', body: 'Log dinner tonight.', created_at: iso, read_at: null, ...over });

describe('feedRowFromServer', () => {
  test('a coach nudge maps to a high-level bell row with its copy intact', () => {
    const r = feedRowFromServer(at('2026-07-16T11:00:00Z'), NOW)!;
    expect(r).toMatchObject({ level: 'high', icon: 'bell', title: 'Coach sent a nudge', body: 'Log dinner tonight.', read: false, server: true });
    expect(r.when).toBe('1h ago');
  });
  test('known kinds get their presentation; unknown kinds fall back instead of vanishing', () => {
    expect(feedRowFromServer(at('2026-07-16T11:00:00Z', { kind: 'join_approved' }), NOW)).toMatchObject({ level: 'positive', route: 'home' });
    expect(feedRowFromServer(at('2026-07-16T11:00:00Z', { kind: 'digest' }), NOW)).toMatchObject({ icon: 'clipboard' });
    expect(feedRowFromServer(at('2026-07-16T11:00:00Z', { kind: 'brand-new-kind' }), NOW)).toMatchObject({ icon: 'bell', level: 'medium' });
  });
  test('read_at drives read; malformed rows drop to null, never invented', () => {
    expect(feedRowFromServer(at('2026-07-16T11:00:00Z', { read_at: '2026-07-16T11:30:00Z' }), NOW)!.read).toBe(true);
    expect(feedRowFromServer(null, NOW)).toBeNull();
    expect(feedRowFromServer({ kind: 'nudge' }, NOW)).toBeNull(); // no title
  });
});

describe('splitServerRows', () => {
  test('unread rows go to New, read rows to Earlier, order preserved', () => {
    const rows = [
      at('2026-07-16T11:00:00Z', { id: 'a' }),
      at('2026-07-16T10:00:00Z', { id: 'b', read_at: '2026-07-16T10:05:00Z' }),
      at('2026-07-15T10:00:00Z', { id: 'c' }),
    ];
    const s = splitServerRows(rows, NOW);
    expect(s.unread.map((r: any) => r.id)).toEqual(['a', 'c']);
    expect(s.read.map((r: any) => r.id)).toEqual(['b']);
  });
  test('junk input yields empty groups', () => {
    expect(splitServerRows(null, NOW)).toEqual({ unread: [], read: [] });
  });
});

describe('fmtWhen', () => {
  test('compact feed-style labels', () => {
    expect(fmtWhen('2026-07-16T11:59:30Z', NOW)).toBe('now');
    expect(fmtWhen('2026-07-16T11:40:00Z', NOW)).toBe('20m ago');
    expect(fmtWhen('2026-07-16T07:00:00Z', NOW)).toBe('5h ago');
    expect(fmtWhen('2026-07-13T12:00:00Z', NOW)).toBe('Mon');
    expect(fmtWhen('garbage', NOW)).toBe('');
  });
});
