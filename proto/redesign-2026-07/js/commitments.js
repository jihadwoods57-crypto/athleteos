/* OnStandard — Verified Commitments engine.
   PURE: no DOM, no Supabase, no clock, no locale. Every function takes what it needs as an
   argument — the same contract requirements.js and notify-plan.js hold — so node --test can
   exercise it directly and a CI box in UTC agrees with a laptop in New York.

   Vocabulary note (founder decision 2026-07-22): "commitment" is COACH-facing vocabulary. The
   athlete never sees the bare word — they see the coach's own title ("Morning Roll Call",
   "5 AM Club"), and the rollup is called Morning Readiness / Accountability. The shipped
   Daily Commitment (screens/commitment.js) is a DIFFERENT thing — its weight is permanently 0
   (the reflection is captured and shown to the coach, it just no longer scores) — and is
   deliberately untouched by this module.

   ⚠ Nothing here feeds the daily 0–100 score. Verified Commitments produces its own
   Accountability score (accountability() below). day.js is not imported and must not be. */
import { fmtMin } from './requirements.js';

/* ================================================================================
   THE MORNING ROLL CALL IS SWITCHED OFF (founder, 2026-09-02): "remove the morning
   roll call completely for now from the app."

   FOR NOW is the operative word. Nothing is deleted — not a migration, not a table,
   not a row, not a screen. This is a switch, thrown in two places, and it comes back
   by throwing both:

     1. SERVER (the authority, and the half that matters): the `verified_commitments`
        kill switch. Off, every read returns [], the write trigger refuses, the
        materializer stops, and BOTH push rungs claim nothing (the 6:05 escalation
        only started honouring it in 0217 — before that, switching off still buzzed
        phones). So no card, no notification, no cron work, whatever the client does.
            back on:  update feature_flags set kill_switch = false
                        where name = 'verified_commitments';

     2. CLIENT (this constant): with the server empty, every DATA-driven surface goes
        quiet on its own — both Home cards, the board, Morning Readiness. What does
        not is the static furniture: the create-menu entry, the composer, the manage
        button, the Progress link. A coach tapping those would land in a live-looking
        form that writes into a feature that no longer exists. So this constant hides
        exactly that furniture and nothing else.
            back on:  ROLLCALL_OFF = false, then rebuild proto.zip and ship an OTA.

   Both halves are independent on purpose. The server one alone is enough to make the
   product inert; this one alone would only hide the doors. Turning it back on wants
   both, and the server first.
   ================================================================================ */
