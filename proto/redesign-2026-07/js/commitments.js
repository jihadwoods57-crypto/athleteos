/* OnStandard — Verified Commitments engine.
   PURE: no DOM, no Supabase, no clock, no locale. Every function takes what it needs as an
   argument — the same contract requirements.js and notify-plan.js hold — so node --test can
   exercise it directly and a CI box in UTC agrees with a laptop in New York.

   Vocabulary note (founder decision 2026-07-22): "commitment" is COACH-facing vocabulary. The
   athlete never sees the bare word — they see the coach's own title ("Morning Roll Call",
   "5 AM Club"), and the rollup is called Morning Readiness / Accountability. The shipped
   Daily Commitment (15% of the daily score, screens/commitment.js) is a DIFFERENT thing and is
   deliberately untouched by this module.

   ⚠ Nothing here feeds the daily 0–100 score. Verified Commitments produces its own
   Accountability score (accountability() below). day.js is not imported and must not be. */
import { fmtMin } from './requirements.js';

export const TYPE_LABEL = {
  morning_roll_call: 'Morning Roll Call',
  practice:          'Practice',
  strength:          'Strength Workout',
  speed:             'Speed Session',
  team_meeting:      'Team Meeting',
  study_hall:        'Study Hall',
  tutoring:          'Tutoring',
  class:             'Class Commitment',
  rehab:             'Rehab',
  nutrition:         'Nutrition Appointment',
};

/* Render-time defaults ONLY. These are never persisted: the column stays null so the database
   remains honest about whether the coach actually chose the string. */
const DEFAULT_ACTION = {
  morning_roll_call: 'I’m Up',
  practice: 'I’m here', strength: 'I’m here', speed: 'I’m here',
  team_meeting: 'I’m here', study_hall: 'I’m here', tutoring: 'I’m here',
  class: 'I’m here', rehab: 'I’m here', nutrition: 'I’m here',
};

/* ---------------------------------------------------------------- time helpers */

/** The viewer's UTC offset in minutes (EDT = -240). Passed explicitly by tests; defaults to the
 *  device so screens don't have to thread it. */
export function localOffsetMin() { return -new Date().getTimezoneOffset(); }

/** The UTC offset of an IANA zone at a given instant, in minutes. Null for an unknown zone.
 *  DST-correct by construction, because it asks Intl what the wall clock actually reads there
 *  at that moment rather than assuming a fixed offset. */
export function zoneOffsetMin(tz, iso) {
  if (!tz) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const parts = {};
    for (const p of new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(d)) parts[p.type] = p.value;
    const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
      +parts.hour, +parts.minute, +parts.second);
    return Math.round((asUTC - d.getTime()) / 60000);
  } catch { return null; }
}

/** Which clock a commitment's times should be READ in. The coach set 5:15 AM meaning 5:15 in the
 *  team's zone, so a stamp must render in that zone too — otherwise an athlete on a road trip
 *  sees "Respond by 5:15 AM" (team wall clock, from respond_by_min) next to "Checked in at
 *  2:48 AM" (their phone), which reads like a bug even though both are technically true. */
function offsetFor(row, nowISO, override) {
  if (typeof override === 'number') return override;
  const z = row && row.timezone ? zoneOffsetMin(row.timezone, nowISO || new Date().toISOString()) : null;
  return z == null ? localOffsetMin() : z;
}

