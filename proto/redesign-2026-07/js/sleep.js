/* OnStandard, sleep: the two axes, and the baseline that makes either of them mean anything.
 *
 * SLEEP IS EVIDENCE, NOT POINTS (phase 1, 2026-09-18). Nothing in this module reaches the score.
 * The nightly check-in already scores the ACT of answering (day.js recoveryParts: answered/enabled,
 * never the values, because grading the values rewarded the athlete who tapped 9s over the one who
 * told the truth). That ruling stands, and it is exactly why measured sleep is a separate thing:
 * nobody authors an Oura ring, so a measurement cannot be gamed the way a self-report can. When a
 * coach-assigned Recovery Standard lands (phase 2) it gets its OWN component beside wakeup, with
 * its own `assigned` flag, and it still does not join recoveryParts.
 *
 * TWO AXES, NEVER ONE. The wearable answers "how long were you asleep". The check-in asks
 * "Sleep quality: Poor to Great" (state.js), which is how it FELT. Those come apart constantly and
 * the gap is the most useful thing here, so neither substitutes for the other and a night carries
 * whichever of the two it has.
 *
 * THE BASELINE IS THE ATHLETE'S OWN. Seven hours is not a fact about a person; seven hours against
 * their own seven-and-a-half is. Population norms never appear.
 */

/** Nights of MEASURED sleep needed before an average is worth stating at all. */
export const BASELINE_PROVISIONAL = 7;
/** Nights before that average stops carrying the provisional caveat. */
export const BASELINE_ESTABLISHED = 14;

/** A delta smaller than this reads as "about your normal" rather than a direction. Sleep is not
 *  measured finely enough for twenty minutes to be a finding. */
const NOISE_HOURS = 0.5;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** "7h 40m" · "48m" · "" for nothing. Never "7.67h": nobody says that out loud. */
export function fmtDuration(hours) {
  if (!isNum(hours) || hours <= 0) return '';
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** The athlete's own average, over MEASURED nights only. A self-reported quality rating is not
 *  an amount of sleep and can never enter this mean. Null until there are enough nights to mean
 *  something, because an "average" of two nights is just one of the two nights with extra steps. */
export function baselineOf(nights) {
  const hrs = (nights || []).map((n) => n && n.hours).filter(isNum);
  if (hrs.length < BASELINE_PROVISIONAL) return null;
  return hrs.reduce((a, b) => a + b, 0) / hrs.length;
}

/** 'none' | 'provisional' | 'established': how much weight the average can carry. */
export function baselineState(nights) {
  const n = (nights || []).filter((x) => x && isNum(x.hours)).length;
  if (n < BASELINE_PROVISIONAL) return 'none';
  return n < BASELINE_ESTABLISHED ? 'provisional' : 'established';
}

/** How many more measured nights until the average can be stated. */
export function nightsUntilBaseline(nights) {
  const n = (nights || []).filter((x) => x && isNum(x.hours)).length;
  return Math.max(0, BASELINE_PROVISIONAL - n);
}

/**
 * The comparison line for one night against the athlete's own average.
 * `dir` is 'under' | 'over' | 'level' | null, so the caller picks the treatment and this module
 * never decides a colour. Null when either side is missing: an absent reading is UNKNOWN, and
 * saying "0h under" about a night nobody measured is the one lie this screen must not tell.
 */
export function deltaFrom(hours, baseline) {
  if (!isNum(hours) || !isNum(baseline)) return null;
  const diff = hours - baseline;
  if (Math.abs(diff) < NOISE_HOURS) return { dir: 'level', text: 'about your average' };
  const amount = fmtDuration(Math.abs(diff));
  return diff < 0
    ? { dir: 'under', text: `${amount} under your average` }
    : { dir: 'over', text: `${amount} over your average` };
}

/* The check-in's five chips are STORED ON THE ENGINE'S 0 TO 10 SCALE as 2/4/6/8/10 (state.js:
   "5 chips map to the engine's 0-10 scale as 2/4/6/8/10"). Reading ci.sleep as if it were the
   chip number would print "Poor" for a night the athlete rated Rough and nothing at all for the
   two top chips, so the halving is not a nicety. Anything outside the scale reads as no answer. */
const QUALITY_WORDS = { 1: 'Poor', 2: 'Rough', 3: 'Fair', 4: 'Good', 5: 'Great' };

/** Chip number 1 to 5 from a stored 0 to 10 answer, or null when there is no usable answer. */
export function chipOf(stored) {
  const n = Number(stored);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(5, Math.max(1, Math.round(n / 2)));
}

/** The word the check-in itself uses for this rating (state.js anchors: Poor to Great). */
export function qualityWord(stored) {
  const chip = chipOf(stored);
  return chip == null ? '' : QUALITY_WORDS[chip];
}

/**
 * Assemble the night list the screen renders.
 *
 * `measuredByDate` is what a wearable reported, keyed 'YYYY-MM-DD'; `qualityByDate` is the 1 to 5
 * the athlete tapped. Either may be empty, and the majority of a real roster has ONLY the second:
 * no wearable at all. That athlete still gets a record, still gets a screen, and is never shown an
 * empty room for owning no hardware.
 *
 * A date present in neither map is dropped rather than rendered as a blank night, because the
 * absence of any evidence is not an event.
 */
export function buildNights(dates, measuredByDate = {}, qualityByDate = {}) {
  return (dates || []).map((date) => {
    const raw = measuredByDate[date];
    const hours = isNum(raw) ? raw : null;
    // quality stays in its STORED 0 to 10 form; chipOf/qualityWord own the translation so the
    // scale is converted in exactly one place.
    const chip = chipOf(qualityByDate[date]);
    return {
      date,
      hours,
      quality: chip == null ? null : Number(qualityByDate[date]),
      measured: hours != null,
    };
  }).filter((n) => n.hours != null || n.quality != null);
}

/**
 * Which of the screen's shapes to draw. Kept here rather than in the screen so the states are
 * enumerable and testable, and so no branch can be added in markup without a name.
 *
 *   'no-device'   nothing measured, ever. Self-report is the whole record, honestly labelled.
 *   'no-data'     a device is connected but nothing has arrived (categories still off in Health).
 *   'learning'    measuring, too few nights to state an average.
 *   'reading'     measuring, average available.
 */
export function sleepState({ available, nights }) {
  const measured = (nights || []).filter((n) => n && n.hours != null).length;
  if (!available) return 'no-device';
  if (measured === 0) return 'no-data';
  return measured < BASELINE_PROVISIONAL ? 'learning' : 'reading';
}