export const ROLLCALL_OFF = true;

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
export function offsetFor(row, nowISO, override) {
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

/* ---------------------------------------------------------------- wake-up verdict (0211, 0212)

   The mirror of rollcall_verdict() / rollcall_closes_at() / rollcall_opens_at() in
   supabase/migrations/0212_rollcall_clock_and_provenance.sql. Same inputs, same order of
   resolution, so the athlete's card, the coach's board and the server's summary read one answer
   off one clock. Never read the environment: `nowISO` is always an argument.

   THE CLOCK. Three instants: OPEN (the wake-up time), GRACE (open + grace), CLOSE (open + 30 min
   unless the coach set one). On Standard at or before grace, Late after it, Missed at close and
   final: nothing after the close can turn a Missed into a Late.

   PROVENANCE. An athlete's tap (lock screen or app), a coach override, and an accepted review are
   three different events. All three read On Standard; none of them is ever summed as "checked in"
   with the others. REVIEW is a fourth thing: a tap whose receipt crossed a boundary the device's
   own evidence did not. It counts as nothing until a coach resolves it. */
export const VERDICT = {
  ON_STANDARD: 'on_standard', LATE: 'late', PENDING: 'pending', MISSED: 'missed', EXCUSED: 'excused',
  REVIEW: 'review',
};
export const VERDICT_LABEL = {
  on_standard: 'On Standard', late: 'Late', pending: 'Pending', missed: 'Missed', excused: 'Excused',
  review: 'Under review',
};
/* A wake-up with no explicit close closes 30 minutes after the wake-up time. */
export const ROLLCALL_CLOSE_AFTER_MIN = 30;
/* The card appears this long before the roll call opens, as "Opens at 6:00", with no button. */
export const ROLLCALL_PREVIEW_MIN = 15;

const isoPlusMin = (iso, min) => {
  const t = Date.parse(iso || '');
  return isFinite(t) ? new Date(t + min * 60000).toISOString() : null;
};

/** The instant an answer is judged against. respond_by_at, else the start. */
export function deadlineOf(row) {
  return (row && (row.respond_by_at || row.starts_at)) || null;
}

/** When the roll call stops accepting answers. Server value first; the same fallback rule the
 *  SQL applies when it is absent. Null = never closes (non-roll-call types). */
export function closesAtOf(row) {
  const r = row || {};
  if (r.closes_at) return r.closes_at;
  if (r.ends_at) return r.ends_at;
  if (r.type === 'morning_roll_call') return isoPlusMin(r.starts_at, ROLLCALL_CLOSE_AFTER_MIN);
  return null;
}

/** When the roll call opens. Server value first; a wake-up opens AT its time; every other type an
 *  hour before its deadline (the pre-0211 rule). */
export function opensAtOf(row) {
  const r = row || {};
  if (r.opens_at) return r.opens_at;
  if (typeof r.opens_min === 'number' && typeof r.starts_min === 'number') {
    return isoPlusMin(r.starts_at, r.opens_min - r.starts_min);
  }
  if (r.type === 'morning_roll_call') return r.starts_at || null;
  return isoPlusMin(deadlineOf(r), -60);
}

/** The coach's grace period in minutes, or null when the roll call has no deadline. */
export function graceMinOf(row) {
  const r = row || {};
  if (typeof r.grace_min === 'number') return r.grace_min;
  if (typeof r.respond_by_min === 'number' && typeof r.starts_min === 'number') return r.respond_by_min - r.starts_min;
  return null;
}

/* Provenance. */
export const SOURCE = { LOCKSCREEN: 'lockscreen', APP: 'app', OVERRIDE: 'override', ACCEPTED: 'review_accepted' };
export const SOURCE_LABEL = {
  lockscreen: 'Lock screen check-in', app: 'In-app check-in',
  override: 'Coach override', staff: 'Coach override', review_accepted: 'Tap time accepted by coach',
};
/** Normalised source: pre-0212 'staff' reads as 'override'. Null when nothing was recorded. */
export function sourceOf(row) {
  const s = row && row.ack_source;
  if (s === 'staff') return SOURCE.OVERRIDE;
  return s === 'lockscreen' || s === 'app' || s === 'override' || s === 'review_accepted' ? s : null;
}
export const isAthleteTap = (row) => { const s = sourceOf(row); return s === SOURCE.LOCKSCREEN || s === SOURCE.APP; };
export const isOverride = (row) => sourceOf(row) === SOURCE.OVERRIDE;
/** A delayed-sync review nobody has resolved yet. Needs no clock. */
export const isUnderReview = (row) => !!(row && row.sync_review && !row.review_resolution);

/** excused | review | on_standard | late | pending | missed. `deadlineISO` / `closesISO` let a board
 *  row (which carries no instance times) be judged against its instance. */
export function rollcallVerdict(row, nowISO, deadlineISO, closesISO) {
  const r = row || {};
  if (r.status === 'excused') return VERDICT.EXCUSED;
  if (isUnderReview(r)) return VERDICT.REVIEW;
  if (r.review_resolution === 'accepted') return VERDICT.ON_STANDARD;
  if (r.review_resolution === 'late') return VERDICT.LATE;
  if (r.review_resolution === 'missed') return VERDICT.MISSED;
  const dl = Date.parse(deadlineISO || deadlineOf(r) || '');
  if (r.acknowledged_at) {
    if (isOverride(r) || sourceOf(r) === SOURCE.ACCEPTED) return VERDICT.ON_STANDARD;
    const at = Date.parse(r.acknowledged_at);
    return (!isFinite(dl) || at <= dl) ? VERDICT.ON_STANDARD : VERDICT.LATE;
  }
  const now = Date.parse(nowISO || '');
  const close = Date.parse(closesISO || closesAtOf(r) || '');
  // Inclusive at the close, exactly as the ack RPC is: 6:30:00 still answers, 6:30:01 is missed.
  if (isFinite(close)) return (isFinite(now) && now <= close) ? VERDICT.PENDING : VERDICT.MISSED;
  if (!isFinite(dl) || !isFinite(now) || now < dl) return VERDICT.PENDING;
  return VERDICT.MISSED;
}

/** Whole minutes late, rounded up. Null unless the answer came after the deadline. */
export function lateMinutes(row, deadlineISO) {
  const r = row || {};
  const at = Date.parse(r.acknowledged_at || '');
  const dl = Date.parse(deadlineISO || deadlineOf(r) || '');
  if (!isFinite(at) || !isFinite(dl) || at <= dl) return null;
  return Math.ceil((at - dl) / 60000);
}

/** Where a wake-up roll call is on its own clock:
 *  'before' (not open yet) · 'open' (grace running) · 'late' (grace over, still accepting) · 'closed'. */
export function wakeupPhase(row, nowISO) {
  const r = row || {};
  const now = Date.parse(nowISO || '');
  const dl = Date.parse(deadlineOf(r) || '');
  const close = Date.parse(closesAtOf(r) || '');
  const open = Date.parse(opensAtOf(r) || '');
  if (isFinite(close) && now > close) return 'closed';
  if (isFinite(dl) && now > dl) return 'late';
  if (isFinite(open) && now < open) return 'before';
  return 'open';
}

/** "On Standard" · "Late · 6 min" · "Missed" · "Under review" for a receipt line. */
export function verdictLine(row, nowISO, deadlineISO, closesISO) {
  const v = rollcallVerdict(row, nowISO, deadlineISO, closesISO);
  if (v === VERDICT.LATE) {
    const m = lateMinutes(row, deadlineISO);
    return m ? `Late · ${m} min` : 'Late';
  }
  return VERDICT_LABEL[v] || '';
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

/* ---------------------------------------------------------------- presence (0208)

   Arrival is a boundary CROSSING. Presence is whether the athlete was actually there for the
   stay the coach asked for. Until 0208 the product conflated them: commitments.min_dwell_min
   round-tripped through the coach's form and gated nothing, because nothing ever wrote
   commitment_responses.departed_at.

   The verdict is computed SERVER-side (commitment_presence, 0208) so the athlete read and the
   coach read cannot disagree, and so the exit debounce survives the app being killed. This
   client only reads it. */
export const PRESENCE = {
  NONE: 'none', PROVISIONAL: 'provisional', CONFIRMED: 'confirmed', LEFT_EARLY: 'left_early',
};

/** The server's verdict, with a deliberate degrade for payloads that predate 0208.
 *
 *  An older server sends no `presence` field at all. Reading that as anything other than
 *  'confirmed' would retroactively downgrade every arrival already on the record, so a missing
 *  verdict means exactly what it meant before this migration existed: they arrived, and there was
 *  no stay requirement anyone could check. Never invent 'left_early' from absence. */
export function presenceOf(row) {
  const r = row || {};
  if (r.arrived_at == null) return PRESENCE.NONE;
  const p = r.presence;
  return (p === PRESENCE.PROVISIONAL || p === PRESENCE.CONFIRMED || p === PRESENCE.LEFT_EARLY)
    ? p : PRESENCE.CONFIRMED;
}

/** Whether the arrival signal is EARNED, for scoring.
 *
 *  Founder ruling 2026-08-23: a sustained departure before the coach's minimum is a VERIFIED
 *  absence and it counts, which is what separates it from 'unverified' (a gap in evidence, always
 *  dropped from the denominator instead).
 *
 *  'provisional' deliberately still counts. Mid-session the answer genuinely is not known yet, and
 *  the alternative is a score that dips while an athlete is sitting in the room doing exactly what
 *  was asked, then silently recovers. Progress must never run backwards on an unresolved fact; it
 *  only moves when a real, sustained departure resolves it. */
const arrivalCounts = (row) => arrivedOnTime(row) && presenceOf(row) !== PRESENCE.LEFT_EARLY;

/* ---------------------------------------------------------------- stages */

// 'Checked in', not 'Acknowledged': the athlete never sees coach vocabulary (header rule in
// screens/roll-call.js), and the card's own confirm line already says "Checked in at 4:48 AM".
const STAGE_LABEL = { acknowledged: 'Checked in', arrived: 'Arrived', completed: 'Completed' };

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
  // The stay is its own stage whenever the coach asked for one (0208). Without this the strip
  // showed "Arrived / Completed" and a 45-minute requirement the coach genuinely cared about was
  // invisible to the athlete on the only screen they actually look at.
  if (asks.arrival && r.min_dwell_min) {
    const p = presenceOf(r);
    stages.push({
      key: 'stayed', label: `Stayed ${r.min_dwell_min}m`,
      done: p === PRESENCE.CONFIRMED,
      at: p === PRESENCE.LEFT_EARLY ? `left ${at(r.departed_at)}`
        : (p === PRESENCE.PROVISIONAL && r.arrived_at)
          ? `${Math.min(r.min_dwell_min, Math.max(0, Math.floor((nowT - Date.parse(r.arrived_at)) / 60000)))}/${r.min_dwell_min}m`
          : '',
    });
  }
  if (asks.completion) stages.push({ key: 'completed', label: STAGE_LABEL.completed, done: !!r.completed_at, at: at(r.completed_at) });

  const base = {
    ...r, title, actionLabel, contextLine, deadlineLine, stages,
    canAck: false, canArrive: false, canComplete: false, canDispute: false,
    collapsed: false, visible: true, confirmLine: '',
    statusColor: 'b',
    // Normalised, so no screen has to know how a pre-0208 payload degrades.
    presence: presenceOf(r),
    // The wake-up verdict (0211), judged on THIS clock rather than the server's read time, so a
    // deadline that passed while the card sat open is reflected on the next paint.
    verdict: rollcallVerdict(r, nowISO),
    lateMin: lateMinutes(r),
    closesAt: closesAtOf(r),
    opensAt: opensAtOf(r),
    graceMin: graceMinOf(r),
    source: sourceOf(r),
  };

  // A cancelled instance disappears. It is not a miss — the coach called it off.
  if (r.instance_status === 'cancelled') {
    return { ...base, stage: 'hidden', visible: false };
  }

  if (r.status === 'excused') {
    return { ...base, stage: 'excused', collapsed: true, statusColor: 'b',
      confirmLine: r.excused_reason ? `Excused: ${r.excused_reason}` : 'Excused' };
  }

  // Never 'missed'. A dead phone, a revoked permission or weak GPS is a gap in evidence,
  // not a failure of the athlete — and they get a one-tap way to say so.
  if (r.status === 'unverified') {
    return { ...base, stage: 'unverified', canDispute: true, statusColor: 'a',
      confirmLine: r.unverified_reason
        ? `Couldn’t verify: ${r.unverified_reason}`
        : 'Couldn’t verify' };
  }

  if (r.completed_at) {
    // A completion does not erase a verified early departure (0208). The receipt keeps the
    // verdict: completion earned, arrival forfeited, dispute still open. Without this branch,
    // tapping "Mark complete" on an amber card upgraded it to a clean green receipt while
    // accountability() still withheld the arrival weight — the card lied about the score.
    if (presenceOf(r) === PRESENCE.LEFT_EARLY) {
      const where = r.location_name || 'the facility';
      const left = at(r.departed_at);
      return { ...base, stage: 'completed', collapsed: true, statusColor: 'a', canDispute: true,
        confirmLine: left
          ? `Completed at ${at(r.completed_at)} · left ${where} at ${left}`
          : `Completed at ${at(r.completed_at)} · left ${where} early` };
    }
    return { ...base, stage: 'completed', collapsed: true, statusColor: 'g',
      confirmLine: `Completed at ${at(r.completed_at)}` };
  }

  if (r.arrived_at) {
    const where = r.location_name || 'the facility';

    // The coach asked for a minimum stay and it has not been met yet. Blue, not green: a session
    // still running is not a result. Painting it green and walking it back later is the one move
    // an honest record cannot make, so the settled colour is withheld until it IS settled.
    if (base.presence === PRESENCE.PROVISIONAL) {
      // The one number that governs the athlete's next N minutes: how much of the stay is
      // banked. Clamped both ways so clock skew can never print "48 of 45" or a negative.
      const doneMin = Math.min(r.min_dwell_min || 0,
        Math.max(0, Math.floor((nowT - Date.parse(r.arrived_at)) / 60000)));
      return { ...base, stage: 'arrived', statusColor: 'b',
        canComplete: asks.completion,
        confirmLine: r.min_dwell_min
          ? `At ${where} since ${at(r.arrived_at)} · ${doneMin} of ${r.min_dwell_min} min`
          : `At ${where} since ${at(r.arrived_at)}` };
    }

    // A sustained departure before the minimum. Verified absence, which the founder ruled counts
    // (2026-08-23) — and precisely because it counts, it is disputable. The grace in 0208 makes a
    // GPS wobble unlikely to reach here; `canDispute` is what covers the case where one does.
    if (base.presence === PRESENCE.LEFT_EARLY) {
      const left = at(r.departed_at);
      return { ...base, stage: 'left_early', statusColor: 'a',
        canComplete: asks.completion, canDispute: true,
        confirmLine: left ? `Left ${where} at ${left}` : `Left ${where} early` };
    }

    return { ...base, stage: 'arrived', statusColor: 'g',
      canComplete: asks.completion,
      confirmLine: `Arrived at ${where} at ${at(r.arrived_at)}` };
  }

  if (r.acknowledged_at) {
    // A delayed-sync tap the coach has not resolved (0212): suspended, not a verdict. Neutral ink,
    // collapsed, disputable in the sense that the athlete can see it is waiting on a decision.
    if (base.verdict === VERDICT.REVIEW) {
      return { ...base, stage: 'review', collapsed: true, statusColor: 'b',
        confirmLine: `Tapped ${at(r.device_tapped_at)} on your phone · reached us ${at(r.acknowledged_at)}` };
    }
    // The receipt leads with the VERDICT; the stamp supports it. A late answer is a real answer and
    // stays recorded, but reads amber and says how late. A coach override reads On Standard and
    // says so: it is never dressed as the athlete's own tap.
    const late = base.verdict === VERDICT.LATE;
    const confirm = base.source === SOURCE.OVERRIDE ? `Coach override · marked at ${at(r.acknowledged_at)}`
      : base.source === SOURCE.ACCEPTED ? `Tap time accepted · tapped ${at(r.device_tapped_at || r.acknowledged_at)}`
      : late ? `Late${base.lateMin ? ` · ${base.lateMin} min` : ''} · checked in at ${at(r.acknowledged_at)}`
      : `Checked in at ${at(r.acknowledged_at)}`;
    if (asks.arrival) {
      return { ...base, stage: 'awaiting_arrival', canArrive: true, statusColor: 'b', confirmLine: confirm };
    }
    return { ...base, stage: 'acknowledged', collapsed: true, statusColor: late ? 'a' : 'g',
      confirmLine: confirm };
  }

  // Nothing recorded yet — now the clock decides.
  const deadlineISO = r.respond_by_at || r.arrive_by_at || r.ends_at || r.starts_at;
  const deadlineT = Date.parse(deadlineISO || '');
  if (isFinite(deadlineT) && nowT > deadlineT) {
    const noResponse = deadlineLine
      // "No response by 5:15 AM" keeps the meridiem exactly as every other stamp prints it —
      // the old .toLowerCase() mangled the whole line into "respond by 5:15 am".
      ? `No response by ${deadlineLine.replace(/^(?:Respond|Arrive) by /, '')}`
      : 'No response';
    // Past the deadline but before the roll call CLOSES (0211): the athlete can still answer,
    // and the answer will be recorded as late. The button stays, relabelled so nobody mistakes
    // it for being on time. A roll call with no close (older types) goes straight to missed.
    const closeT = Date.parse(base.closesAt || '');
    if (asks.ack && isFinite(closeT) && nowT <= closeT) {
      return { ...base, stage: 'late_open', canAck: true, canDispute: true, statusColor: 'a',
        actionLabel: 'Check in now', confirmLine: noResponse };
    }
    return { ...base, stage: 'missed', canDispute: true, statusColor: 'a', confirmLine: noResponse };
  }

  // Before it opens. A wake-up shows a button-less "Opens at 6:00" card for the last 15 minutes
  // (0212) so nobody hunts for it at 5:58; anything earlier, and every other type, stays hidden.
  const opensT = Date.parse(base.opensAt || '');
  if (isFinite(opensT) && nowT < opensT) {
    if (r.type === 'morning_roll_call' && nowT >= opensT - ROLLCALL_PREVIEW_MIN * 60000) {
      return { ...base, stage: 'upcoming', statusColor: 'b',
        confirmLine: `Opens at ${at(base.opensAt)}` };
    }
    return { ...base, stage: 'hidden', visible: false };
  }
  const opens = opensMinFor(r);
  if (nowMin != null && nowMin < opens && r.type !== 'morning_roll_call') {
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
    // A verified early departure (0208). Counted separately so the coach's "9 of 11 in" line
    // can say who arrived but did not stay — otherwise the board contradicts the athlete's card.
    leftEarly: list.filter(r => r.arrived_at != null && presenceOf(r) === PRESENCE.LEFT_EARLY).length,
  };
}

/** The list the coach actually needs: who has not answered. Never rendered publicly.
 *  Keyed on the ANSWER, not the status: the escalation ladder marks every non-responder 'missed'
 *  at the deadline, which is precisely when the coach looks at this list. A status-only filter
 *  returned nobody from that moment on (the 0209 remind_missing bug, now closed here too). */
export function missingFrom(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => !r.acknowledged_at && (r.status === 'pending' || r.status === 'missed'));
}

