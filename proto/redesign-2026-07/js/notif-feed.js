/* OnStandard — server notification feed mapping (pure; no state, no clock arguments hidden).
   The `notifications` table (0027) is written server-side only: coach nudges (send-push),
   join requests/approvals (0027 triggers), weekly digests (weekly-digest fn). This module
   turns those rows into the bell feed's row shape so the athlete/staff bell finally shows
   what the server recorded — before this, a coach nudge pushed to the phone but never
   appeared in the app. state.js merges the result with the locally-derived rows. */

/* kind → presentation. Unknown kinds (added by future migrations) fall back to a plain
   bell row instead of vanishing — the feed keeps working as the server grows. */
/* `tag` overrides the level's generic pill label ("urgent"/"reminder") where the level is
   right for weight but wrong as a name — a coach's comment is medium-weight, but calling it
   "reminder" misfiles it. Tags are static strings from this table, never row data. */
const KIND_META = {
  nudge: { icon: 'bell', level: 'high' },
  // A coach speaking is conversation, not an alarm. These used to ride kind:'nudge', which
  // tagged an emoji react "urgent" and let the nudge dedupe eat back-to-back comments.
  coach_comment: { icon: 'message', level: 'medium', tag: 'coach' },
  coach_react: { icon: 'heart', level: 'positive', tag: 'coach' },
  // Athlete → coach meal events (send-push to_coach). They fell to DEFAULT_META, so an
  // urgent "needs review" wore the grey "reminder" pill and no row could route anywhere.
  meal_logged: { icon: 'camera', level: 'medium', tag: 'logged' },
  meal_review: { icon: 'utensils', level: 'medium', tag: 'review' },
  meal_action: { icon: 'alert', level: 'high' },
  join_request: { icon: 'users', level: 'medium' },
  join_approved: { icon: 'check', level: 'positive' },
  digest: { icon: 'clipboard', level: 'medium' },
  announcement: { icon: 'share', level: 'info' },
  // The AI's own daily follow-up. Unlike the rows above it, this one IS a task: it opens a
  // conversation and expects a reply, so it deep-links to the meal it is about.
  ai_followup: { icon: 'sparkle', level: 'medium' },
  // Coach-bound kinds. These existed in the table since their functions shipped but fell to
  // DEFAULT_META because no coach screen ever rendered the feed — the bell is operator-visible
  // now, so each one carries its real urgency and, where the row IS a task, its destination.
  meal_flag: { icon: 'alert', level: 'high' },
  commitment_escalation: { icon: 'bell', level: 'high' },
  commitment_reminder: { icon: 'clock', level: 'high' },
  cs_reminder: { icon: 'clock', level: 'medium' },
  // A missed connected-standard day is a record, not a reminder: "Today's target wasn't met"
  // under a clock pill labelled "reminder" read as a nag about something already over.
  cs_missed: { icon: 'alert', level: 'medium', tag: 'missed' },
  // Server kinds that fell to DEFAULT_META until 2026-09-03: the winback ("Still here when you
  // are") wore an urgent-looking bell for a message whose whole point is no pressure, and the
  // Verified Profile lapse (a billing deadline) rendered as a grey "reminder" with no tap target.
  winback: { icon: 'heart', level: 'info', tag: 'welcome back' },
  verified_profile: { icon: 'alert', level: 'high', tag: 'plan' },
};
const DEFAULT_META = { icon: 'bell', level: 'medium' };

/* kind → deep link. A server row is a RECORD, not a task, so most kinds deliberately stay
   route-less; only rows that expect the reader to DO something somewhere specific link there.
   Suffix-carrying kinds validate against the native deep-link shape — a junk suffix renders as
   a plain record, never a link into nowhere. */
const SUFFIX_OK = (s) => !!s && /^[a-z0-9-]{6,64}$/i.test(s);
const KIND_ROUTE = {
  nudge: () => 'home',                                                   // athlete: the next action lives on Home
  coach_comment: (s) => (SUFFIX_OK(s) ? `meal-view/${s}` : null),        // athlete: the thread they were spoken to in
  coach_react: (s) => (SUFFIX_OK(s) ? `meal-view/${s}` : null),
  meal_logged: (s) => (SUFFIX_OK(s) ? `coach-meal/${s}` : null),         // coach: the meal itself
  meal_review: (s) => (SUFFIX_OK(s) ? `coach-meal/${s}` : null),
  meal_action: (s) => (SUFFIX_OK(s) ? `coach-meal/${s}` : null),
  ai_followup: (s) => (SUFFIX_OK(s) ? `meal-view/${s}` : null),         // athlete: answer the AI
  meal_flag: (s) => (SUFFIX_OK(s) ? `coach-meal/${s}` : null),          // coach: review the flagged meal
  // The COACH board, not `roll-call/` — that route is the ATHLETE detail screen, and router.js's
  // mirror guard bounces a known coach off any athlete-nav screen back to their dashboard, losing
  // the instance id on the way. This row is only ever written for coaches (0145), so it has always
  // pointed at a door its only reader could not walk through.
  commitment_escalation: (s) => (SUFFIX_OK(s) ? `coach-commitments/${s}` : null), // coach: who's still out
  join_approved: () => 'home',
  join_request: () => 'coach-inbox',                                     // coach: approve/decline lives there
  digest: () => 'coach-insights',                                        // coach: the full weekly read
  // The standard itself. connected-standards-tick computed this route for the push and then
  // dropped it before the bell row was written; the result id now rides the kind as a suffix.
  cs_reminder: (s) => (SUFFIX_OK(s) ? `connected-standard/${s}` : null),
  cs_missed: (s) => (SUFFIX_OK(s) ? `connected-standard/${s}` : null),
  winback: () => 'home',                                                 // athlete: one plate, from Home
  verified_profile: () => 'verified-profile',                            // athlete: renew from the profile screen
};

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
    Malformed rows map to null (dropped, never invented). Routing doctrine lives on KIND_ROUTE;
    suffixes ride `kind` (`meal_flag:<mealId>`) because it is free text (0027 has no CHECK),
    which keeps every new deep-linkable kind a client change with no migration. */
export function feedRowFromServer(row, nowMs) {
  if (!row || typeof row !== 'object' || !row.title) return null;
  const rawKind = String(row.kind || '');
  const [baseKind, suffix] = rawKind.split(':');
  const meta = KIND_META[baseKind] || DEFAULT_META;
  return {
    id: row.id || null,
    level: meta.level,
    tag: meta.tag || null,
    icon: meta.icon,
    title: String(row.title),
    body: String(row.body || ''),
    when: fmtWhen(row.created_at, nowMs),
    route: KIND_ROUTE[baseKind] ? KIND_ROUTE[baseKind](suffix) : null,
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
