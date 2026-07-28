/* OnStandard — Notification Planner (pure; no state, no clock — everything is an argument).
   The reusable framework that turns structured context (requirements, windows, completion,
   pressure, urgency, quiet hours, coach link, score/streak) into the day's reminder plan.
   exec.js delegates here; the native seam (execSync.ts) schedules exactly what this returns.

   Design rules (docs/notifications/2026-07-16-notification-system-redesign.md):
   - Stages: open (max only) · soon (the workhorse) · due (last call — coach urgency 'high'
     at accountable, everything at max) · celebrate (all requirements in).
   - Short-window collapse: soon+due < 60 min apart become ONE last-call (kills the old
     duplicate weigh-in pair).
   - Coalescing: entries within 25 min merge into one combined notification.
   - Daily cap per pressure (gentle 3 / accountable 6 / max 10), due > soon > open.
   - Quiet hours: soon/open shift to the quiet-window end or drop; due survives only while
     the "deadline warnings" pref is on.
   - Copy: type-aware templates (new requirement kinds get sane copy automatically), variants
     rotated by a deterministic day seed so no sentence repeats within a day, no internal
     scoring formulas ever ("keeps the 50%" is gone), weight stays trend-only. */
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
const COALESCE_MIN = 25; // entries this close merge into one combined notification
const COLLAPSE_MIN = 60; // soon+due this close collapse into a single last-call
const RANK = { due: 3, soon: 2, open: 1 };

/** Template family for a requirement — inferred from proof/impact, never hardcoded ids, so
 *  coach-standard slots (meal-5, snack-as-required) and future kinds get sane copy. */
export function reqKind(req) {
  if (req.proof === 'scale') return 'weigh';
  if (req.proof === 'photo') return 'meal';
  if (req.proof === 'form') return req.impact && req.impact.comp === 'checkin' ? 'checkin' : 'recovery';
  return 'task';
}