/** Board rows judged against their instance: each row gains `verdict`, `lateMin`, `source`,
 *  `pastGrace`. The board payload carries the deadline and close on the INSTANCE, not the row. */
export function boardVerdicts(inst, nowISO) {
  const i = inst || {};
  const dl = deadlineOf(i);
  const close = closesAtOf(i);
  const now = Date.parse(nowISO || '');
  const dlT = Date.parse(dl || '');
  return (Array.isArray(i.rows) ? i.rows : []).map((r) => ({
    ...r,
    verdict: rollcallVerdict(r, nowISO, dl, close),
    lateMin: lateMinutes(r, dl),
    source: sourceOf(r),
    pastGrace: isFinite(dlT) && isFinite(now) && now > dlT,
  }));
}

/** The groups the roll-call board draws, in the order the coach reads them at 6:05:
 *  review (needs a decision) · still_out (past grace, unanswered, still open) · pending · late ·
 *  on_standard · excused. */
export function groupByVerdict(inst, nowISO) {
  const g = { review: [], still_out: [], pending: [], late: [], on_standard: [], excused: [] };
  for (const r of boardVerdicts(inst, nowISO)) {
    if (r.verdict === VERDICT.PENDING && r.pastGrace) g.still_out.push(r);
    else if (r.verdict === VERDICT.MISSED) g.still_out.push(r); // labelled Missed by the caller once closed
    else (g[r.verdict] || g.pending).push(r);
  }
  return g;
}

