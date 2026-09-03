/* OnStandard — Notification Planner (pure; no state, no clock — everything is an argument).
   The reusable framework that turns structured context (requirements, windows, completion,
   pressure, urgency, quiet hours, coach link, score/streak) into the day's reminder plan.
   exec.js delegates here; the native seam (execSync.ts) schedules exactly what this returns.

   Design rules (docs/notifications/2026-07-16-notification-system-redesign.md, voice and timing
   revised in docs/notifications/2026-09-03-notification-voice-and-timing.md):
   - Stages: open (max only) · soon (the workhorse) · due (last call — coach urgency 'high'
     at accountable, everything at max) · celebrate (all requirements in).
   - Short-window collapse: soon+due < 60 min apart become ONE last-call (kills the old
     duplicate weigh-in pair).
   - Coalescing: entries within 30 min merge into one combined notification whose body names
     each item's own deadline (a Mon/Wed/Fri morning is ONE brief, not a weigh-in ping followed
     by a breakfast ping half an hour later).
   - Daily cap per pressure (gentle 6 / accountable 6 / max 10), due > streak > soon > open.
   - Quiet hours: soon/open shift to the quiet-window end or drop; due survives only while
     the "deadline warnings" pref is on.
   - Copy: THE THREE-LINE SHAPE. `title` names the thing, `subtitle` carries the one time fact
     (iOS draws it as its own line; the native seam folds it into the title on Android), `body`
     is the ask in one sentence. Never the app name (the OS header already says it), never an
     exclamation mark, never a scoring formula ("keeps the 50%" is gone), never guilt. Variants
     rotate on a deterministic day seed so no sentence repeats within a day; weight stays
     trend-only. */
import { fmtMin } from './requirements.js';

export const DEFAULT_NOTIF_PREFS = {
  enabled: true,
  quietFrom: 22 * 60, // 10:00 PM
  quietTo: 7 * 60,    // 7:00 AM
  allowDeadline: true, // 'due' warnings are the only ones that break quiet hours
};

/** Merge a persisted (possibly partial/older/null) prefs object onto the defaults. Pure. */
export function normalizePrefs(p) {
  const d = DEFAULT_NOTIF_PREFS;
  const minOf = (v, f) => (typeof v === 'number' && isFinite(v) && v >= 0 && v < 1440 ? Math.round(v) : f);
  if (!p || typeof p !== 'object') return { ...d };
  return {
    enabled: p.enabled !== false,
    quietFrom: minOf(p.quietFrom, d.quietFrom),
    quietTo: minOf(p.quietTo, d.quietTo),
    allowDeadline: p.allowDeadline !== false,
  };
}

/** Is minute-of-day t inside the quiet window (which may wrap midnight)? */
export function inQuiet(t, prefs) {
  const f = prefs.quietFrom, to = prefs.quietTo;
  if (f === to) return false;
  return f < to ? t >= f && t < to : t >= f || t < to;
}

// Safety valve for pathological stacks (a coach standard with a dozen slots), NOT the shaper
// of a normal day: gentle's low volume comes from being single-stage, so a standard 5-item day
// must fit under every cap or required reminders silently vanish.
const CAP = { gentle: 6, accountable: 6, max: 10 };
const LEAD = { gentle: 30, accountable: 45, max: 45 };
// Entries this close merge into one combined notification. 30, not 25: the default catalog's
// Mon/Wed/Fri morning puts the weigh-in last call at 8:15 and the breakfast heads-up at 8:45,
// exactly 30 apart, and two pings half an hour apart about the same morning is the pattern
// athletes call spam. One brief at 8:15 that names both deadlines is what a coach would send.
const COALESCE_MIN = 30;
const COLLAPSE_MIN = 60; // soon+due this close collapse into a single last-call
// 'streak' sits between soon and due: a live run about to end outranks another heads-up about a
// window, and is outranked by a deadline landing right now. Without an entry here it fell to 0 and
// would have been the first thing the cap dropped on exactly the busy day it matters most.
const RANK = { due: 3, streak: 2.5, soon: 2, open: 1 };