/** Minute-of-day of an ISO instant, in the target zone. Null for a missing/invalid timestamp. */
export function localMin(iso, offMin) {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return null;
  const d = new Date(t + (offMin || 0) * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "4:48 AM" for an ISO instant, in the target zone. '' when absent. */
export function fmtAt(iso, offMin) {
  const m = localMin(iso, offMin);
  return m == null ? '' : fmtMin(m);
}

const addDays = (dateISO, n) => {
  const t = Date.parse(String(dateISO) + 'T12:00:00Z');
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
};

/* ---------------------------------------------------------------- recurrence */

/** Noon anchor keeps the weekday stable regardless of the device's zone. */
const dowOf = (dateISO) => new Date(String(dateISO) + 'T12:00:00').getDay();

export function occursOn(c, dateISO) {
  if (!c || !Array.isArray(c.repeat_days) || !c.repeat_days.length) return false;
  if (c.starts_on && dateISO < c.starts_on) return false;
  if (c.ends_on && dateISO > c.ends_on) return false;
  return c.repeat_days.map(Number).includes(dowOf(dateISO));
}

/** When the card appears. Falls back to an hour before the response deadline (or the start
 *  time), floored at midnight so a 12:30 AM commitment never wraps onto the previous day. */
export function opensMinFor(c) {
  if (c && typeof c.opens_min === 'number') return c.opens_min;
  const anchor = (c && typeof c.respond_by_min === 'number') ? c.respond_by_min
               : (c && typeof c.starts_min === 'number') ? c.starts_min : 0;
  return Math.max(0, anchor - 60);
}

/* ---------------------------------------------------------------- signals */

/** Which of the three signals this commitment actually asks for.
 *  A roll call IS the wake-up: pressing the button is the whole commitment, so it never asks for
 *  "completion". It asks for arrival only when the coach attached a location. */
export function signalsAsked(row) {
  if (!row) return { ack: false, arrival: false, completion: false };
  return {
    ack: row.respond_by_min != null || row.type === 'morning_roll_call',
    arrival: !!row.asks_arrival,
    completion: row.type !== 'morning_roll_call',
  };
}

const arrivedOnTime = (row) => row.arrived_at != null &&
  (!row.arrive_by_at || Date.parse(row.arrived_at) <= Date.parse(row.arrive_by_at));

/* ---------------------------------------------------------------- stages */

const STAGE_LABEL = { acknowledged: 'Acknowledged', arrived: 'Arrived', completed: 'Completed' };

/** One commitment's live view for the athlete. `nowISO` and `offMin` are arguments, never read
 *  from the environment.
 *
 *  Resolution order matters: 'cancelled', 'excused' and 'unverified' are checked BEFORE any
 *  deadline comparison, because a signal that could not be verified must never be silently
 *  converted into a failure. That is the honesty rule this whole feature rests on. */
export function deriveCommitment(row, nowISO, offMinOverride) {
  const r = row || {};
  const offMin = offsetFor(r, nowISO, offMinOverride);
  const asks = signalsAsked(r);
  const nowT = Date.parse(nowISO || '') || 0;
  const nowMin = localMin(nowISO, offMin);
  const at = (iso) => fmtAt(iso, offMin);

  const title = (r.title && String(r.title).trim()) || TYPE_LABEL[r.type] || 'Commitment';
  const actionLabel = (r.action_label && String(r.action_label).trim())
    || DEFAULT_ACTION[r.type] || 'Mark done';

  const contextLine = (r.linked_title && r.linked_starts_min != null)
    ? `${r.linked_title} at ${fmtMin(r.linked_starts_min)}`
    : (r.starts_min != null ? `At ${fmtMin(r.starts_min)}` : '');

  const deadlineLine = r.respond_by_min != null ? `Respond by ${fmtMin(r.respond_by_min)}`
    : r.arrive_by_min != null ? `Arrive by ${fmtMin(r.arrive_by_min)}` : '';

  const stages = [];
  if (asks.ack) stages.push({ key: 'acknowledged', label: STAGE_LABEL.acknowledged, done: !!r.acknowledged_at, at: at(r.acknowledged_at) });
  if (asks.arrival) stages.push({ key: 'arrived', label: STAGE_LABEL.arrived, done: !!r.arrived_at, at: at(r.arrived_at) });
  if (asks.completion) stages.push({ key: 'completed', label: STAGE_LABEL.completed, done: !!r.completed_at, at: at(r.completed_at) });

  const base = {
    ...r, title, actionLabel, contextLine, deadlineLine, stages,
    canAck: false, canArrive: false, canComplete: false, canDispute: false,
    collapsed: false, visible: true, confirmLine: '',
    statusColor: 'b',
  };

  // A cancelled instance disappears. It is not a miss — the coach called it off.
  if (r.instance_status === 'cancelled') {
    return { ...base, stage: 'hidden', visible: false };
  }

  if (r.status === 'excused') {
    return { ...base, stage: 'excused', collapsed: true, statusColor: 'b',
      confirmLine: r.excused_reason ? `Excused — ${r.excused_reason}` : 'Excused' };
  }

  // Never 'missed'. A dead phone, a revoked permission or weak GPS is a gap in evidence,
  // not a failure of the athlete — and they get a one-tap way to say so.
  if (r.status === 'unverified') {
    return { ...base, stage: 'unverified', canDispute: true, statusColor: 'a',
      confirmLine: r.unverified_reason
        ? `Couldn’t verify — ${r.unverified_reason}`
        : 'Couldn’t verify' };
  }

  if (r.completed_at) {
    return { ...base, stage: 'completed', collapsed: true, statusColor: 'g',
      confirmLine: `Completed at ${at(r.completed_at)}` };
  }

  if (r.arrived_at) {
    const where = r.location_name || 'the facility';
    return { ...base, stage: 'arrived', statusColor: 'g',
      canComplete: asks.completion,
      confirmLine: `Arrived at ${where} at ${at(r.arrived_at)}` };
  }

  if (r.acknowledged_at) {
    if (asks.arrival) {
      return { ...base, stage: 'awaiting_arrival', canArrive: true, statusColor: 'b',
        confirmLine: `Checked in at ${at(r.acknowledged_at)}` };
    }
    return { ...base, stage: 'acknowledged', collapsed: true, statusColor: 'g',
      confirmLine: `Checked in at ${at(r.acknowledged_at)}` };
  }

  // Nothing recorded yet — now the clock decides.
  const deadlineISO = r.respond_by_at || r.arrive_by_at || r.ends_at || r.starts_at;
  const deadlineT = Date.parse(deadlineISO || '');
  if (isFinite(deadlineT) && nowT > deadlineT) {
    return { ...base, stage: 'missed', canDispute: true, statusColor: 'a',
      confirmLine: deadlineLine ? `No response — ${deadlineLine.toLowerCase()}` : 'No response' };
  }

  const opens = opensMinFor(r);
  if (nowMin != null && nowMin < opens) {
    return { ...base, stage: 'hidden', visible: false };
  }

  return { ...base, stage: 'open', canAck: asks.ack,
    canArrive: !asks.ack && asks.arrival, statusColor: 'a' };
}

/* ---------------------------------------------------------------- coach board */

const RESPONDED = new Set(['acknowledged', 'arrived', 'completed']);

export function boardCounts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    responded: list.filter(r => RESPONDED.has(r.status)).length,
    awaiting: list.filter(r => r.status === 'pending').length,
    excused: list.filter(r => r.status === 'excused').length,
    unverified: list.filter(r => r.status === 'unverified').length,
  };
}