/** Counts for the board header. An athlete tap and a coach decision are never summed under one
 *  word: `checkedIn` is athlete taps only; `accountedFor` is everyone whose morning has an answer
 *  (taps + overrides + accepted reviews + excused); the remainder is out, missed, or under review. */
export function verdictCounts(inst, nowISO) {
  const rows = boardVerdicts(inst, nowISO);
  const by = (f) => rows.filter(f).length;
  const total = rows.length;
  const onStandard = by((r) => r.verdict === VERDICT.ON_STANDARD);
  const late = by((r) => r.verdict === VERDICT.LATE);
  const checkedIn = by((r) => (r.verdict === VERDICT.ON_STANDARD || r.verdict === VERDICT.LATE) && isAthleteTap(r));
  const overrides = by((r) => r.source === SOURCE.OVERRIDE);
  const accepted = by((r) => r.source === SOURCE.ACCEPTED);
  const excused = by((r) => r.verdict === VERDICT.EXCUSED);
  const review = by((r) => r.verdict === VERDICT.REVIEW);
  const missed = by((r) => r.verdict === VERDICT.MISSED);
  const pending = by((r) => r.verdict === VERDICT.PENDING && !r.pastGrace);
  const stillOut = by((r) => r.verdict === VERDICT.PENDING && r.pastGrace);
  return {
    total, onStandard, late, checkedIn, overrides, accepted, excused, review, missed, pending, stillOut,
    responded: onStandard + late,
    accountedFor: checkedIn + overrides + accepted + excused,
    counted: total - excused,
  };
}

