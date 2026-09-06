/* fmt-date.js is the one place a date becomes words. Every export is pinned here, and so is the
 * rule that makes the module safe to hand a `YYYY-MM-DD` key: a bare key is a LOCAL calendar
 * day, never UTC midnight, so it prints the same day west of Greenwich as it does east. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MONTHS_SHORT, MONTHS_LONG, DAYS_SHORT, DAYS_LONG,
  toDate, shortDate, shortDateYear, longDate, weekdayShort, weekdayLong, weekdayDate,
  weekdayLongDate, monthYear, clockTime, dateKey,
} from './fmt-date.js';

// Saturday, 5 September 2026, 7:52 in the morning, LOCAL time.
const SAT = new Date(2026, 8, 5, 7, 52);

test('name tables are complete and start at Jan / Sun', () => {
  assert.equal(MONTHS_SHORT.length, 12);
  assert.equal(MONTHS_LONG.length, 12);
  assert.equal(DAYS_SHORT.length, 7);
  assert.equal(DAYS_LONG.length, 7);
  assert.equal(MONTHS_SHORT[0], 'Jan');
  assert.equal(MONTHS_LONG[11], 'December');
  assert.equal(DAYS_SHORT[0], 'Sun');
  assert.equal(DAYS_LONG[6], 'Saturday');
});

test('toDate reads a Date, an epoch, an ISO string, and refuses junk', () => {
  assert.equal(toDate(SAT), SAT);
  assert.equal(toDate(SAT.getTime()).getTime(), SAT.getTime());
  assert.equal(toDate(SAT.toISOString()).getTime(), SAT.getTime());
  assert.equal(toDate(null), null);
  assert.equal(toDate(undefined), null);
  assert.equal(toDate(''), null);
  assert.equal(toDate('garbage'), null);
  assert.equal(toDate(new Date(NaN)), null);
});

test('a bare YYYY-MM-DD key is a LOCAL calendar day, not UTC midnight', () => {
  const d = toDate('2026-09-05');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 5);
  assert.equal(d.getHours(), 0);
  // The whole point: the key prints as its own day in every timezone.
  assert.equal(shortDate('2026-09-05'), 'Sep 5');
  assert.equal(weekdayDate('2026-09-05'), 'Sat, Sep 5');
  assert.equal(dateKey('2026-09-05'), '2026-09-05');
  // A key with a time attached is an ISO string and takes the normal path.
  assert.equal(toDate('2026-09-05T12:00:00').getHours(), 12);
});

test('every shape prints its documented example', () => {
  assert.equal(shortDate(SAT), 'Sep 5');
  assert.equal(shortDateYear(SAT), 'Sep 5, 2026');
  assert.equal(longDate(SAT), 'September 5, 2026');
  assert.equal(weekdayShort(SAT), 'Sat');
  assert.equal(weekdayLong(SAT), 'Saturday');
  assert.equal(weekdayDate(SAT), 'Sat, Sep 5');
  assert.equal(weekdayLongDate(SAT), 'Saturday, Sep 5');
  assert.equal(monthYear(SAT), 'September 2026');
  assert.equal(dateKey(SAT), '2026-09-05');
});

test('clockTime is the device clock convention and carries the minutes', () => {
  const s = clockTime(SAT);
  assert.match(s, /52/);
  assert.match(s, /^0?7:52/);
});

test('dateKey pads month and day and defaults to now', () => {
  assert.equal(dateKey(new Date(2026, 0, 9)), '2026-01-09');
  assert.match(dateKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test('every formatter returns the empty string for junk', () => {
  for (const f of [shortDate, shortDateYear, longDate, weekdayShort, weekdayLong, weekdayDate, weekdayLongDate, monthYear, clockTime, dateKey]) {
    assert.equal(f('garbage'), '', f.name);
    assert.equal(f(null), '', f.name);
  }
});