/** The list the coach actually needs: who has not answered. Never rendered publicly. */
export function missingFrom(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => r.status === 'pending');
}

/* ---------------------------------------------------------------- accountability
   Founder weighting: pressing the button is a SMALL signal, arriving on time is MODERATE,
   completing the commitment is the GREATEST. Separate from the daily 0–100 score. */

export const WEIGHTS = { ack: 10, arrival: 30, completion: 60 };

export function accountability(rows) {
  let earned = 0, possible = 0;
  for (const r of (Array.isArray(rows) ? rows : [])) {
    // 'excused' leaves the denominator entirely — it cannot be scored honestly either way.
    if (r.status === 'excused') continue;
    const asks = signalsAsked(r);
    // 'unverified' removes only the signals it could not verify. A missed WAKE-UP never
    // cascades into arrival or completion: each signal is weighed on its own.
    const verified = r.status !== 'unverified';
    if (asks.ack) {
      possible += WEIGHTS.ack;
      if (r.acknowledged_at) earned += WEIGHTS.ack;
    }
    if (asks.arrival && verified) {
      possible += WEIGHTS.arrival;
      if (arrivedOnTime(r)) earned += WEIGHTS.arrival;
    }
    if (asks.completion && verified) {
      possible += WEIGHTS.completion;
      if (r.completed_at) earned += WEIGHTS.completion;
    }
  }
  // No data reports null, never a fake zero — an athlete with no commitments has not failed.
  return { earned, possible, pct: possible ? Math.round((earned / possible) * 100) : null };
}

