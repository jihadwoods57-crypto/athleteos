// fmt-date.js — the one place a date becomes words.
//
// The 2026-09-05 audit found twelve near-identical local formatters and nine copies of the
// month/day name arrays across js/ and js/screens/. Each drifted a little (one hardcoded
// 'en-US', one used toLocaleString, three were byte-identical copies). A call site should
// import from here; if it needs a shape this file does not have, add the shape here rather
// than a local helper, so the next drift has nowhere to start.
//
// Every function accepts a Date, an epoch number, or an ISO/`YYYY-MM-DD` string. A bare
// `YYYY-MM-DD` is read as a LOCAL calendar day (new Date('2026-09-05') would be UTC midnight
// and print as the 4th west of Greenwich).

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Coerce anything date-like to a Date; null when it cannot be read. */
export function toDate(d) {
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
  if (typeof d === 'string') {
    const m = KEY_RE.exec(d);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  if (d == null || d === '') return null;
  const out = new Date(d);
  return isNaN(out.getTime()) ? null : out;
}

/** 'Sep 5' */
export function shortDate(d) {
  const x = toDate(d); if (!x) return '';
  return `${MONTHS_SHORT[x.getMonth()]} ${x.getDate()}`;
}

/** 'Sep 5, 2026' */
export function shortDateYear(d) {
  const x = toDate(d); if (!x) return '';
  return `${MONTHS_SHORT[x.getMonth()]} ${x.getDate()}, ${x.getFullYear()}`;
}

/** 'September 5, 2026' */
export function longDate(d) {
  const x = toDate(d); if (!x) return '';
  return `${MONTHS_LONG[x.getMonth()]} ${x.getDate()}, ${x.getFullYear()}`;
}

/** 'Sat' */
export function weekdayShort(d) {
  const x = toDate(d); if (!x) return '';
  return DAYS_SHORT[x.getDay()];
}

/** 'Saturday' */
export function weekdayLong(d) {
  const x = toDate(d); if (!x) return '';
  return DAYS_LONG[x.getDay()];
}

/** 'Sat, Sep 5' */
export function weekdayDate(d) {
  const x = toDate(d); if (!x) return '';
  return `${DAYS_SHORT[x.getDay()]}, ${MONTHS_SHORT[x.getMonth()]} ${x.getDate()}`;
}

/** 'Saturday, Sep 5'. The chat day separator's shape. */
export function weekdayLongDate(d) {
  const x = toDate(d); if (!x) return '';
  return `${DAYS_LONG[x.getDay()]}, ${MONTHS_SHORT[x.getMonth()]} ${x.getDate()}`;
}

/** 'September 2026' — the monthly report's title shape. */
export function monthYear(d) {
  const x = toDate(d); if (!x) return '';
  return `${MONTHS_LONG[x.getMonth()]} ${x.getFullYear()}`;
}

/** '7:52 AM' in the device locale's clock convention. */
export function clockTime(d) {
  const x = toDate(d); if (!x) return '';
  return x.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Local calendar key 'YYYY-MM-DD'. */
export function dateKey(d = new Date()) {
  const x = toDate(d); if (!x) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}
