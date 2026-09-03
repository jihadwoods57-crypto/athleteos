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
  test('2026-09-03: winback, verified_profile and the connected-standard kinds no longer fall to the default bell', () => {
    const rid = '7f3a1b2c-9d8e-4f5a-b6c7-d8e9f0a1b2c3';
    expect(feedRowFromServer(at('2026-07-16T11:00:00Z', { kind: 'winback:d3' }), NOW)).toMatchObject({ icon: 'heart', level: 'info', tag: 'welcome back', route: 'home' });
    expect(feedRowFromServer(at('2026-07-16T11:00:00Z', { kind: 'verified_profile' }), NOW)).toMatchObject({ level: 'high', route: 'verified-profile' });
    // The result id rides the kind as a suffix so the bell row can open the standard itself.
    expect(feedRowFromServer(at('2026-07-16T11:00:00Z', { kind: `cs_reminder:${rid}` }), NOW)).toMatchObject({ icon: 'clock', route: `connected-standard/${rid}` });
    expect(feedRowFromServer(at('2026-07-16T11:00:00Z', { kind: `cs_missed:${rid}` }), NOW)).toMatchObject({ tag: 'missed', route: `connected-standard/${rid}` });
    // A bare (pre-suffix) row still renders, just without a link into nowhere.
    expect(feedRowFromServer(at('2026-07-16T11:00:00Z', { kind: 'cs_reminder' }), NOW)).toMatchObject({ icon: 'clock', route: null });
  });
  test('announcement kind renders with its own icon, not the default bell', () => {
    const r = feedRowFromServer({
      id: 'n1', kind: 'announcement', title: 'Lift moved to 6am',
      body: 'Weight room closes early Friday.', created_at: new Date(NOW - 60000).toISOString(), read_at: null,
    }, NOW)!;
    expect(r.icon).toBe('share'); // verified real glyph — js/icons.js has no 'speaker'; 'share' (send-out arrows) is the closest real broadcast icon
    expect(r.level).toBe('info');
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

describe('AI follow-up rows deep-link to the meal they are about', () => {
  const row = (kind: string) => ({ id: 'n1', kind, title: 'Your nutritionist', body: 'How did dinner go?', created_at: '2026-07-16T11:59:30Z', read_at: null });

  test('opens the thread where the athlete can actually reply', () => {
    // Unlike every other server row, this one is a task, not a record: the AI asked a question.
    const out = feedRowFromServer(row('ai_followup:7f3a1b2c-9d8e-4f5a-b6c7-d8e9f0a1b2c3'), NOW)!;
    expect(out.route).toBe('meal-view/7f3a1b2c-9d8e-4f5a-b6c7-d8e9f0a1b2c3');
    expect(out.icon).toBe('sparkle');
  });

  test('a junk suffix renders as a plain record, never a link into nowhere', () => {
    expect(feedRowFromServer(row('ai_followup:../../etc'), NOW)!.route).toBeNull();
    expect(feedRowFromServer(row('ai_followup:'), NOW)!.route).toBeNull();
    expect(feedRowFromServer(row('ai_followup'), NOW)!.route).toBeNull();
  });

  test('the emitted route passes the native deep-link validator', () => {
    const out = feedRowFromServer(row('ai_followup:abc123def456'), NOW)!;
    expect(/^[a-z0-9/_-]{1,64}$/i.test(out.route!)).toBe(true);
  });

  test('unknown kinds still fall back safely — no regression', () => {
    const out = feedRowFromServer(row('something_new'), NOW)!;
    expect(out.route).toBeNull();
    expect(out.title).toBe('Your nutritionist');
  });
});
