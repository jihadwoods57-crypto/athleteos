// OnStandard — Connected Standards reminder copy.
//
// Zero framework imports on purpose: Deno runs it inside connected-standards-tick, and jest runs
// activity-copy.test.ts against the same file, the way _shared/rollcall-code.ts is shared.
//
// ⚠ THE NUMBERS COME FROM THE PLATFORM, NOT FROM A MODEL.
// This is template copy over values SQL already computed. No AI is involved in v1 and the
// constitution the AI functions document applies here in advance: the platform owns the number,
// and anything that narrates it may never compute it.
//
// ⚠ MIRRORS proto/redesign-2026-07/js/connected-standards.js.
// Canonical units (metres for distance, counts and minutes otherwise) and the formatting rules
// are duplicated because a WebView ES module cannot be imported by Deno. Both sides are pinned to
// the same vectors by their own tests — if you change a rule here, change it there.

const METRES_PER_MILE = 1609.344;
const METRES_PER_KM = 1000;

export function groupThousands(n: number): string {
  const neg = n < 0;
  const [whole, frac] = Math.abs(n).toString().split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac ? '.' + frac : ''}`;
}

export function toDisplay(value: number, metric: string, unit: string): number {
  const v = Number(value) || 0;
  if (metric !== 'distance') return v;
  return unit === 'km' ? v / METRES_PER_KM : v / METRES_PER_MILE;
}

export function fmtValue(value: number, metric: string, unit: string): string {
  const d = toDisplay(value, metric, unit);
  if (metric === 'distance') {
    const rounded = Math.round(d * 100) / 100;
    return groupThousands(Number(rounded.toFixed(2).replace(/\.?0+$/, '')));
  }
  return groupThousands(Math.round(d));
}

export function unitNoun(metric: string, unit: string, value: number): string {
  const one = Math.abs(Math.round(toDisplay(value, metric, unit))) === 1;
  if (metric === 'steps') return one ? 'step' : 'steps';
  if (metric === 'distance') return unit === 'km' ? 'km' : 'mi';
  if (metric === 'workouts') return one ? 'workout' : 'workouts';
  return 'min';
}

/** "9:00 PM" in the athlete's zone. Falls back to no clause rather than a wrong time. */
export function clockAt(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone, hour: 'numeric', minute: '2-digit',
    }).format(new Date(t));
  } catch { return ''; }
}

export type DueRow = {
  title: string;
  metric: string;
  display_unit: string;
  target: number;
  progress: number;
  period: string;
  period_start: string;
  period_end: string;
  deadline_at: string | null;
};

/**
 * The nudge. Two shapes, because a day and a week are different problems:
 *   daily  — how much is left, and by when
 *   weekly — what it takes PER DAY to still finish, which is the number that actually decides
 *            whether someone acts today or writes the week off
 *
 * Never sent to anyone already at target; claim_due_connected_standard_reminders filters those
 * out in SQL, so this function is never asked to write "0 steps to go".
 */
export function reminderCopy(row: DueRow, nowISO: string, timeZone = 'America/New_York'):
  { title: string; body: string } {
  const remaining = Math.max(0, Number(row.target) - Number(row.progress));
  const left = `${fmtValue(remaining, row.metric, row.display_unit)} ${unitNoun(row.metric, row.display_unit, remaining)}`;
  const by = clockAt(row.deadline_at, timeZone);

  if (row.period === 'week') {
    const end = Date.parse(String(row.period_end) + 'T12:00:00Z');
    const now = Date.parse(String(nowISO).slice(0, 10) + 'T12:00:00Z');
    const daysLeft = Math.max(1, Math.round((end - now) / 86400000) + 1);
    const perDay = remaining / daysLeft;
    const per = `${fmtValue(perDay, row.metric, row.display_unit)} ${unitNoun(row.metric, row.display_unit, perDay)}`;
    return {
      title: row.title,
      body: daysLeft === 1
        ? `Last day — ${left} to go.`
        : `${left} to go with ${daysLeft} days left. About ${per} a day gets you there.`,
    };
  }

  return {
    title: row.title,
    body: by ? `${left} to go by ${by}.` : `${left} to go today.`,
  };
}
