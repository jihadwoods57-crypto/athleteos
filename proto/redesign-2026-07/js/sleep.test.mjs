// Sleep, phase 1: evidence, never points.
//
// The behavioural half of this suite exercises js/sleep.js directly (it is pure, so it can be).
// The source-shape half pins the screen, the way the other screen suites do.
//
// The rule these tests exist to defend: NOTHING HERE REACHES THE SCORE. day.js recoveryParts
// scores answered/enabled and not the values, because grading self-reported values rewarded the
// athlete who tapped 9s over the one who told the truth. Measured sleep is separate precisely
// because nobody authors a wearable, and a coach-assigned Recovery Standard (phase 2) gets its own
// component beside wakeup rather than joining recoveryParts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  fmtDuration, qualityWord, chipOf, baselineOf, baselineState, nightsUntilBaseline,
  deltaFrom, buildNights, sleepState, BASELINE_PROVISIONAL,
} from './sleep.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const screen = read('screens/sleep.js');
const registry = read('screens/index.js');
const recovery = read('screens/recovery.js');
const css = read('../css/screens.css');

test('durations read the way a person says them', () => {
  assert.equal(fmtDuration(7.67), '7h 40m');
  assert.equal(fmtDuration(8), '8h');
  assert.equal(fmtDuration(0.8), '48m');
  // Nothing is not zero. An absent reading must render as absent, never as "0h".
  assert.equal(fmtDuration(null), '');
  assert.equal(fmtDuration(0), '');
  assert.equal(fmtDuration(undefined), '');
});

test('the check-in answer is halved from the stored 0 to 10 scale, not read raw', () => {
  // state.js: "5 chips map to the engine's 0-10 scale as 2/4/6/8/10". Reading ci.sleep as if it
  // were the chip number prints the wrong word for every answer above the first.
  assert.equal(chipOf(2), 1);
  assert.equal(chipOf(10), 5);
  assert.equal(qualityWord(2), 'Poor');
  assert.equal(qualityWord(10), 'Great');
  assert.equal(qualityWord(8), 'Good');
  assert.equal(qualityWord(null), '');
  assert.equal(qualityWord(0), '');
});

test('an average needs enough nights to be one', () => {
  const few = [7, 8, 6].map((h) => ({ hours: h }));
  assert.equal(baselineOf(few), null, 'three nights is not an average');
  assert.equal(baselineState(few), 'none');
  assert.equal(nightsUntilBaseline(few), BASELINE_PROVISIONAL - 3);

  const week = Array.from({ length: 7 }, () => ({ hours: 7 }));
  assert.equal(baselineOf(week), 7);
  assert.equal(baselineState(week), 'provisional');

  const fortnight = Array.from({ length: 14 }, () => ({ hours: 7 }));
  assert.equal(baselineState(fortnight), 'established');
});

test('a self-reported quality can never enter the measured average', () => {
  // A rating is not an amount of sleep. Seven nights of "Great" with no wearable is still no data.
  const saidOnly = Array.from({ length: 10 }, () => ({ hours: null, quality: 10 }));
  assert.equal(baselineOf(saidOnly), null);
  assert.equal(baselineState(saidOnly), 'none');
});

test('a night nobody measured has no delta, because unknown is not zero', () => {
  assert.equal(deltaFrom(null, 7.5), null);
  assert.equal(deltaFrom(6, null), null);
  const under = deltaFrom(6.2, 7.5);
  assert.equal(under.dir, 'under');
  assert.match(under.text, /under your average/);
  assert.equal(deltaFrom(8.2, 7.5).dir, 'over');
  // Twenty minutes is not a finding; sleep is not measured finely enough for that.
  assert.equal(deltaFrom(7.4, 7.5).dir, 'level');
});

test('a night with neither axis is dropped, and one with either is kept', () => {
  const nights = buildNights(['2026-09-18', '2026-09-17', '2026-09-16'],
    { '2026-09-18': 7.2 }, { '2026-09-17': 8 });
  assert.equal(nights.length, 2, 'the night with no evidence at all is not an event');
  assert.equal(nights[0].measured, true);
  assert.equal(nights[1].measured, false);
  assert.equal(nights[1].quality, 8, 'quality stays in its stored 0 to 10 form');
});

test('the screen state names every case, including the majority one', () => {
  const measured = Array.from({ length: 9 }, () => ({ hours: 7 }));
  const said = Array.from({ length: 9 }, () => ({ hours: null, quality: 8 }));
  assert.equal(sleepState({ available: false, nights: said }), 'no-device');
  assert.equal(sleepState({ available: true, nights: said }), 'no-data');
  assert.equal(sleepState({ available: true, nights: [{ hours: 7 }] }), 'learning');
  assert.equal(sleepState({ available: true, nights: measured }), 'reading');
});

