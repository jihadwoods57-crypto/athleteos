/* The morning, reduced to the numbers every wake-up surface reads.
 *
 * The roll call already computes the hard part: the server stamps a `verdict` per athlete per
 * morning (rollcall_verdict, migration 0212) and the client must never second-guess it. This
 * module only projects that array into the shapes the screens want, so the coach summary, the
 * squad list and the athlete's own streak can never disagree about the same morning.
 *
 * Dependency-free on purpose, like score-band.js: pure data in, pure data out, so it is unit
 * tested rather than pinned by reading the source of a screen.
 *
 * RELEASE 1 HAS NO SNOOZE. The roll-call engine has no concept of one: an athlete answered on
 * time, answered late, or never answered. Snooze counts arrive with the real alarm, because only
 * an alarm the app owns can see one. Do not add a snoozed count here from a guess.
 */

/** The commitment type a coach wake-up uses. Mirrors commitments.js TYPE_LABEL. */
export const WAKEUP_TYPE = 'morning_roll_call';

const UP = 'on_standard';
const LATE = 'late';
const MISSED = 'missed';
const EXCUSED = 'excused';

function minuteOf(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
}

function shape(r) {
  return {
    athleteId: r.athlete_id || null,
    name: r.name || '',
    verdict: r.verdict || 'pending',
    at: r.acknowledged_at || null,
    atMin: minuteOf(r.acknowledged_at),
    lateMin: Number(r.late_min) || 0,
  };
}

/**
 * Every number one morning yields.
 * @param {object|null} instance a commitment_board instance, or anything at all
 * @returns {{total:number, onTime:number, late:number, missed:number, pending:number,
 *            excused:number, firstUp:{name:string,at:string,atMin:number}|null,
 *            needsYou:Array, upRows:Array}}
 */
export function morningSummary(instance) {
  const raw = (instance && Array.isArray(instance.rows)) ? instance.rows : [];
  const rows = raw.map(shape);

  /* 'excused' leaves the denominator entirely — it cannot be scored honestly either way. That is
     the same rule commitments.js accountability() already applies, and the two must not diverge. */
  const counted = rows.filter((r) => r.verdict !== EXCUSED);
  const upRows = counted.filter((r) => r.verdict === UP)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const lateRows = counted.filter((r) => r.verdict === LATE);
  const missedRows = counted.filter((r) => r.verdict === MISSED);

  /* Worst first: a missed morning needs the coach more than a late one, and among the late ones
     the one who answered latest needs them most. */
  const needsYou = [
    ...missedRows,
    ...lateRows.slice().sort((a, b) => (b.lateMin - a.lateMin) || String(a.name).localeCompare(String(b.name))),
  ];

  return {
    total: counted.length,
    onTime: upRows.length,
    late: lateRows.length,
    missed: missedRows.length,
    pending: counted.filter((r) => r.verdict !== UP && r.verdict !== LATE && r.verdict !== MISSED).length,
    excused: rows.length - counted.length,
    /* First up is an ON-TIME answer only. A late answer that happened to land early on the clock
       is still late, and naming it the morning's best would reward the wrong thing. */
    firstUp: upRows.length ? { name: upRows[0].name, at: upRows[0].at, atMin: upRows[0].atMin } : null,
    needsYou,
    upRows,
  };
}

/**
 * Consecutive answered mornings, counting back from the most recent.
 * @param {boolean[]|null} days newest first; true = answered inside the window
 */
export function morningStreak(days) {
  if (!Array.isArray(days)) return 0;
  let n = 0;
  for (const answered of days) { if (!answered) break; n += 1; }
  return n;
}

/** "5:46" from a minute-of-day. Shared by every wake-up surface so they never drift apart. */
export function wakeClock(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}`;
}
