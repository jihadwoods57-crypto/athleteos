// Coach OS Inbox v2 — pure categorizer + grouped alerts (spec 2026-07-16, Slice D).
// @ts-ignore
import { categorizeInbox, inboxAlerts } from '../../proto/redesign-2026-07/js/inbox.js';

const NOW = 1_700_000_000_000;
const meal = (id: string, over = {}) => ({ id, athlete_id: 'a1', type: 'Lunch', protein: 20, quality: 70, logged_at: new Date(NOW - 3600_000).toISOString(), ...over });

test('a meal whose last comment is from the athlete lands in needsResponse', () => {
  const out = categorizeInbox({
    meals: [meal('m1')],
    comments: [
      { meal_id: 'm1', role: 'coach', kind: 'message', created_at: new Date(NOW - 7200_000).toISOString() },
      { meal_id: 'm1', role: 'athlete', kind: 'message', created_at: new Date(NOW - 1800_000).toISOString() },
    ],
    interventions: [], roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW,
  });
  expect(out.needsResponse.some((r: any) => r.id === 'm1')).toBe(true);
  expect(out.counts.needsResponse).toBeGreaterThanOrEqual(1);
});

test('an unseen meal with no comments lands in mealReviews, not needsResponse', () => {
  const out = categorizeInbox({ meals: [meal('m2')], comments: [], interventions: [], roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW });
  expect(out.mealReviews.some((r: any) => r.id === 'm2')).toBe(true);
  expect(out.needsResponse.some((r: any) => r.id === 'm2')).toBe(false);
});

test('a meal with a handled intervention (reason_key meal:<id>) lands in resolved', () => {
  const out = categorizeInbox({
    meals: [meal('m3')],
    comments: [{ meal_id: 'm3', role: 'athlete', kind: 'message', created_at: new Date(NOW - 1800_000).toISOString() }],
    interventions: [{ athlete_id: 'a1', kind: 'handled', reason_key: 'meal:m3', created_at: new Date(NOW - 600_000).toISOString() }],
    roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW,
  });
  expect(out.resolved.some((r: any) => r.id === 'm3')).toBe(true);
  expect(out.needsResponse.some((r: any) => r.id === 'm3')).toBe(false); // resolved wins
});

test('all athlete meal threads appear under athletes; join requests under staff-adjacent needsResponse', () => {
  const out = categorizeInbox({ meals: [meal('m4')], comments: [], interventions: [], roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [{ id: 'p1', name: 'New Kid' }], staff: [], announcements: [], seenIds: new Set(['m4']), nowMs: NOW });
  expect(out.athletes.some((r: any) => r.id === 'm4')).toBe(true);
  expect(out.needsResponse.some((r: any) => r.kind === 'join')).toBe(true);
});

test('reactions/notes are ignored for last-role: coach message + newer athlete reaction/note is still coach-spoke-last', () => {
  const out = categorizeInbox({
    meals: [meal('m5')],
    comments: [
      { meal_id: 'm5', role: 'coach', kind: 'message', created_at: new Date(NOW - 7200_000).toISOString() },
      { meal_id: 'm5', role: 'athlete', kind: 'reaction', created_at: new Date(NOW - 1800_000).toISOString() },
      { meal_id: 'm5', role: 'athlete', kind: 'note', created_at: new Date(NOW - 900_000).toISOString() },
    ],
    interventions: [], roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW,
  });
  expect(out.needsResponse.some((r: any) => r.id === 'm5')).toBe(false);
});

test('mealReviews never double-categorizes with needsResponse: unseen athlete-last meal is needsResponse only; unseen no-comment meal is mealReviews only', () => {
  const out = categorizeInbox({
    meals: [meal('m6'), meal('m7')],
    comments: [
      { meal_id: 'm6', role: 'coach', kind: 'message', created_at: new Date(NOW - 7200_000).toISOString() },
      { meal_id: 'm6', role: 'athlete', kind: 'message', created_at: new Date(NOW - 1800_000).toISOString() },
    ],
    interventions: [], roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW,
  });
  expect(out.needsResponse.some((r: any) => r.id === 'm6')).toBe(true);
  expect(out.mealReviews.some((r: any) => r.id === 'm6')).toBe(false);
  expect(out.mealReviews.some((r: any) => r.id === 'm7')).toBe(true);
  expect(out.needsResponse.some((r: any) => r.id === 'm7')).toBe(false);
});

