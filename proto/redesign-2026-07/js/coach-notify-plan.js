/* OnStandard — Coach Notification Planner (PURE: no state, no DOM, no fetch, no clock reads —
   everything is an argument). The coach-facing sibling of js/notify-plan.js: turns a coach's
   live roster status (entriesFor(scope)'s [{row,status}] shape) into today's alert plan —
   grouped overdue-window alerts, a morning briefing, an evening recap, an optional hourly
   overdue summary, and at most one immediate ping for a brand-new critical group. Task 5's
   caller hands the returned plan to the SAME native seam notify-plan.js's athlete plan uses —
   the shape below is EXACT: {id, fireAtMin, dayOffset, immediate, stage, route, title, body}
   (state.js:614-621 turns fireAtMin+dayOffset into an absolute ISO; immediate:true → atISO
   null, fire now).

   Design rules (Task 4 brief) + pinned decisions where the brief left an edge case open:
   - Never a slot for an excused or on_standard entry.
   - Intervention-dedupe (the priority.js idea): an athlete with a TODAY intervention (kind
     nudge/message/handled) whose reason_key already carries the athlete's CURRENT status
     signature — reason_key starts with "<status.key>:", the exact prefix priority.js's own
     reasonKey() produces ("<status.key>:<sorted overdue/due_soon ids>", e.g.
     "overdue:lunch+dinner") — is treated as already handled today and drops out of every
     grouping below (window alerts, hourly totals, immediate content).
     PINNED: alertKeys(entries) has no interventions parameter (see its exported signature),
     so it can only ever apply the excused/on_standard filter, never intervention-dedupe — it
     hands the caller an "objective" signature to persist as lastAlertKeys, while the planner's
     own groupings (built from `elig` below) use the fuller intervention-deduped set so a
     handled athlete never re-pings even though their raw signature is still "new".
   - PINNED: dayOffset is always 0. This planner emits ONE day's coach alerts; a slot that would
     need to roll past midnight after a quiet-hour shift is dropped instead of wrapped to
     tomorrow — keeps "strictly future, today" simple and matches the "or drop" language in the
     quiet-hours rule below (native fireAtMin stays 0-1439 with no wraparound math needed).
   - Copy: deterministic, no em dashes, never a scoring formula. Grouped-alert bodies list up
     to 3 first names + "and N more"; n===1 groups use the athlete's own name in the title
     instead of a count ("Devin missed Lunch").
   - Quiet hours: REUSES (imports, never forks) notify-plan.js's inQuiet. Briefing/recap/hourly
     shift to the quiet window's end (quietTo) whenever their natural slot falls inside quiet;
     grouped window alerts only shift if quietTo is within 3 hours of the natural slot, else
     they DROP (a window alert delayed till morning is stale, not a reminder). Immediate-
     critical bypasses quiet only while prefs.allowCriticalInQuiet !== false; otherwise it
     becomes a normal (non-immediate) slot at quietTo, subject to the same future-only rule.
   - At most ONE immediate item per plan, and only for a signature that is NEW vs lastAlertKeys
     whose raw (undeduped) count is n>=2 — the exact condition the brief specifies. The
     message content itself still reflects the intervention-deduped group (so a partially-
     handled group reports the honest remaining count).
   - IDs are deterministic: `cn-<stage>-<key>`, mirroring notify-plan.js's id idiom so
     state.js's samePlan() dedupe works the same way for both planners.
   - Cap 8, ranked immediate > due > soon > open, earliest-first within a rank (mirrors
     notify-plan.js's own cap idiom exactly). */
import { inQuiet } from './notify-plan.js';

export const DEFAULT_COACH_NOTIF_PREFS = {
  enabled: true,
  briefing: true,
  briefingAt: 7 * 60 + 30,   // 7:30 AM
  recap: true,
  recapAt: 20 * 60 + 30,     // 8:30 PM
  hourly: false,
  immediateCritical: true,
  allowCriticalInQuiet: true,
  quietFrom: 22 * 60,        // 10:00 PM
  quietTo: 7 * 60,           // 7:00 AM
  myRoomOnly: false,         // consumed by the caller's scope choice, not by this (scope-agnostic) planner
};

/** Merge a persisted (possibly partial/older/null) prefs object onto the defaults. Pure. */
export function normalizeCoachPrefs(p) {
  const d = DEFAULT_COACH_NOTIF_PREFS;
  const minOf = (v, f) => (typeof v === 'number' && isFinite(v) && v >= 0 && v < 1440 ? Math.round(v) : f);
  if (!p || typeof p !== 'object') return { ...d };
  return {
    enabled: p.enabled !== false,
    briefing: p.briefing !== false,
    briefingAt: minOf(p.briefingAt, d.briefingAt),
    recap: p.recap !== false,
    recapAt: minOf(p.recapAt, d.recapAt),
    hourly: p.hourly === true,
    immediateCritical: p.immediateCritical !== false,
    allowCriticalInQuiet: p.allowCriticalInQuiet !== false,
    quietFrom: minOf(p.quietFrom, d.quietFrom),
    quietTo: minOf(p.quietTo, d.quietTo),
    myRoomOnly: p.myRoomOnly === true,
  };
}