function routeFor(req) {
  if (req.proof === 'photo') return `camera/${req.id}`;
  if (req.proof === 'scale') return 'weight';
  if (req.id === 'recovery' || (req.proof === 'form' && (!req.impact || req.impact.comp !== 'checkin'))) return 'recovery';
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

/* Copy templates: (kind, stage) → variants. Each variant is a function of the context
   { t: title, low: lowercase title, due: clock string, left: lead label, coach: name|null }.
   Tone escalates soon → due; no guilt, no internal percentages, weight is trend-only. */
const COPY = {
  meal: {
    open: [
      (c) => ({ title: `${c.t} window is open`, body: `Anytime before ${c.due} works — earlier beats later.` }),
      (c) => ({ title: `${c.t} is open`, body: `Log it whenever it happens. Due by ${c.due}.` }),
    ],
    soon: [
      (c) => ({ title: `${c.t} closes at ${c.due}`, body: `${cap(c.left)} left — one photo and it's in.` }),
      (c) => ({ title: `${c.t} by ${c.due}`, body: `Plate up. A quick photo keeps today on track.` }),
      (c) => ({ title: `${c.t} closes at ${c.due}`, body: `Still open — log it and it counts toward today's score.` }),
    ],
    due: [
      (c) => ({ title: `Last call: ${c.low}`, body: `The window closes at ${c.due}. Log it now and it counts on time.` }),
      (c) => ({ title: `${c.t} — last call`, body: `One photo before ${c.due} and the day stays whole.` }),
    ],
  },
  weigh: {
    // One sharp reminder (the collapse rule usually leaves a single last-call). Trend-only.
    soon: [
      (c) => ({ title: 'Morning weigh-in', body: `Ten seconds, same conditions as always — before ${c.due}.` }),
      (c) => ({ title: 'Weigh-in this morning', body: `Step on before ${c.due}. We read the trend, never one morning.` }),
    ],
    due: [
      (c) => ({ title: 'Morning weigh-in', body: `Ten seconds, same conditions as always — before ${c.due}.` }),
      (c) => ({ title: 'Weigh-in before you head out', body: `Same time, same conditions. The trend does the talking.` }),
    ],
  },
  recovery: {
    soon: [
      (c) => ({ title: 'Tonight’s check-in', body: `20 seconds before you sleep${c.coach ? ` — ${c.coach} reads it before practice` : ''}.` }),
      (c) => ({ title: 'Close out the day', body: `Your check-in is still open. Done by ${c.due} keeps the day complete.` }),
    ],
    due: [
      (c) => ({ title: 'Check-in closes tonight', body: `Last thing before bed — 20 seconds and the day counts in full.` }),
      (c) => ({ title: 'Before you sleep', body: `Tonight’s check-in is the last open item. 20 seconds closes the day.` }),
    ],
  },
  checkin: {
    soon: [
      (c) => ({ title: `${c.t} is ready`, body: `The week in one honest read — in by ${c.due}${c.coach ? `. ${c.coach} sees your update` : ''}.` }),
      (c) => ({ title: `${c.t} today`, body: `Five questions, two minutes. Due by ${c.due}.` }),
    ],
    due: [
      (c) => ({ title: `Last call: ${c.low}`, body: `Closes at ${c.due}. Two minutes and the week is on the record.` }),
      (c) => ({ title: `${c.t} closes at ${c.due}`, body: `Get it in — your week only counts if it's written down.` }),
    ],
  },
  task: {
    open: [
      (c) => ({ title: `${c.t} is open`, body: `On your list today. Due by ${c.due}.` }),
    ],
    soon: [
      (c) => ({ title: `${c.t} — due by ${c.due}`, body: `Still open on your list. Knock it out and mark it done.` }),
      (c) => ({ title: `${c.t} closes at ${c.due}`, body: `${cap(c.left)} left. Handle it and check it off.` }),
    ],
    due: [
      (c) => ({ title: `Last call: ${c.low}`, body: `Due by ${c.due}. Mark it done when it lands.` }),
      (c) => ({ title: `${c.t} — last call`, body: `The deadline is ${c.due}. Close it out.` }),
    ],
  },
};

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Stage-aware, kind-aware copy with deterministic per-day variant rotation. `salt` offsets
 *  the variant so two same-kind items on one day never read identically. */
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

/** Merge a cluster of near-simultaneous entries into one combined notification. */
function mergeGroup(g) {
  const lastDue = Math.max(...g.map((e) => (typeof e.dueMin === 'number' ? e.dueMin : e.fireAtMin)));
  const titles = g.map((e) => e.reqTitle || e.title);
  const stage = g.some((e) => e.stage === 'due') ? 'due' : g[0].stage;
  return {
    id: g.map((e) => e.id).join('+'),
    fireAtMin: g[0].fireAtMin,
    dayOffset: g[0].dayOffset,
    immediate: false,
    stage,
    route: g[0].route, // earliest-due item is the one to start with
    title: g.length === 2 ? `${titles[0]} and ${String(titles[1]).toLowerCase()}` : `${titles[0]} + ${g.length - 1} more`,
    body: `${g.length === 2 ? 'Both' : 'All'} land by ${fmtMin(lastDue)}. Start with ${String(titles[0]).toLowerCase()}.`,
    dueMin: lastDue,
    reqTitle: titles[0],
  };
}

/**
 * The planner. All inputs are data; the return is the full ordered plan for ONE day:
 *   { id, fireAtMin, dayOffset, immediate, stage, route, title, body }[]
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
      title: "You're OnStandard.", body: `Day locked at ${score} — day ${streak + 1} of your streak.`,
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
        title: copy.title, body: copy.body, dueMin: due, reqTitle: req.title,
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
      body: `Due by ${fmtMin(a.dueAtMin)}. Mark it done when it lands.`,
      dueMin: a.dueAtMin, reqTitle: a.title,
    });
  }

  entries.sort((x, y) => x.fireAtMin - y.fireAtMin || (RANK[y.stage] || 0) - (RANK[x.stage] || 0));

  // Coalesce near-simultaneous entries into one combined notification.
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

  // Daily cap: keep the most important (due > soon > open), earliest first within a rank.
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
    out.push({
      id: `vc:${c.instanceId || c.instance_id || ''}:${c.at}`,
      fireAtMin: c.at, dayOffset, immediate: false, stage: 'commitment',
      route: `roll-call/${c.instanceId || c.instance_id || ''}`,
      title: c.title, body: c.body,
    });
  }
  out.sort((a, b) => a.fireAtMin - b.fireAtMin);

  // Strip planner internals; what remains is exactly what the native seam schedules.
  return out.map(({ dueMin, reqTitle, ...keep }) => keep);
}
