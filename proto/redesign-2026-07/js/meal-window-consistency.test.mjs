/* Meal windows say ONE thing across every surface.

   Founder-reported bug: Home read "Dinner · Upcoming · Opens 6:00 PM" while the camera header
   for the same tap read "Log Dinner · Due by 5:00 PM · earn up to 12 points". Two independent
   defects produced that one contradiction, and each is locked down here:

     1. The coach authors BOTH edges of a meal window, but only `due` survived into the athlete's
        standard. Every "Opens ..." line therefore quoted the built-in catalog forever — so a
        coach who moved dinner EARLIER left a window that opened an hour after it closed.
     2. The camera header printed S.logging's deadline, and S.logging re-derives its own slot by
        clock. Arriving from Home's Dinner row before the snack deadline printed the SNACK time
        under a "Log Dinner" header.

   The rule both encode: a slot's open edge is never later than its own deadline, and a named
   slot's deadline is that slot's, never the next-open slot's. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { stdFromItems, derive, fmtMin } from './requirements.js';
import { setDayStandard, slotOpen, slotDeadline, slotLateCredit, OPEN, DEADLINE } from './day.js';

const meal = (title, open, due, extra = {}) => ({ kind: 'meal', title, window: { open, due }, ...extra });
/* The shipped 4-meal standard, dinner moved to 5:00 PM by the coach. Snack keeps its 5:00 PM
   deadline, which is exactly what the camera used to leak into the Dinner header. */
const MOVED_DINNER = [
  meal('Breakfast', 7 * 60, 570),
  meal('Lunch', 12 * 60, 14 * 60),
  meal('Snack', null, 17 * 60, { snack: true }),
  meal('Dinner', 18 * 60, 17 * 60),
];

test('the coach\'s open edge rides into the standard, not just the deadline', () => {
  const std = stdFromItems(MOVED_DINNER);
  assert.equal(std.opens.breakfast, 7 * 60);
  assert.equal(std.opens.lunch, 12 * 60);
  assert.equal(std.opens.dinner, 18 * 60, 'the raw authored edge is carried verbatim');
  assert.ok(!('snack' in std.opens), 'a window with no open edge invents none');
});

test('a slot never opens after it is due', () => {
  const std = stdFromItems(MOVED_DINNER);
  setDayStandard(std);
  try {
    assert.equal(slotDeadline('dinner'), 17 * 60);
    assert.equal(slotOpen('dinner'), null, 'the 6:00 PM open is dropped, never printed against a 5:00 PM due');
    assert.equal(slotOpen('breakfast'), 7 * 60, 'an honest window is untouched');
    assert.equal(slotOpen('lunch'), 12 * 60);
  } finally { setDayStandard(null); }
});

test('the classic day is byte-identical — no standard, catalog edges stand', () => {
  setDayStandard(null);
  assert.equal(slotOpen('dinner'), OPEN.dinner);
  assert.equal(slotDeadline('dinner'), DEADLINE.dinner);
  assert.equal(slotOpen('breakfast'), OPEN.breakfast);
  assert.equal(slotOpen('snack'), null, 'snack has no open edge and never had one');
});

test('the Home row stops saying "Opens 6:00 PM" about a 5:00 PM deadline', () => {
  const std = stdFromItems(MOVED_DINNER);
  setDayStandard(std);
  try {
    const req = {
      id: 'dinner', title: 'Dinner', accent: 'b', proof: 'photo', freq: { type: 'daily' },
      window: { open: slotOpen('dinner'), due: slotDeadline('dinner') }, required: true,
    };
    const noon = derive(req, {}, 12 * 60);
    assert.notEqual(noon.status, 'Upcoming');
    assert.ok(!/Opens/.test(noon.sub), `row still advertises an open time: ${noon.sub}`);
    assert.equal(noon.sub, `Due by ${fmtMin(17 * 60)}`);
  } finally { setDayStandard(null); }
});

test('an untouched catalog window still reads "Upcoming · Opens ..." before it opens', () => {
  setDayStandard(null);
  const req = {
    id: 'dinner', title: 'Dinner', accent: 'b', proof: 'photo', freq: { type: 'daily' },
    window: { open: slotOpen('dinner'), due: slotDeadline('dinner') }, required: true,
  };
  const noon = derive(req, {}, 12 * 60);
  assert.equal(noon.status, 'Upcoming');
  assert.equal(noon.sub, `Opens ${fmtMin(OPEN.dinner)}`);
});

/* --- the camera header --- */

/* mealDueLabel lives in state.js, which pulls the whole app (supabase client, DOM globals) on
   import. Its two inputs are the standard's `optional` list and slotDeadline, so the contract is
   re-stated against those directly: whatever slot you name, you get THAT slot's deadline. */
const mealDueLabelFor = (k, std) => {
  const optional = std ? (std.optional || []).includes(k) : !['breakfast', 'lunch', 'dinner'].includes(k);
  if (optional) {
    const dl = slotDeadline(k, std);
    // "Whenever" only under a late-forgives-all policy; otherwise the late-credit clock is real.
    return (dl != null && slotLateCredit(k, std) < 1) ? `Optional · full credit by ${fmtMin(dl)}` : 'Optional · counts whenever you log it';
  }
  const dl = slotDeadline(k, std);
  return dl != null ? `Due by ${fmtMin(dl)}` : 'Log when ready';
};

test('a named slot quotes its OWN deadline, never the next-open slot\'s', () => {
  const std = stdFromItems([
    meal('Breakfast', 7 * 60, 570), meal('Lunch', 12 * 60, 14 * 60),
    meal('Snack', null, 17 * 60, { snack: true }), meal('Dinner', 18 * 60, 20 * 60 + 30),
  ]);
  /* This is the founder's exact tap: Home says dinner is upcoming, the camera opens on
     `camera/dinner`, and the snack window is still open behind it. */
  assert.equal(mealDueLabelFor('dinner', std), `Due by ${fmtMin(20 * 60 + 30)}`);
  assert.notEqual(mealDueLabelFor('dinner', std), mealDueLabelFor('snack', std));
});

test('an optional slot says so instead of quoting a deadline it cannot miss', () => {
  const std = stdFromItems([
    meal('Breakfast', 7 * 60, 570), meal('Lunch', 12 * 60, 14 * 60),
    meal('Snack', null, 17 * 60, { snack: true }), meal('Dinner', 18 * 60, 20 * 60 + 30),
  ]);
  assert.match(mealDueLabelFor('snack', std), /^Optional/);
  assert.match(mealDueLabelFor('snack', null), /^Optional/, 'the classic day treats snack the same');
});

test('a standard that requires its snack does get a deadline', () => {
  const std = stdFromItems([
    meal('Breakfast', 7 * 60, 570), meal('Lunch', 12 * 60, 14 * 60),
    meal('Post-practice fuel', null, 17 * 60), meal('Dinner', 18 * 60, 20 * 60 + 30),
  ]);
  assert.equal(mealDueLabelFor('snack', std), `Due by ${fmtMin(17 * 60)}`);
});