const RANK = { due: 3, soon: 2, open: 1 };
const rankOf = (it) => (it.immediate ? 4 : (RANK[it.stage] || 0));

function firstName(name) {
  const s = String(name || 'Athlete').trim();
  return s.split(/\s+/)[0] || 'Athlete';
}

/** Up to 3 first names, then "and N more." — no em dash, fully deterministic. */
function namesBody(fullNames) {
  const firsts = fullNames.map(firstName);
  const shown = firsts.slice(0, 3);
  const restN = firsts.length - shown.length;
  return restN > 0 ? `${shown.join(', ')} and ${restN} more.` : `${shown.join(', ')}.`;
}

/** n===1 uses the athlete's name; otherwise "<n> athletes missed <title>". Shared by grouped
 *  window alerts and the immediate-critical item so both read the same way. */
function groupTitle(names, title) {
  return names.length === 1 ? `${names[0]} missed ${title}` : `${names.length} athletes missed ${title}`;
}

/** Does this athlete already have a today-intervention matching their CURRENT status signature
 *  (see header — mirrors priority.js's reasonKey() "<status.key>:<ids>" format)? */
function alreadyHandledToday(status, athleteId, interventions) {
  const prefix = `${status.key}:`;
  return (interventions || []).some((iv) => iv && iv.athlete_id === athleteId
    && (iv.kind === 'nudge' || iv.kind === 'message' || iv.kind === 'handled')
    && typeof iv.reason_key === 'string' && iv.reason_key.startsWith(prefix));
}

/** entries minus excused/on_standard minus today's already-handled athletes. */
function eligibleEntries(entries, interventions) {
  return (entries || []).filter((e) => e && e.row && e.status
    && e.status.key !== 'excused' && e.status.key !== 'on_standard'
    && !alreadyHandledToday(e.status, e.row.athleteId, interventions));
}

/** Group entries' OVERDUE openItems by item id → { title, rows: [{name, dueMin}] }. Filters
 *  excused/on_standard itself (the one filter it CAN apply without an interventions arg) — see
 *  header for why intervention-dedupe is deliberately NOT folded in here. */
function groupOverdueItems(entries) {
  const byItem = {};
  for (const e of (entries || [])) {
    if (!e || !e.row || !e.status) continue;
    if (e.status.key === 'excused' || e.status.key === 'on_standard') continue;
    for (const it of (e.status.openItems || [])) {
      if (!it || it.state !== 'overdue') continue;
      if (!byItem[it.id]) byItem[it.id] = { title: it.title || it.id, rows: [] };
      byItem[it.id].rows.push({ name: e.row.name, dueMin: it.dueMin });
    }
  }
  return byItem;
}

/** Sorted grouped-alert signatures, e.g. "overdue:lunch:3" — the caller persists these between
 *  syncs (as lastAlertKeys) to detect NEW criticals for the immediate-critical rule below. */
export function alertKeys(entries) {
  const groups = groupOverdueItems(entries);
  return Object.keys(groups).map((id) => `overdue:${id}:${groups[id].rows.length}`).sort();
}

function clampMin(t) { return Math.max(0, Math.min(1439, Math.round(t))); }

/** Shift `t` out of quiet hours to quietTo when it falls inside the window; returns null
 *  (drop) if the shifted slot wouldn't still be strictly in the future. `closeMin`, passed only
 *  for window alerts, additionally requires quietTo be within that many minutes of `t` — else
 *  drop instead of shift (a stale-by-morning window alert is worse than no alert). */
function quietPlace(t, prefs, nowMin, closeMin) {
  if (!inQuiet(t, prefs)) return t;
  if (closeMin != null) {
    const dist = ((prefs.quietTo - t) % 1440 + 1440) % 1440;
    if (dist > closeMin) return null;
  }
  const shifted = prefs.quietTo;
  return shifted > nowMin ? shifted : null;
}

/**
 * The coach planner. entries: entriesFor(scope)'s [{row:{athleteId,name}, status}] rows.
 * interventions: today's [{athlete_id, kind, reason_key}]. dateISO is accepted (interface
 * completeness / future variant rotation) but not consumed — every string here is fixed, no
 * per-day rotation, so there is nothing for it to seed. Returns the day's coach alert plan in
 * the exact native shape notify-plan.js's athlete planner returns.
 */
