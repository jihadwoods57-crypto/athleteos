/* When may the app ask for a star rating?
 *
 * Written before the implementation, because this is the whole feature: the prompt itself is four
 * lines of bridge call, and every way it can go wrong is a missing guard. It is also the one part
 * that is genuinely untestable in production — iOS never reports whether a review happened, and it
 * silently discards the prompt after three asks per user per year. An ask spent on someone having a
 * bad day is gone, invisibly, for a year.
 *
 * So the predicate is pure and the tests are the specification.
 * Run: node --test proto/redesign-2026-07/js/review-ask.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAskForReview, MILESTONES, ASK_COOLDOWN_DAYS } from './review-ask.js';

/** A day that has earned the ask: a milestone streak, on standard, nothing broken. */
const good = (over = {}) => ({
  streakDays: 7,
  score: 92,
  onStandard: true,
  milestoneShown: true,
  analysisFailed: false,
  syncIssue: null,
  online: true,
  lastAskedAt: null,
  now: Date.UTC(2026, 6, 29),
  ...over,
});

test('the earned moment asks', () => {
  assert.equal(shouldAskForReview(good()).ask, true);
  for (const streakDays of MILESTONES) {
    assert.equal(shouldAskForReview(good({ streakDays })).ask, true, `milestone ${streakDays} asks`);
  }
});

test('only at a milestone — an ordinary good day is not an occasion', () => {
  for (const streakDays of [1, 2, 6, 8, 12, 29, 31, 64, 99, 101]) {
    const r = shouldAskForReview(good({ streakDays }));
    assert.equal(r.ask, false, `day ${streakDays} must not ask`);
    assert.equal(r.reason, 'not-a-milestone');
  }
});

test('never on a day that is not on standard', () => {
  // The single most expensive mistake available: asking someone to rate you on a day they missed.
  const r = shouldAskForReview(good({ onStandard: false, score: 61 }));
  assert.equal(r.ask, false);
  assert.equal(r.reason, 'day-not-on-standard');
});

test('never after something broke', () => {
  assert.equal(shouldAskForReview(good({ analysisFailed: true })).reason, 'recent-failure');
  assert.equal(shouldAskForReview(good({ syncIssue: 'error' })).reason, 'recent-failure');
  assert.equal(shouldAskForReview(good({ syncIssue: 'blocked' })).reason, 'recent-failure');
  assert.equal(shouldAskForReview(good({ online: false })).reason, 'offline');
});

test('never without the milestone moment that earns it', () => {
  // The ask rides the "Day N locked" stamp. No stamp, no ask — it must never arrive cold.
  const r = shouldAskForReview(good({ milestoneShown: false }));
  assert.equal(r.ask, false);
  assert.equal(r.reason, 'no-moment');
});

test('at most one ask per cooldown, even across milestones', () => {
  const now = Date.UTC(2026, 6, 29);
  const day = 86400000;

  const justAsked = shouldAskForReview(good({ now, lastAskedAt: now - day }));
  assert.equal(justAsked.ask, false);
  assert.equal(justAsked.reason, 'asked-recently');

  const inside = shouldAskForReview(good({ now, lastAskedAt: now - (ASK_COOLDOWN_DAYS - 1) * day }));
  assert.equal(inside.ask, false, 'one day short of the cooldown still declines');

  const after = shouldAskForReview(good({ now, lastAskedAt: now - (ASK_COOLDOWN_DAYS + 1) * day, streakDays: 30 }));
  assert.equal(after.ask, true, 'past the cooldown, a later milestone may ask');
});

test('a 30-day athlete who was asked at 7 is not asked again inside the cooldown', () => {
  // The realistic sequence, and the one a naive "milestone => ask" would get wrong: 7 and 30 are
  // 23 days apart, well inside the cooldown, so the second milestone must stay silent.
  const day = 86400000;
  const askedAt7 = Date.UTC(2026, 6, 1);
  const at30 = askedAt7 + 23 * day;
  assert.equal(shouldAskForReview(good({ streakDays: 30, lastAskedAt: askedAt7, now: at30 })).ask, false);
  // …but 100 is far enough past it to be a fresh occasion.
  const at100 = askedAt7 + 130 * day;
  assert.equal(shouldAskForReview(good({ streakDays: 100, lastAskedAt: askedAt7, now: at100 })).ask, true);
});

test('garbage in never throws and never asks', () => {
  for (const bad of [undefined, null, {}, { streakDays: NaN }, { streakDays: '7' }, { streakDays: -3 }]) {
    const r = shouldAskForReview(bad);
    assert.equal(r.ask, false, `${JSON.stringify(bad)} must not ask`);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  }
});

test('the reason is always reportable, so a silent no is diagnosable', () => {
  // Every decline carries a machine-readable reason. Without this, "why did nobody get asked?" is
  // unanswerable in a system that cannot observe its own outcome.
  const r = shouldAskForReview(good({ onStandard: false }));
  assert.equal(typeof r.reason, 'string');
  assert.equal(shouldAskForReview(good()).reason, 'ok');
});
