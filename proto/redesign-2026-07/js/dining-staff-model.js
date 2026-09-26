/* Dining halls, the staff side's rules (goals and eating plan, phase C, 2026-09-26).
 *
 * Who may manage halls and menus, how a hall's days read (draft, published, changes waiting), how
 * its hours read, and what an item's line says. Pure: no DOM, no network. The screens live in
 * screens/dining-halls.js and the coach Home control in dining-coach.js; the database is the wall
 * (0255: can_set_team_phase on every write, publish only through publish_dining_day).
 */
import { canSetTargets } from './staff-access.js';
import { PERIODS, PERIOD_KEYS, periodLabel, cleanHours, hmToMin, clockLabel, ITEM_KINDS } from './dining-menu.js';

/** Staff who edit the team's standard, on a team whose plan is live (0223 caps.standards). Fails
 *  CLOSED while the role loads, like the season control: view-only staff never see it. */
export function canManageDining(role, caps, kind = 'team') {
  return kind === 'team' && !!(caps && caps.standards) && canSetTargets(role);
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon, Sep 28". */
export function fmtDay(iso) {
  const t = Date.parse(`${iso}T12:00:00Z`);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${DAY_SHORT[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** [1,2,3,4,5] -> "Mon to Fri"; every day, weekends, or a short list. */
export function daysLabel(days) {
  const d = [...new Set((days || []).map(Number))].filter((x) => x >= 0 && x <= 6).sort((a, b) => a - b);
  const k = d.join('');
  if (k === '0123456') return 'Every day';
  if (k === '12345') return 'Mon to Fri';
  if (k === '06') return 'Weekends';
  // A run of three or more days in a row reads as a range: "Sun to Thu".
  if (d.length >= 3 && d.every((x, i) => i === 0 || x === d[i - 1] + 1)) return `${DAY_SHORT[d[0]]} to ${DAY_SHORT[d[d.length - 1]]}`;
  return d.map((x) => DAY_SHORT[x]).join(', ');
}

/** The hall's hours as lines: "Lunch · Every day · 11 AM to 2 PM". A period with no hours is not
 *  listed; none at all reads "No hours set". */
export function hoursLines(hours) {
  const rules = cleanHours(hours);
  if (!rules.length) return ['No hours set'];
  const order = (p) => PERIOD_KEYS.indexOf(p);
  return rules.slice().sort((a, b) => order(a.period) - order(b.period))
    .map((r) => `${periodLabel(r.period)} · ${daysLabel(r.days)} · ${clockLabel(hmToMin(r.from))} to ${clockLabel(hmToMin(r.to))}`);
}

/** The hours editor's rows: one per period, from the stored rules (the first rule per period). */
export function hoursForm(hours) {
  const rules = cleanHours(hours);
  return PERIODS.map((p) => {
    const r = rules.find((x) => x.period === p.key);
    return r ? { period: p.key, on: true, from: r.from, to: r.to, days: r.days.slice() }
      : { period: p.key, on: false, from: p.key === 'late' ? '20:00' : '', to: p.key === 'late' ? '23:00' : '', days: [0, 1, 2, 3, 4, 5, 6] };
  });
}

/** The editor's rows back into stored rules. Returns { hours } or { error } in plain words. */
export function hoursFromForm(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r || !r.on) continue;
    const label = periodLabel(r.period) || 'A period';
    const f = hmToMin(r.from);
    const t = hmToMin(r.to);
    if (f === null || t === null) return { error: `${label} needs a start and an end time.` };
    if (t <= f) return { error: `${label} has to end after it starts.` };
    if (!r.days || !r.days.length) return { error: `${label} needs at least one day.` };
    out.push({ period: r.period, days: r.days.slice().sort((a, b) => a - b), from: r.from, to: r.to });
  }
  return { hours: cleanHours(out) };
}

/**
 * A hall's menu rows grouped by date, newest week first:
 *   [{ date, periods: { lunch: { draft, published } }, hasDraft, hasPublished }]
 */
export function dayGroups(rows) {
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.menu_date || !PERIOD_KEYS.includes(r.period)) continue;
    const g = by.get(r.menu_date) || { date: r.menu_date, periods: {}, hasDraft: false, hasPublished: false };
    const slot = g.periods[r.period] || { draft: null, published: null };
    if (r.status === 'published') { slot.published = r; g.hasPublished = true; } else { slot.draft = r; g.hasDraft = true; }
    g.periods[r.period] = slot;
    by.set(r.menu_date, g);
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** One day's state: 'draft' (nothing live), 'published', or 'changes' (live, with a draft waiting). */
export function dayState(g) {
  if (!g) return 'none';
  if (g.hasDraft && g.hasPublished) return 'changes';
  if (g.hasPublished) return 'published';
  return g.hasDraft ? 'draft' : 'none';
}
export const DAY_STATE_LABEL = { draft: 'Draft', published: 'Published', changes: 'Changes waiting', none: 'No menu' };

/** The periods a day carries, in order, as words: "Breakfast, Lunch, Dinner". */
export function dayPeriods(g) {
  return PERIOD_KEYS.filter((p) => g && g.periods[p]).map(periodLabel).join(', ');
}

/** The line under a hall on the halls list, from today's rows for it. */
export function todayLine(rows, today) {
  const g = dayGroups((rows || []).filter((r) => r.menu_date === today))[0];
  if (!g) return 'No menu for today';
  const live = PERIOD_KEYS.filter((p) => g.periods[p] && g.periods[p].published).map(periodLabel);
  if (live.length) return `Today: ${live.join(', ')} live${g.hasDraft ? ' · changes waiting' : ''}`;
  return 'Today: a draft is waiting to be published';
}

/**
 * What the day screen offers. Publish only over a draft; Unpublish only over a live menu; editing,
 * publishing and discarding only for staff who manage dining (the database refuses everyone else
 * anyway: 0255 publish_dining_day / unpublish_dining_day and the draft-only write policies).
 */
export function dayControls(g, canManage) {
  const m = !!canManage && !!g;
  return {
    edit: m,
    publish: m && !!g.hasDraft,
    unpublish: m && !!g.hasPublished,
    discard: m && !!g.hasDraft,
  };
}

/** Which rows the day screen shows for a period: the draft when there is one (that is what staff
 *  are editing), else the published menu. */
export function shownRow(slot) {
  return slot ? (slot.draft || slot.published || null) : null;
}

/** An item's line for staff (staff always see the estimates): "Grill · Protein · 35g protein · 280 cal". */
export function itemMeta(it) {
  const s = it && it.per_serving ? it.per_serving : null;
  const kind = (ITEM_KINDS.find((k) => k.key === (it && it.kind)) || {}).label;
  const bits = [it && it.station, kind];
  if (s && s.protein != null) bits.push(`${s.protein}g protein`);
  if (s && s.kcal != null) bits.push(`${s.kcal} cal`);
  if (!s) bits.push('No figures');
  return bits.filter(Boolean).join(' · ');
}

/** What a failed upload says to staff, from the function's error code. */
export function uploadErrorLine(code) {
  switch (code) {
    case 'limit': return "Your team has used today's menu reads. Try again tomorrow.";
    case 'capacity': return 'Menu reading is busy right now. Tap Read the menu again in a few minutes.';
    case 'already_read': return 'That upload was already read. Its days are listed below.';
    case 'plan_required': return 'Menu reading needs an active team plan.';
    case 'forbidden': return 'Only staff who edit the team standard can upload menus.';
    case 'too_large': return 'That upload is too big. Try fewer photos or a smaller PDF.';
    case 'bad_file': return "That file couldn't be read. Use photos (JPG or PNG) or a PDF.";
    case 'too_long': return 'That menu is too long to read in one go. Upload a week at a time.';
    case 'ai_consent_required': return 'Turn on Nia in Privacy on your Profile to read menus.';
    case 'upload': return "The files didn't upload. Check your connection and try again.";
    default: return "Couldn't read the menu. Check your connection and try again.";
  }
}

/** The result line after a read. */
export function readResultLine(body) {
  const n = body && Number(body.entries);
  if (!n) return "We couldn't find a menu in that upload. Try a clearer photo or paste the text.";
  const days = Array.isArray(body.days) ? body.days.length : 0;
  return `Read ${days} day${days === 1 ? '' : 's'} and ${body.items} item${body.items === 1 ? '' : 's'}. Review each day, then publish it.`;
}

/** A blank item for the editor. */
export const BLANK_ITEM = { name: '', station: null, kind: 'protein', per_serving: null, tags: [] };
