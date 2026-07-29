/* OnStandard — server notification feed mapping (pure; no state, no clock arguments hidden).
   The `notifications` table (0027) is written server-side only: coach nudges (send-push),
   join requests/approvals (0027 triggers), weekly digests (weekly-digest fn). This module
   turns those rows into the bell feed's row shape so the athlete/staff bell finally shows
   what the server recorded — before this, a coach nudge pushed to the phone but never
   appeared in the app. state.js merges the result with the locally-derived rows. */

/* kind → presentation. Unknown kinds (added by future migrations) fall back to a plain
   bell row instead of vanishing — the feed keeps working as the server grows. */
const KIND_META = {
  nudge: { icon: 'bell', level: 'high' },
  join_request: { icon: 'users', level: 'medium' },
  join_approved: { icon: 'check', level: 'positive' },
  digest: { icon: 'clipboard', level: 'medium' },
  announcement: { icon: 'share', level: 'info' },
  // The AI's own daily follow-up. Unlike the rows above it, this one IS a task: it opens a
  // conversation and expects a reply, so it deep-links to the meal it is about.
  ai_followup: { icon: 'sparkle', level: 'medium' },
};
const DEFAULT_META = { icon: 'bell', level: 'medium' };

/** '2m ago' · '3h ago' · 'Mon' · '' for junk. Compact, feed-style. */
export function fmtWhen(iso, nowMs) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return '';
  const mins = Math.max(0, Math.round((nowMs - t) / 60000));
  if (mins < 2) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  if (mins < 7 * 24 * 60) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(t).getDay()];
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One server row → the bell feed row shape ({level,title,body,when,icon,route,read}).
    Malformed rows map to null (dropped, never invented).

    Routes are deliberately none/home for most kinds: a server row is a RECORD, not a task, and
    deep-linking belongs to reminders. `ai_followup` is the exception and the reason `kind` may now
    carry a suffix (`ai_followup:<mealId>`) — the AI asked the athlete a question, so the row has
    to be able to open the thread where they can answer it. The suffix rides `kind` because it is
    free text (0027 has no CHECK), which keeps this a client change with no migration. */
export function feedRowFromServer(row, nowMs) {
  if (!row || typeof row !== 'object' || !row.title) return null;
  const rawKind = String(row.kind || '');
  const [baseKind, suffix] = rawKind.split(':');
  const meta = KIND_META[baseKind] || DEFAULT_META;
  return {
    id: row.id || null,
    level: meta.level,
    icon: meta.icon,
    title: String(row.title),
    body: String(row.body || ''),
    when: fmtWhen(row.created_at, nowMs),
    route: baseKind === 'ai_followup'
      // Only a well-formed id becomes a route — a junk suffix must render as a plain record, never
      // as a link into nowhere. Shape matches the native deep-link validator.
      ? (suffix && /^[a-z0-9-]{6,64}$/i.test(suffix) ? `meal-view/${suffix}` : null)
      : baseKind === 'join_approved' ? 'home' : null,
    read: !!row.read_at,
    server: true,
  };
}

/** Map + split a fetched page of rows: unread first (feed "New"), read into "Earlier".
    Order within each group follows the query (created_at desc). Pure. */
export function splitServerRows(rows, nowMs) {
  const mapped = (Array.isArray(rows) ? rows : []).map((r) => feedRowFromServer(r, nowMs)).filter(Boolean);
  return {
    unread: mapped.filter((r) => !r.read),
    read: mapped.filter((r) => r.read),
  };
}