/* ---------------------------------------------------------------- wake-up history (0211) */

/** The athlete's own wake-up record, newest first, one line per occurrence: the verdict, the
 *  stamp (in the team's clock), how late, and where the answer came from. */
export function wakeupHistory(rows, nowISO, offMinOverride) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.type === 'morning_roll_call' && r.instance_status !== 'cancelled')
    .sort((a, b) => (a.occurs_on < b.occurs_on ? 1 : a.occurs_on > b.occurs_on ? -1 : 0))
    .map((r) => {
      const off = offsetFor(r, nowISO, offMinOverride);
      return {
        instance_id: r.instance_id, occurs_on: r.occurs_on, title: r.title,
        verdict: rollcallVerdict(r, nowISO), lateMin: lateMinutes(r), source: sourceOf(r),
        at: r.acknowledged_at ? fmtAt(r.acknowledged_at, off) : '',
        due: deadlineOf(r) ? fmtAt(deadlineOf(r), off) : '',
        close: closesAtOf(r) ? fmtAt(closesAtOf(r), off) : '',
      };
    });
}

/** Totals over a wake-up history. Pending and review are not results yet; overrides are listed
 *  beside the On Standard they contribute to, never hidden inside it. */
export function wakeupSummary(history) {
  const s = { total: 0, onStandard: 0, late: 0, missed: 0, overrides: 0, review: 0 };
  for (const h of (Array.isArray(history) ? history : [])) {
    if (h.verdict === VERDICT.REVIEW) { s.review++; continue; }
    if (h.verdict === VERDICT.PENDING || h.verdict === VERDICT.EXCUSED) continue;
    s.total++;
    if (h.verdict === VERDICT.ON_STANDARD) { s.onStandard++; if (h.source === SOURCE.OVERRIDE) s.overrides++; }
    else if (h.verdict === VERDICT.LATE) s.late++;
    else if (h.verdict === VERDICT.MISSED) s.missed++;
  }
  return s;
}