/** Template family for a requirement — inferred from proof/impact, never hardcoded ids, so
 *  coach-standard slots (meal-5, snack-as-required) and future kinds get sane copy. There is no
 *  'checkin' kind: that branch existed for the Weekly Check-In ritual, which v2 deleted — every
 *  impact.comp the catalog (or a coach-standard slot, or a custom assignment) can ever produce is
 *  'nutrition' or 'recovery', never 'checkin'. Confirmed by repo-wide grep before removing it. */
export function reqKind(req) {
  if (req.proof === 'scale') return 'weigh';
  if (req.proof === 'photo') return 'meal';
  if (req.proof === 'form') return 'recovery';
  return 'task';
}

function routeFor(req) {
  if (req.proof === 'photo') return `camera/${req.id}`;
  if (req.proof === 'scale') return 'weight';
  if (req.id === 'recovery' || req.proof === 'form') return 'recovery';
  return req.route || 'home';
}

/** '45 minutes' · '1 minute' · '1 hour' · '2 hours'. */
function fmtLeft(mins) {
  if (mins >= 90) return `${Math.round(mins / 60)} hours`;
  if (mins >= 55) return '1 hour';
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

/** Small deterministic hash — variant rotation only, not crypto. */
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** How a requirement reads mid-sentence ("dinner", "your weigh-in", "your check-in"). The
 *  athlete's own things take "your"; a meal is just the meal. */
function spoken(req) {
  const kind = reqKind(req);
  if (kind === 'weigh') return 'your weigh-in';
  if (kind === 'recovery') return 'your check-in';
  return String(req.title || '').toLowerCase();
}

/** The short name a title slot uses ("Weigh-in", "Check-in", "Breakfast"): the catalog's
 *  "Morning Weight" / "Recovery Check-In" are settings labels, not what anyone says. */
function shortName(req) {
  const kind = reqKind(req);
  if (kind === 'weigh') return 'Weigh-in';
  if (kind === 'recovery') return 'Check-in';
  return String(req.title || '');
}

/** "dinner" · "dinner and your check-in" · "lunch, dinner and your check-in". */
function listOf(items) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* Copy templates: (kind, stage) → variants. Each variant is a function of the context
   { t: title, low: lowercase title, due: clock string, left: lead label, coach: name|null } and
   returns the three-line shape { title, subtitle, body }. Tone escalates soon → due; no guilt,
   no internal percentages, weight is trend-only. The subtitle is ALWAYS the time fact and
   nothing else, so an athlete learns to read it as "when". */
const COPY = {
  meal: {
    open: [
      (c) => ({ title: c.t, subtitle: `Open until ${c.due}`, body: 'Log it when you eat. Earlier beats later.' }),
      (c) => ({ title: `${c.t} is open`, subtitle: `Until ${c.due}`, body: 'One photo whenever it happens, and it counts.' }),
    ],
    soon: [
      (c) => ({ title: c.t, subtitle: `Closes at ${c.due}`, body: `${cap(c.left)} left. One photo and it counts.` }),
      (c) => ({ title: c.t, subtitle: `By ${c.due}`, body: 'Plate up, snap it, done. Today stays on track.' }),
      (c) => ({ title: c.t, subtitle: `Closes at ${c.due}`, body: 'Still open. Log it and it counts toward today.' }),
    ],
    due: [
      (c) => ({ title: `Last call: ${c.low}`, subtitle: `Closes at ${c.due}`, body: 'Log it now and it counts on time.' }),
      (c) => ({ title: `${c.t}: last call`, subtitle: `Closes at ${c.due}`, body: 'One photo before the window shuts keeps the day whole.' }),
    ],
  },
  weigh: {
    // One sharp reminder (the collapse rule usually leaves a single last-call). Trend-only.
    soon: [
      (c) => ({ title: 'Weigh-in', subtitle: `Before ${c.due}`, body: 'Ten seconds, same conditions as always.' }),
      (c) => ({ title: 'Morning weigh-in', subtitle: `By ${c.due}`, body: 'Step on before you eat. We read the trend, never one morning.' }),
    ],
    due: [
      (c) => ({ title: 'Weigh-in', subtitle: `Before ${c.due}`, body: 'Ten seconds now, before the morning gets away.' }),
      (c) => ({ title: 'Weigh-in before you head out', subtitle: `By ${c.due}`, body: 'Same time, same conditions. The trend does the talking.' }),
    ],
  },
  recovery: {
    soon: [
      (c) => ({ title: 'Tonight’s check-in', subtitle: `By ${c.due}`, body: c.coach ? `20 seconds before you sleep. ${c.coach} reads it before practice.` : '20 seconds before you sleep closes the day.' }),
      (c) => ({ title: 'Close out the day', subtitle: `Check-in by ${c.due}`, body: 'Your check-in is still open. 20 seconds and the day is complete.' }),
    ],
    due: [
      (c) => ({ title: 'Last thing tonight', subtitle: `Check-in by ${c.due}`, body: '20 seconds and the day counts in full.' }),
      (c) => ({ title: 'Before you sleep', subtitle: `Check-in by ${c.due}`, body: 'Tonight’s check-in is the last open item. 20 seconds closes the day.' }),
    ],
  },
  task: {
    open: [
      (c) => ({ title: c.t, subtitle: `Due by ${c.due}`, body: 'On your list today.' }),
    ],
    soon: [
      (c) => ({ title: c.t, subtitle: `Due by ${c.due}`, body: 'Still open on your list. Knock it out and mark it done.' }),
      (c) => ({ title: c.t, subtitle: `Closes at ${c.due}`, body: `${cap(c.left)} left. Handle it and check it off.` }),
    ],
    due: [
      (c) => ({ title: `Last call: ${c.low}`, subtitle: `Due by ${c.due}`, body: 'Mark it done when it lands.' }),
      (c) => ({ title: `${c.t}: last call`, subtitle: `Due by ${c.due}`, body: 'Close it out before the deadline.' }),
    ],
  },
};

/* Streak-defense bodies, rotated by day like every other template here. Loss-aversion copy, so
   it states what is still open rather than what has been achieved — and never a score formula.
   `open` is the spoken list of what is still outstanding ("dinner and your check-in"). */
const STREAK_BODY = [
  (n, open) => `${cap(open)} still open. Keep the ${n} days alive: finish ${open.includes(' and ') ? 'them' : 'it'} tonight.`,
  (n, open) => `${n} days in a row. Still open tonight: ${open}. There is time.`,
  (n, open) => `Day ${n} is on the line. Still to do: ${open}. All doable before bed.`,
];

/** Stage-aware, kind-aware copy with deterministic per-day variant rotation. `salt` offsets
 *  the variant so two same-kind items on one day never read identically. Returns the
 *  three-line shape { title, subtitle, body }. */
export function notifCopy(req, stage, { dateISO = '', fireAtMin = 0, coachName = null, salt = 0 } = {}) {
  const kind = reqKind(req);
  const variants = (COPY[kind] && (COPY[kind][stage] || COPY[kind].soon)) || COPY.task.soon;
  const due = req.window.due;
  const c = {
    t: req.title,
    low: String(req.title).toLowerCase(),
    due: fmtMin(due),
    left: fmtLeft(Math.max(1, due - fireAtMin)),
    coach: coachName ? String(coachName).trim() || null : null,
  };
  // Rotate by day + kind, offset by the caller's per-item salt: same-kind items on one day
  // are GUARANTEED different variants (salt 0,1,2…), and the whole rotation shifts day to day.
  const idx = (hashStr(`${dateISO}:${kind}:${stage}`) + salt) % variants.length;
  return variants[idx](c);
}

/** Merge a cluster of near-simultaneous entries into one combined notification. The body names
 *  each item's OWN deadline, in deadline order, because the old "Both land by 9:30" quietly
 *  erased the one fact that differed between them (the weigh-in closed half an hour earlier). */
function mergeGroup(g) {
  const dueOf = (e) => (typeof e.dueMin === 'number' ? e.dueMin : e.fireAtMin);
  const byDue = g.slice().sort((a, b) => dueOf(a) - dueOf(b));
  const lastDue = Math.max(...byDue.map(dueOf));
  const shorts = byDue.map((e) => e.reqShort || e.reqTitle || e.title);
  const stage = g.some((e) => e.stage === 'due') ? 'due' : g[0].stage;
  const named = (e) => (e.reqSpoken || String(e.reqTitle || e.title).toLowerCase());
  const list = byDue.length === 2
    ? `${named(byDue[0])} by ${fmtMin(dueOf(byDue[0]))}, then ${named(byDue[1])} by ${fmtMin(dueOf(byDue[1]))}`
    : byDue.map((e) => `${named(e)} ${fmtMin(dueOf(e))}`).join(', ');
  // The pair's last call reads as a last call, so at max pressure the 8:15 heads-up and the
  // 9:00 deadline for the same two items are two different sentences, not one sent twice.
  const pair = byDue.length === 2 ? `${shorts[0]} and ${String(shorts[1]).toLowerCase()}` : `${shorts[0]} + ${byDue.length - 1} more`;
  return {
    id: g.map((e) => e.id).join('+'),
    fireAtMin: g[0].fireAtMin,
    dayOffset: g[0].dayOffset,
    immediate: false,
    stage,
    route: byDue[0].route, // earliest-due item is the one to start with
    title: stage === 'due' ? `Last call: ${pair.toLowerCase()}` : pair,
    subtitle: `${byDue.length === 2 ? 'Both' : 'All'} by ${fmtMin(lastDue)}`,
    body: stage === 'due' ? `Still open: ${list}. Log them now and they count on time.` : `${cap(list)}.`,
    dueMin: lastDue,
    reqTitle: shorts[0],
  };
}

/**
 * The planner. All inputs are data; the return is the full ordered plan for ONE day:
 *   { id, fireAtMin, dayOffset, immediate, stage, route, title, subtitle, body }[]
 * - reqs: incomplete REQUIRED requirements running that day ({id,title,proof,reminder,impact,window,route?})
 * - assigned: coach-assigned tasks ({id,title,from,done,dueAtMin|null}) — dated ones get one 'soon'
 * - prefs: RT.notifPrefs (normalized here; null → defaults); enabled:false → empty plan
 * - celebration: every requirement in → a single immediate acknowledgment (skipped on gentle)
 * - dayOffset: 0 today / 1 tomorrow (pre-schedule) — the caller converts to absolute dates
 */
export function planNotifications({
  nowMin, dateISO = '', dayOffset = 0,
  reqs = [], assigned = [], pressure = 'accountable',
  prefs: rawPrefs = null, celebration = false, score = 0, streak = 0, coachName = null,
  commitments = [],
}) {
  const prefs = normalizePrefs(rawPrefs);
  if (!prefs.enabled) return [];

  if (celebration) {
    if (pressure === 'gentle') return [];
    return [{
      id: 'celebrate', fireAtMin: nowMin, dayOffset, immediate: true, stage: 'celebrate', route: 'home',
      title: 'You’re on standard', subtitle: `Locked at ${score}`,
      body: `Day ${streak + 1} of your streak, locked at ${score}. Nothing left to do tonight.`,
    }];
  }

  // Quiet-hours placement for one slot: 'due' survives while allowDeadline is on; everything
  // else shifts OUT of the quiet window — an evening slot moves to just before quiet starts
  // ("last one before you wind down"), a small-hours slot to the morning end — and drops
  // entirely when no placement is still before the deadline and after now.
  const placed = (t, stage, due) => {
    if (!inQuiet(t, prefs)) return t;
    if (stage === 'due' && prefs.allowDeadline) return t;
    const eveningSide = prefs.quietFrom > prefs.quietTo && t >= prefs.quietFrom;
    const shifted = eveningSide ? prefs.quietFrom - 15 : prefs.quietTo;
    return shifted <= due && shifted > nowMin && !inQuiet(shifted, prefs) ? shifted : null;
  };

  const entries = [];
  const seen = {}; // per (kind:stage) counter → distinct copy variants for same-kind items

  for (const req of reqs) {
    if (!req || !req.required || !req.window || typeof req.window.due !== 'number') continue;
    const due = req.window.due;
    let slots = [];
    if (pressure === 'gentle') {
      slots.push([due - LEAD.gentle, 'soon']);
    } else {
      if (pressure === 'max' && req.window.open != null) slots.push([req.window.open, 'open']);
      slots.push([due - (LEAD[pressure] || 45), 'soon']);
      if (pressure === 'max' || req.reminder === 'high') slots.push([due, 'due']);
    }
    // Short-window collapse (not at max — max pressure was explicitly chosen): a soon+due pair
    // under an hour apart becomes ONE last-call at the soon time (or the due time if soon has
    // already passed). This is the fix for the old identical weigh-in double.
    if (pressure !== 'max') {
      const soon = slots.find((s) => s[1] === 'soon');
      const d = slots.find((s) => s[1] === 'due');
      if (soon && d && d[0] - soon[0] < COLLAPSE_MIN) {
        slots = [[soon[0] > nowMin ? soon[0] : d[0], 'due']];
      }
    }
    for (const [t, stage] of slots) {
      if (t <= nowMin) continue; // future only — completions/late opens auto-drop past slots
      const fireAtMin = placed(t, stage, due);
      if (fireAtMin == null) continue;
      const kind = reqKind(req);
      const key = `${kind}:${stage}`;
      const copy = notifCopy(req, stage, { dateISO, fireAtMin, coachName, salt: seen[key] || 0 });
      seen[key] = (seen[key] || 0) + 1;
      entries.push({
        id: req.id, fireAtMin, dayOffset, immediate: false, stage, route: routeFor(req),
        title: copy.title, subtitle: copy.subtitle || null, body: copy.body,
        dueMin: due, reqTitle: req.title, reqSpoken: spoken(req), reqShort: shortName(req),
      });
    }
  }

  // Coach-assigned tasks with a real same-day deadline: one 'soon' an hour out.
  for (const a of assigned) {
    if (!a || a.done || typeof a.dueAtMin !== 'number' || !isFinite(a.dueAtMin)) continue;
    const t = a.dueAtMin - 60;
    if (t <= nowMin) continue;
    const fireAtMin = placed(t, 'soon', a.dueAtMin);
    if (fireAtMin == null) continue;
    entries.push({
      id: String(a.id), fireAtMin, dayOffset, immediate: false, stage: 'soon',
      route: `requirement/${a.id}`,
      title: `From ${a.from || 'Coach'}: ${a.title}`,
      subtitle: `Due by ${fmtMin(a.dueAtMin)}`,
      body: 'Mark it done when it lands.',
      dueMin: a.dueAtMin, reqTitle: a.title, reqSpoken: String(a.title || '').toLowerCase(), reqShort: a.title,
    });
  }

  entries.sort((x, y) => x.fireAtMin - y.fireAtMin || (RANK[y.stage] || 0) - (RANK[x.stage] || 0));

  // Coalesce near-simultaneous entries into one combined notification.
  // Annotated to match `entries`: this list holds three differently-shaped things (a requirement
  // slot, a mergeGroup() combination, the streak-defense entry below) and only the stripped shape
  // returned at the bottom is a contract. Without it, TS evolves the element type from the first
  // literal pushed in and every `.find()` at a call site starts needing a null check.
  /** @type {any[]} */
  const merged = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    merged.push(group.length === 1 ? group[0] : mergeGroup(group));
    group = [];
  };
  for (const e of entries) {
    if (!group.length || e.fireAtMin - group[0].fireAtMin <= COALESCE_MIN) group.push(e);
    else { flush(); group.push(e); }
  }
  flush();

  /* ---- Streak defense: the one message that speaks BEFORE the streak dies ----
     Every other streak mention in this planner is in `celebrate`, which fires once the day is
     already won. The moment that decides whether someone comes back is the opposite one — a real
     run is alive, the day is not finished, and the window is closing. Nothing spoke there, so the
     run ended quietly and the athlete learned about it the next morning.

     It NAMES what is still open. "Today is not closed yet" told the athlete there was a problem
     and made them open the app to find out what; "dinner and your check-in still open" is the
     whole to-do list in one line, which is what a coach texting at 9 PM would write.

     Placed BEFORE the daily cap, unlike a commitment. A commitment is exempt because a coach
     scheduled it for a specific event; this is a nudge the APP invented, and the cap is a promise
     about volume — appending it afterwards shipped cap+1 notifications on any day busy enough to
     be capped, which is precisely the day an extra voice is least welcome.

     Suppressed on `gentle` for the same reason the celebration is: that pressure setting is a
     promise about volume. Requires a run of at least 2 — one day is not yet something to lose. */
  const openReqs = merged.length > 0;
  if (streak >= 2 && openReqs && pressure !== 'gentle') {
    // Just before the athlete winds down: late enough to be a genuine last call, early enough
    // that there is still time to act on it. Anchoring it after the final requirement reminder
    // instead would drag it past 23:30 on any day with a late recovery check-in — technically
    // "the last word", practically useless. If that slot has already passed, say nothing: a
    // streak warning at midnight only tells someone what they already lost.
    const at = prefs.quietFrom - 45;
    if (at > nowMin && !inQuiet(at, prefs)) {
      // What will still be open when this fires: every incomplete requirement whose window is
      // not already shut by then. The plan is rebuilt on every completion, so this list is live.
      const open = reqs
        .filter((r) => r && r.required && r.window && typeof r.window.due === 'number' && r.window.due > at)
        .map(spoken);
      const openList = listOf(open.length ? open : ['today']);
      merged.push({
        id: 'streak-defense', fireAtMin: at, dayOffset, immediate: false, stage: 'streak', route: 'home',
        title: `${streak}-day streak on the line`,
        subtitle: 'Still open tonight',
        body: STREAK_BODY[hashStr(`${dateISO}:streak`) % STREAK_BODY.length](streak, openList),
      });
      merged.sort((a, b) => a.fireAtMin - b.fireAtMin);
    }
  }

  // Daily cap: keep the most important (due > streak > soon > open), earliest first within a rank.
  let out = merged;
  const capN = CAP[pressure] || CAP.accountable;
  if (out.length > capN) {
    out = out
      .slice()
      .sort((a, b) => (RANK[b.stage] || 0) - (RANK[a.stage] || 0) || a.fireAtMin - b.fireAtMin)
      .slice(0, capN)
      .sort((a, b) => a.fireAtMin - b.fireAtMin);
  }

  /* ---- Verified Commitments (0138): scheduled events, not nudges ----
     These are appended AFTER quiet-hours placement, coalescing and the daily cap, and are subject
     to none of them. That is deliberate, not an oversight:
       · Default quiet hours are 22:00–07:00. A 4:45 AM roll call sits squarely inside them, so
         routing it through placed() would shift it to 7:00 AM or drop it — and the feature would
         quietly not work at all. The athlete is told this at enrolment, and the phone's own Do Not
         Disturb still wins over everything the app schedules.
       · The daily cap exists to stop the app inventing too many nudges. A commitment reminder was
         not invented by the app: a coach scheduled it, for a specific event, and only athletes who
         have NOT responded receive it (commitmentReminders filters on status).
     Entries arrive pre-shaped from commitments.js; here they only get planner fields. */
  const vc = Array.isArray(commitments) ? commitments : [];
  for (const c of vc) {
    if (!c || typeof c.at !== 'number' || c.at <= nowMin) continue;
    // No instance id, no notification. The id IS the payload here: it is what the deep link
    // opens and what the lock-screen ack posts back, so an idless reminder can do neither —
    // it would open `roll-call/` on a screen that has nothing to show and nothing to press.
    const instanceId = c.instanceId || c.instance_id || '';
    if (!instanceId) continue;
    out.push({
      id: `vc:${instanceId}:${c.at}`,
      fireAtMin: c.at, dayOffset, immediate: false, stage: 'commitment',
      route: `roll-call/${instanceId}`,
      title: c.title, subtitle: c.subtitle || null, body: c.body,
    });
  }
  out.sort((a, b) => a.fireAtMin - b.fireAtMin);

  // Strip planner internals; what remains is exactly what the native seam schedules.
  return out.map(({ dueMin, reqTitle, reqSpoken, reqShort, ...keep }) => ({ ...keep, subtitle: keep.subtitle || null }));
}
