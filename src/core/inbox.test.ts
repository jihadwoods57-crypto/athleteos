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