test('the average is not offered where measurement is impossible', () => {
  // "6 more measured nights" to an athlete with no wearable promises nights that never arrive.
  assert.match(screen, /if \(screenState === 'no-device' \|\| screenState === 'no-data'\) return '';/);
});

test('a gap is only named once measuring is the habit', () => {
  // Printing "No reading" down all fourteen rows of someone who has never measured anything
  // shouts an absence they cannot fix and buries the record they do have.
  assert.match(screen, /markGaps \? '<div class="sl-dur none">No reading<\/div>' : ''/);
  assert.match(screen, /state === 'reading'\)\)\.join\(''\)/);
});

test('sleep is registered but deliberately unlinked while 1.0 is in review', () => {
  assert.match(registry, /sleep: lazy\(\(\) => import\('\.\/sleep\.js'\)\)/);
  // Nothing in a shipped screen may point at it yet. The check-in anchor is NOT a link.
  const linked = [read('screens/profile.js'), read('screens/settings.js'), read('screens/home.js')]
    .filter((f) => /data-go="sleep"|__go\('sleep'\)/.test(f));
  assert.equal(linked.length, 0, 'a shipped surface now links to #sleep; that is a founder decision');
});

test('the check-in anchor is inert without a reading, and never adds a tap', () => {
  // Rendered empty and hidden; mount fills it only when a device actually reported.
  assert.match(recovery, /id="rec-sleep-anchor" hidden/);
  assert.match(recovery, /f\.key === 'sleep' \?/);
  assert.match(recovery, /roles\.healthRead\(\)/);
  // It is read-only context, so it must not be a control.
  assert.ok(!/rec-sleep-anchor[^]*?<button/.test(recovery.slice(recovery.indexOf('rec-sleep-anchor'), recovery.indexOf('rec-sleep-anchor') + 400)));
});

test('the screen obeys the design system where it would be easiest not to', () => {
  // The ring sweep is reserved for the six score surfaces. Sleep does not score, so it may not wear it.
  assert.ok(!/--ring-[abc]/.test(css.slice(css.indexOf('/* ===== Sleep (#sleep)'))));
  // Amber is warning only and a short night is a fact; red is missed and this cannot be missed.
  const block = css.slice(css.indexOf('/* ===== Sleep (#sleep)'));
  assert.ok(!/--amber|--red/.test(block), 'a night under your average is not a warning or a miss');
  assert.match(block, /\.sl-delta\.under \{ color: var\(--purple-bright\)/);
  // New files start at a ratchet ceiling of zero: no inline styles, no em dashes.
  assert.equal((screen.match(/style="/g) || []).length, 0);
  assert.ok(!screen.includes('—'));
  assert.ok(!read('sleep.js').includes('—'));
});

test('the screen never claims sleep is unscored once a standard is assigned', () => {
  // Phase 1 said "Sleep is not scored" and phase 2 made that false. An app that misreports what
  // counts toward a score is the one thing PRODUCT.md's honest-accountability rule forbids.
  assert.match(screen, /DAY\.sleepStandard && Number\(DAY\.sleepStandard\.targetHours\) > 0/);
  assert.match(screen, /measured hours count toward your day/);
  assert.match(screen, /Sleep is not scored for you/);
});

test('an assigned standard with no reading reads as NOT COUNTED, never as a failure', () => {
  // A ring on a charger is not evidence. This is the state most of a roster will be in.
  assert.match(screen, /leaves your score alone/);
  assert.match(screen, /status-pill muted">Not counted/);
});

test('one hero per screen: the average steps down when a standard is present', () => {
  // Two --t-3xl numerals stacked gave the eye no way to tell which number it was being held to.
  assert.match(screen, /\$\{hasStandard \? '' : avgBlock\(nights, state\)\}/);
  assert.match(screen, /your average \$\{esc\(baseLine\)\}/);
});

test('the roster shows exceptions, not a badge on everyone', () => {
  // The sleep chip lived only on the Copilot screen, which no screen linked to; the route was
  // unregistered in the 2026-09-23 review pass and the chip went with it.
  assert.doesNotMatch(read('screens/coach.js'), /Sleep short|Sleep missed/);
  // A met standard is still carried in the DATA; it just does not earn a row of text on a list
  // whose entire job is who needs attention.
  assert.match(read('roles.js'), /if \(hours >= target\) return 'met';/);
});
