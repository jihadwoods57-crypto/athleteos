/* The seven-bar week, as ONE builder.
 *
 * Progress drew this chart inline, and it is the one picture in the app written for the reader
 * who wants the shape of a week at a glance: seven day tracks, a dashed line at the standard,
 * each bar filled to its score and coloured by its TIER (`t-g/b/a/r`, the same ladder as every
 * other score; below 60 stays neutral on this chart by the documented no-red ruling). The parent hub needs exactly that and
 * had been showing one number and a school letter instead. Extracted verbatim from
 * screens/progress.js (2026-09-22) so both screens draw the same chart; the look lives in the
 * `.weekbars` / `.wb` rules in css/screens.css, which the Progress screen owns.
 *
 * `scores` and `labels` are parallel arrays, oldest first. `cutIdx` (optional) draws the
 * scoring-cutover divider before that bar. `gaps: true` renders a null score as an EMPTY track
 * (a calendar day with no log, which the parent view has and Progress never passes); without
 * it, the original Progress behaviour is kept byte for byte. */
import { esc } from './components.js';
import { scoreBand, tierFor } from './score-band.js';
import { dateKey } from './fmt-date.js';
import { icon } from './icons.js';

/** The `n` calendar days ending on `todayKey` ('YYYY-MM-DD', local), oldest first, each with the
 *  score logged that day or null. A day with no row is a day with no log: it stays in the week as
 *  an empty track rather than the week silently closing up around it. `rows` are
 *  `{ day | date, score }` (the guardian_child_days shape). */
export function calendarWeek(rows, todayKey, n = 7) {
  const byDay = new Map((rows || []).map((r) => [String(r.day || r.date || '').slice(0, 10), r.score]));
  const [y, m, d] = String(todayKey).split('-').map(Number);
  const out = [];
  for (let back = n - 1; back >= 0; back--) {
    const dt = new Date(y, m - 1, d - back);
    const key = dateKey(dt);
    const s = byDay.get(key);
    out.push({ key, label: 'SMTWTFS'[dt.getDay()], score: s == null ? null : Number(s) });
  }
  return out;
}

/** Whole calendar days from `dayKey` to `todayKey` (0 = today), or null when either is missing. */
export function daysBetween(dayKey, todayKey) {
  const k = (s) => { const [y, m, d] = String(s || '').slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const a = k(dayKey), b = k(todayKey);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 864e5) : null;
}

/** One bar, filled to its score: both builders draw it the same way. */
const bar = (v) => `<div class="bar" style="height:${Math.max(0, Math.min(100, v))}%"></div>`;

export function weekBars({ scores = [], labels = [], cutIdx = -1, cutLabel = '', gaps = false } = {}) {
  const spoken = scores.map((v, i) => `${labels[i] || ''} ${gaps && v == null ? 'no log' : v}`).join(', ');
  return `<div class="weekbars" role="img" aria-label="Last ${scores.length} days: ${spoken}. The standard is 80.${cutIdx !== -1 ? ` ${esc(cutLabel)}.` : ''}">
        ${scores.map((v, i) => `
          ${i === cutIdx ? `<div class="wb-cutover" aria-hidden="true" title="${esc(cutLabel)}"></div>` : ''}
          <div class="wb b-${gaps && v == null ? 'none' : (scoreBand(v) || 'off')}${v == null ? '' : ` t-${tierFor(v).cls}`}">
            <div class="track">${gaps && v == null ? '' : bar(v)}</div>
            <span class="d">${labels[i] || ''}</span>
          </div>`).join('')}
      </div>`;
}

/** The athlete's own seven days, as Progress draws them (2026-09-23). `days` come from
 *  progressRead (js/progress-week.js): { label, score, state: 'scored'|'missed'|'before'|'today' }.
 *  Each bar prints its score above it in its tier colour, so the chart needs no colour legend; a
 *  missed day is an empty track with a red mark (red means missed, nothing else); a day before
 *  the athlete started is an empty, faded track; today is labelled Today and fills as it scores.
 *  Below 60 stays neutral, bar and number alike (the athlete's-own-history ruling). */
export function dayBars(days = [], { cutIdx = -1, cutLabel = '' } = {}) {
  const spoken = days.map((d) => {
    const name = d.state === 'today' ? 'today' : new Date(`${d.key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
    if (d.state === 'missed') return `${name} no log`;
    if (d.state === 'before') return `${name} before you started`;
    if (d.score == null) return `${name} not scored yet`;
    return `${name} ${d.score}${d.state === 'today' ? ' so far' : ''}`;
  }).join(', ');
  return `<div class="weekbars pg-days" role="img" aria-label="Last ${days.length} days: ${esc(spoken)}. The standard is 80.${cutIdx !== -1 ? ` ${esc(cutLabel)}.` : ''}">
        ${days.map((d, i) => {
          const cls = d.score != null ? tierFor(d.score).cls : '';
          const ink = cls && cls !== 'r' ? ` tier-ink ${cls}` : '';
          const top = d.state === 'missed' ? icon('x', 12) : d.score != null ? d.score : '';
          return `
          ${i === cutIdx ? `<div class="wb-cutover" aria-hidden="true" title="${esc(cutLabel)}"></div>` : ''}
          <div class="wb wb-${d.state}${cls ? ` t-${cls}` : ''}" aria-hidden="true">
            <span class="wb-n${ink}">${top}</span>
            <div class="track">${d.score != null ? bar(d.score) : ''}</div>
            <span class="d">${d.state === 'today' ? 'Today' : esc(d.label || '')}</span>
          </div>`;
        }).join('')}
      </div>`;
}