export function planCoachNotifications({
  nowMin, dateISO = '', entries = [], interventions = [], prefs: rawPrefs = null, lastAlertKeys = [],
}) {
  void dateISO; // accepted, not consumed — see header
  const prefs = normalizeCoachPrefs(rawPrefs);
  if (!prefs.enabled) return [];

  const elig = eligibleEntries(entries, interventions);
  const groups = groupOverdueItems(elig);
  const out = [];

  // Grouped window alerts — one per overdue item id still standing after dedupe.
  for (const id of Object.keys(groups).sort()) {
    const g = groups[id];
    const latestDue = g.rows.reduce((m, r) => (typeof r.dueMin === 'number' && r.dueMin > m ? r.dueMin : m), nowMin);
    const natural = Math.max(nowMin + 15, latestDue + 30);
    const fireAtMin = quietPlace(natural, prefs, nowMin, 180);
    if (fireAtMin == null || fireAtMin >= 1440) continue;
    const names = g.rows.map((r) => r.name);
    out.push({
      id: `cn-due-overdue:${id}:${names.length}`, fireAtMin: clampMin(fireAtMin), dayOffset: 0,
      immediate: false, stage: 'due', route: 'coach-inbox',
      title: groupTitle(names, g.title), body: namesBody(names),
    });
  }

  // Morning briefing — an honest snapshot ("Open for the latest" flags its own staleness).
  if (prefs.briefing && prefs.briefingAt > nowMin) {
    const fireAtMin = quietPlace(prefs.briefingAt, prefs, nowMin, null);
    if (fireAtMin != null && fireAtMin < 1440) {
      const overdueN = entries.filter((e) => e && e.status && e.status.key === 'overdue').length;
      const dueTodayN = entries.filter((e) => e && e.status && e.status.key === 'due_soon').length;
      out.push({
        id: 'cn-open-briefing', fireAtMin: clampMin(fireAtMin), dayOffset: 0, immediate: false,
        stage: 'open', route: 'coach-home', title: 'Morning read',
        body: `${overdueN} overdue from yesterday · ${dueTodayN} due today. Open for the latest.`,
      });
    }
  }

  // Evening recap.
  if (prefs.recap && prefs.recapAt > nowMin) {
    const fireAtMin = quietPlace(prefs.recapAt, prefs, nowMin, null);
    if (fireAtMin != null && fireAtMin < 1440) {
      const onN = entries.filter((e) => e && e.status && e.status.key === 'on_standard').length;
      const openN = entries.filter((e) => e && e.status && e.status.key !== 'on_standard' && e.status.key !== 'excused').length;
      out.push({
        id: 'cn-open-recap', fireAtMin: clampMin(fireAtMin), dayOffset: 0, immediate: false,
        stage: 'open', route: 'coach-insights', title: 'Evening recap',
        body: `${onN} finished on standard · ${openN} still open.`,
      });
    }
  }

  // Hourly overdue summary — next 3 hourly marks, only while something is actually overdue.
  if (prefs.hourly) {
    const totalOverdue = elig.reduce((sum, e) => sum + (e.status.openItems || []).filter((it) => it.state === 'overdue').length, 0);
    const athleteN = elig.filter((e) => (e.status.openItems || []).some((it) => it.state === 'overdue')).length;
    if (totalOverdue > 0) {
      let mark = (Math.floor(nowMin / 60) + 1) * 60;
      for (let i = 0; i < 3 && mark < 1440; i++, mark += 60) {
        const fireAtMin = quietPlace(mark, prefs, nowMin, null);
        if (fireAtMin == null || fireAtMin >= 1440) continue;
        out.push({
          id: `cn-soon-hourly:${mark}`, fireAtMin: clampMin(fireAtMin), dayOffset: 0, immediate: false,
          stage: 'soon', route: 'coach-inbox',
          title: `${totalOverdue} requirement${totalOverdue === 1 ? '' : 's'} overdue across ${athleteN} athletes`,
          body: 'Open the inbox to clear them.',
        });
      }
    }
  }

  // Immediate critical — at most one, only for a signature NEW since the last sync.
  if (prefs.immediateCritical) {
    const keysNow = alertKeys(entries);
    const lastSet = new Set(lastAlertKeys || []);
    const newKeys = keysNow.filter((k) => !lastSet.has(k));
    for (const k of newKeys) {
      const m = /^overdue:(.+):(\d+)$/.exec(k);
      if (!m) continue;
      const itemId = m[1];
      const rawN = Number(m[2]);
      if (!(rawN >= 2)) continue;
      const g = groups[itemId];
      if (!g || g.rows.length < 1) continue; // fully handled since — nothing left worth saying
      const names = g.rows.map((r) => r.name);
      let immediate = true;
      let fireAtMin = nowMin;
      if (inQuiet(nowMin, prefs) && prefs.allowCriticalInQuiet === false) {
        immediate = false;
        fireAtMin = prefs.quietTo;
        if (!(fireAtMin > nowMin) || fireAtMin >= 1440) break; // can't place it at all — drop
      }
      out.push({
        id: `cn-due-immediate:${k}`, fireAtMin: clampMin(fireAtMin), dayOffset: 0, immediate,
        stage: 'due', route: 'coach-inbox', title: groupTitle(names, g.title), body: namesBody(names),
      });
      break; // one immediate (or its quiet-demoted slot) max per plan
    }
  }

  out.sort((a, b) => a.fireAtMin - b.fireAtMin);
  if (out.length <= 8) return out;

  return out
    .slice()
    .sort((a, b) => rankOf(b) - rankOf(a) || a.fireAtMin - b.fireAtMin)
    .slice(0, 8)
    .sort((a, b) => a.fireAtMin - b.fireAtMin);
}