test('preview sub: low protein + athlete-last needsResponse meal names the macro flag and the conversation state', () => {
  const out = categorizeInbox({
    meals: [meal('m8', { protein: 8 })],
    comments: [{ meal_id: 'm8', role: 'athlete', kind: 'message', created_at: new Date(NOW - 1800_000).toISOString() }],
    interventions: [], roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW,
  });
  const row = out.needsResponse.find((r: any) => r.id === 'm8');
  expect(row.sub).toContain('Low protein');
  expect(row.sub).toContain('needs your response');
});

test('preview sub: coach-last meal (not resolved) shows "you replied" and lands in athletes, not needsResponse', () => {
  const out = categorizeInbox({
    meals: [meal('m9')],
    comments: [{ meal_id: 'm9', role: 'coach', kind: 'message', created_at: new Date(NOW - 1800_000).toISOString() }],
    interventions: [], roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW,
  });
  const row = out.athletes.find((r: any) => r.id === 'm9');
  expect(row.sub).toContain('you replied');
  expect(out.needsResponse.some((r: any) => r.id === 'm9')).toBe(false);
});

test('preview sub: resolved meal says "resolved" regardless of conversation state', () => {
  const out = categorizeInbox({
    meals: [meal('m10')],
    comments: [{ meal_id: 'm10', role: 'athlete', kind: 'message', created_at: new Date(NOW - 1800_000).toISOString() }],
    interventions: [{ athlete_id: 'a1', kind: 'handled', reason_key: 'meal:m10', created_at: new Date(NOW - 600_000).toISOString() }],
    roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW,
  });
  const row = out.resolved.find((r: any) => r.id === 'm10');
  expect(row.sub).toContain('resolved');
});

test('preview sub: fresh unseen meal with normal macros and no comments is plain meal type + not yet opened', () => {
  const out = categorizeInbox({
    meals: [meal('m11')],
    comments: [], interventions: [], roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW,
  });
  const row = out.mealReviews.find((r: any) => r.id === 'm11');
  expect(row.sub).toBe('Lunch · not yet opened');
});

test('inboxAlerts groups overdue requirements across athletes', () => {
  const entries = [
    { row: { athleteId: 'a1', name: 'A' }, status: { key: 'overdue', openItems: [{ id: 'lunch', title: 'Lunch', state: 'overdue' }] } },
    { row: { athleteId: 'a2', name: 'B' }, status: { key: 'overdue', openItems: [{ id: 'lunch', title: 'Lunch', state: 'overdue' }] } },
    { row: { athleteId: 'a3', name: 'C' }, status: { key: 'on_standard', openItems: [] } },
  ];
  const alerts = inboxAlerts(entries, NOW);
  const lunch = alerts.find(a => a.id.includes('lunch'));
  expect(lunch).toBeTruthy();
  expect(lunch!.title).toMatch(/2 athletes/);
});

test('pending staff invites appear in the staff category (used_by null), active staff after', () => {
  const out = categorizeInbox({
    meals: [], comments: [], interventions: [], roster: [], pending: [], announcements: [],
    staff: [{ id: 's1', name: 'Coach Reynolds', role: 'head_coach' }],
    staffInvites: [{ id: 'inv1', role: 'nutritionist', created_at: new Date(NOW).toISOString() }],
    seenIds: new Set(), nowMs: NOW,
  });
  expect(out.counts.staff).toBe(2);
  const invite = out.staff.find((r: any) => r.id === 'invite:inv1');
  expect(invite).toBeTruthy();
  expect(invite.title).toBe('Nutritionist invite');
  expect(invite.sub).toBe('Awaiting redemption');
  expect(invite.go).toBe('coach-profile');
  // active staff still present, invites listed first
  expect(out.staff.find((r: any) => r.id === 's1')).toBeTruthy();
  expect(out.staff[0].id).toBe('invite:inv1');
});

test('no staffInvites param -> staff category is just active staff (back-compat)', () => {
  const out = categorizeInbox({
    meals: [], comments: [], interventions: [], roster: [], pending: [], announcements: [],
    staff: [{ id: 's1', name: 'Coach', role: 'head_coach' }],
    seenIds: new Set(), nowMs: NOW,
  });
  expect(out.counts.staff).toBe(1);
  expect(out.staff[0].id).toBe('s1');
});