/** Reduce the coach's rollcall_summary rows to one line: "Last 14 roll calls: 12 / 1 / 1". */
export function summarizeOccurrences(occ) {
  const s = { occurrences: 0, onStandard: 0, late: 0, missed: 0, total: 0, overrides: 0, review: 0 };
  for (const o of (Array.isArray(occ) ? occ : [])) {
    if (!o || o.instance_status === 'cancelled') continue;
    s.review += Number(o.review) || 0;
    // A day still in progress (anyone pending) is not a result yet.
    if (Number(o.pending) > 0) continue;
    s.occurrences++;
    s.onStandard += Number(o.on_standard) || 0;
    s.late += Number(o.late) || 0;
    s.missed += Number(o.missed) || 0;
    s.total += Number(o.total) || 0;
    s.overrides += Number(o.overrides) || 0;
  }
  return s;
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
    // A delayed-sync review (0212) is suspended: it leaves both earned and possible until resolved.
    if (asks.ack && !isUnderReview(r)) {
      possible += WEIGHTS.ack;
      if (r.acknowledged_at && r.review_resolution !== 'missed') earned += WEIGHTS.ack;
    }
    if (asks.arrival && verified) {
      possible += WEIGHTS.arrival;
      if (arrivalCounts(r)) earned += WEIGHTS.arrival;
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
    if (asks.ack && !isUnderReview(r)) { wake.total++; if (r.acknowledged_at && r.review_resolution !== 'missed') wake.done++; }
    if (asks.arrival && verified) { arrival.total++; if (arrivalCounts(r)) arrival.done++; }
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
    if (asks.ack && !isUnderReview(r) && (!r.acknowledged_at || r.review_resolution === 'missed')) return false;
    if (asks.arrival && verified && !arrivalCounts(r)) return false;
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

/* ================================================================================
   SCHEDULE AHEAD (0215). The coach manages the NEXT roll call and the week: a day can
   carry its own wake-up time or be skipped. These read what the server reports on an
   occurrence (`starts_min` is the DAY's effective minute, `rule_starts_min` the rule's,
   `skipped` the flag, `instance_status` 'cancelled' for a skipped day) and never guess.
   ================================================================================ */
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Today' · 'Tomorrow' · 'Wed, Sep 9'. Deterministic (no locale), so the strip and the header
 *  say the same thing on every device. */
export function dayLabel(occursOn, todayISO) {
  const d = String(occursOn || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  if (todayISO && d === todayISO) return 'Today';
  if (todayISO && d === addDays(todayISO, 1)) return 'Tomorrow';
  const t = new Date(d + 'T12:00:00');
  if (isNaN(t)) return d;
  return `${DOW_SHORT[t.getDay()]}, ${MON_SHORT[t.getMonth()]} ${t.getDate()}`;
}

/** What the coach did to this day, in one line. `kind`: 'skipped' | 'moved' | 'standing'. */
export function scheduleState(o) {
  const r = o || {};
  if (r.skipped || r.instance_status === 'cancelled') {
    return { kind: 'skipped', line: 'Skipped. Nobody gets a roll call this day.' };
  }
  const moved = r.starts_override_min != null && r.rule_starts_min != null
    && Number(r.starts_override_min) !== Number(r.rule_starts_min);
  if (moved) {
    return { kind: 'moved', line: `Moved to ${fmtMin(Number(r.starts_override_min))} this day only. Usually ${fmtMin(Number(r.rule_starts_min))}.` };
  }
  return { kind: 'standing', line: '' };
}

/** The next roll call a coach can still act on: the first occurrence whose close is ahead of
 *  now (a skipped day counts, so the coach can put it back), else null. */
export function nextRollcall(upcoming, nowISO) {
  const now = Date.parse(nowISO || '');
  const rows = (Array.isArray(upcoming) ? upcoming : []).slice()
    .sort((a, b) => String(a.occurs_on).localeCompare(String(b.occurs_on)));
  for (const o of rows) {
    const close = Date.parse(closesAtOf(o) || o.starts_at || '');
    if (isFinite(close) && isFinite(now) && close <= now) continue;
    return o;
  }
  return null;
}

/* ================================================================================
   REACH + TONIGHT'S PREVIEW (0216).
   ================================================================================ */

/** Who can actually receive the push, from the board's per-row `can_push`. null when the server
 *  never said (a pre-0216 read), so nothing is claimed either way. Excused rows are outside the
 *  denominator, as everywhere else. */
export function reachCounts(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.status !== 'excused' && r.verdict !== VERDICT.EXCUSED);
  if (!list.length || !list.some((r) => typeof r.can_push === 'boolean')) return null;
  const reachable = list.filter((r) => r.can_push !== false).length;
  return { total: list.length, reachable, unreachable: list.length - reachable };
}

/** Tomorrow's wake-up, for the athlete's evening (0216): the row my_commitments already returns
 *  for tomorrow, read for the two facts that decide an alarm. null when there is none. */
export function tomorrowRollcall(rows, todayISO) {
  if (!todayISO) return null;
  const tomorrow = addDays(todayISO, 1);
  const r = (Array.isArray(rows) ? rows : []).find((x) => x && x.type === 'morning_roll_call' && x.occurs_on === tomorrow);
  if (!r) return null;
  const skipped = r.instance_status === 'cancelled';
  const moved = !skipped && r.rule_starts_min != null && r.starts_min != null
    && Number(r.starts_min) !== Number(r.rule_starts_min);
  return {
    instance_id: r.instance_id, title: r.title || TYPE_LABEL.morning_roll_call,
    coach_name: r.coach_name || '', startsMin: r.starts_min != null ? Number(r.starts_min) : null,
    skipped, moved, excused: r.status === 'excused',
  };
}