/** The three lines the coach and athlete read, plus the overall percentage. */
export function morningReadiness(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const pair = () => ({ done: 0, total: 0 });
  const wake = pair(), arrival = pair(), completion = pair();
  for (const r of list) {
    if (r.status === 'excused') continue;
    const asks = signalsAsked(r);
    const verified = r.status !== 'unverified';
    if (asks.ack) { wake.total++; if (r.acknowledged_at) wake.done++; }
    if (asks.arrival && verified) { arrival.total++; if (arrivedOnTime(r)) arrival.done++; }
    if (asks.completion && verified) { completion.total++; if (r.completed_at) completion.done++; }
  }
  return { wake, arrival, completion, ...accountability(list) };
}

/** Did this athlete meet every signal their commitments asked for on this date? */
function dayIsClean(dayRows) {
  for (const r of dayRows) {
    if (r.status === 'excused') continue;
    const asks = signalsAsked(r);
    const verified = r.status !== 'unverified';
    if (asks.ack && !r.acknowledged_at) return false;
    if (asks.arrival && verified && !arrivedOnTime(r)) return false;
    if (asks.completion && verified && !r.completed_at) return false;
  }
  return true;
}

/** Consecutive clean days ending today. A day with NO commitments is skipped, not counted and
 *  not a break — a Sunday with nothing scheduled must not end a streak the athlete earned. */
export function commitmentStreak(rows, todayISO, maxDays = 365) {
  const byDay = new Map();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r || !r.occurs_on) continue;
    if (!byDay.has(r.occurs_on)) byDay.set(r.occurs_on, []);
    byDay.get(r.occurs_on).push(r);
  }
  let streak = 0;
  for (let i = 0; i < maxDays; i++) {
    const day = addDays(todayISO, -i);
    const dayRows = byDay.get(day);
    if (!dayRows || !dayRows.length) {
      // Stop walking once we're past every day we have data for.
      if (i > 0 && ![...byDay.keys()].some(k => k < day)) break;
      continue;
    }
    if (!dayIsClean(dayRows)) break;
    streak++;
  }
  return streak;
}

/* ---------------------------------------------------------------- reminders
   Automatic nudges go ONLY to athletes who have not responded — the coach never counts replies
   and never calls anyone out in a group chat.

   These entries carry stage 'commitment' and exemptFromCap, which notify-plan.js honours by
   scheduling them THROUGH quiet hours and outside the daily cap. That is deliberate: default
   quiet hours are 22:00–07:00, so a 4:45 AM roll call would otherwise be silently swallowed and
   the whole feature would quietly not work. This is a scheduled event the coach set, not a nudge
   the app invented — and the phone's own Do Not Disturb still wins. */
export function commitmentReminders(rows, todayISO) {
  const out = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r || r.occurs_on !== todayISO) continue;
    if (r.status !== 'pending') continue;
    if (r.instance_status === 'cancelled') continue;
    const anchor = r.respond_by_min != null ? r.respond_by_min : r.starts_min;
    if (anchor == null) continue;
    const offsets = Array.isArray(r.reminder_offsets_min) ? r.reminder_offsets_min : [];
    for (const off of offsets) {
      const n = Number(off);
      if (!isFinite(n) || n < 0) continue;
      out.push({
        stage: 'commitment',
        exemptFromCap: true,
        at: Math.max(0, anchor - n),
        instanceId: r.instance_id,
        instance_id: r.instance_id,
        title: (r.title && String(r.title).trim()) || TYPE_LABEL[r.type] || 'Commitment',
        body: r.respond_by_min != null
          ? `Respond by ${fmtMin(r.respond_by_min)}.`
          : `Starts at ${fmtMin(anchor)}.`,
      });
    }
  }
  return out;
}
