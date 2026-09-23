// OnStandard — the iOS Live Activity for a Wake-Up Roll Call: the payload half.
// ZERO framework imports: loaded by both Deno (edge) and jest (babel).
//
// WHY A LIVE ACTIVITY AT ALL. A remote notification is drawn by iOS, so the only things we can
// change are four strings and a button label. That is why the roll call read as "a generic system
// notification": it WAS one. A Live Activity is the one lock-screen surface an app draws itself,
// and the only one that can hold a countdown the phone ticks on its own. So the roll call now has
// two surfaces working together, each doing what only it can:
//
//   THE LIVE ACTIVITY is the PRESENCE. It appears at the open (10 minutes before the start, since
//   2026-09-23) and stays until the roll call closes, the check-in included:
//   the coach's name, the state colour, and a timer that counts down to the deadline and then up
//   past it. Nothing has to arrive for it to stay truthful, because the device ticks the clock.
//
//   THE NOTIFICATION is the ANSWER. Its action button records the tap without opening the app and,
//   critically, WORKS WHILE THE DEVICE IS LOCKED. A button inside a Live Activity does not: Apple
//   states that on a locked device "buttons and toggles are inactive and the system doesn't perform
//   actions unless a person authenticates and unlocks their device". Face ID satisfies that with a
//   glance, so the Live Activity keeps its button for a phone in the hand, but the button that has
//   to work at 6 AM on a phone lying face-up on a nightstand is the notification's.
//   (https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities)
//
// NUMBERS ARE EPOCH SECONDS, NOT DATES, on purpose. Apple: "don't use any custom JSON encoding
// strategies... Custom encoding strategies will result in update failures." Swift's default date
// strategy is seconds since the 2001 reference date, which no server would send by accident and
// every server would get wrong. Doubles sidestep the whole class of bug: Swift reads them back with
// Date(timeIntervalSince1970:).

/** The state the card is in. Mirrored by `RollCallPhase` in the widget extension's Swift. */
export type LivePhase = 'initial' | 'reminder' | 'late' | 'answered' | 'missed';

/** Immutable for the life of one activity: who and which roll call. Mirrors `RollCallAttributes`.
 *  Apple treats attributes as fixed, so nothing that can change during the morning belongs here. */
export type LiveAttributes = {
  instanceId: string;
  /** The roll call's own name, e.g. "Wake-Up Roll Call". */
  title: string;
  /** The coach's display name, or "" when the commitment has no named owner. */
  coachName: string;
  /** One or two letters for the avatar circle when no photo has been cached. */
  coachInitials: string;
  /** The coach's own button words. Optional on the wire so an older widget still decodes. */
  actionLabel?: string;
  /** The WINDOW code (rollcall-code.ts signWindowCode) for this athlete + instance, so the card's
   *  I'm Up intent can post the check-in itself with the app closed. "" when the secret is unset
   *  or the instance has no close; the widget then falls back to recording locally. 2026-09-23. */
  ackCode: string;
  /** Where to post it: `${SUPABASE_URL}/functions/v1/roll-call-ack`. "" when unknown. */
  ackUrl: string;
};

/** Everything that changes as the morning runs. Mirrors `RollCallAttributes.ContentState`. */
export type LiveContentState = {
  phase: LivePhase;
  /** Grace end. The countdown runs to this, then counts up past it. */
  deadlineEpoch: number;
  /** Close. After this no answer is accepted and the activity ends. */
  closesEpoch: number;
  /** When the athlete actually answered; null until they do. */
  checkedInEpoch: number | null;
  /** The coach's message, trimmed to one lock-screen line. Empty when there is none. */
  line: string;
  /** 2026-09-23: the team on the card. Up so far (on standard or late) and the roll call's total
   *  (excused athletes left out, exactly as the team board counts). 0 / 0 when unknown. */
  teamUp: number;
  teamTotal: number;
  /** This athlete's place in line once their answer counts; null before (or under review). */
  place: number | null;
  /** What the answer banks toward today's score (pointsFor); null until it counts. */
  points: number | null;
};

/** The team fields of the content state. */
export type LiveTeam = Pick<LiveContentState, 'teamUp' | 'teamTotal' | 'place' | 'points'>;
export const NO_TEAM: LiveTeam = { teamUp: 0, teamTotal: 0, place: null, points: null };

/** The morning's 8 points are one budget shared by every assigned part (Task 1, NIGHT_SHIFT =
 *  WAKEUP_SHIFT = 8, weightsForAssigned). The card shows the ROLL CALL's own share: all 8 when it
 *  is a wake-up alone, 4 when it also asks for an arrival (4 + 4). A Recovery Standard on the same
 *  day could make it 8/3, but the card has no business reading the sleep standard; the day screen
 *  shows the exact figure. */
export function pointsFor(asksArrival: boolean | null | undefined): number {
  return asksArrival ? 4 : 8;
}

/** The slice of rollcall_team_board (0242) the card reads. */
export type BoardRow = {
  athlete_id: string; verdict: string; place: number | null;
  acknowledged_at?: string | null; name?: string | null;
};
export type TeamBoard = {
  instance_id?: string; total: number; up: number; asks_arrival?: boolean | null; rows: BoardRow[];
};

/** Team fields for one athlete off the board. Place and points only once their answer COUNTS
 *  (the board gives a place to on_standard and late only; an answer under review has none). */
export function teamFields(board: TeamBoard | null | undefined, athleteId: string): LiveTeam {
  if (!board) return { ...NO_TEAM };
  const row = (board.rows ?? []).find((r) => r.athlete_id === athleteId);
  const place = row && row.place != null && Number.isFinite(Number(row.place)) ? Number(row.place) : null;
  return {
    teamUp: Number(board.up) || 0,
    teamTotal: Number(board.total) || 0,
    place,
    points: place == null ? null : pointsFor(board.asks_arrival),
  };
}

/** The window a window code is bound to: the open (rollcall_opens_at, 0242) and the close. A card
 *  read by an older RPC has no opens_at, so the 0242 default (10 minutes before the start) stands
 *  in. Null when there is no close: a code with no end is not a code we mint. */
export function liveWindowMs(card: { opens_at?: string | null; starts_at?: string | null; closes_at?: string | null }):
  { opensMs: number; closesMs: number } | null {
  const closesMs = Date.parse(card.closes_at ?? '');
  if (!Number.isFinite(closesMs)) return null;
  let opensMs = Date.parse(card.opens_at ?? '');
  if (!Number.isFinite(opensMs)) {
    const starts = Date.parse(card.starts_at ?? '');
    if (!Number.isFinite(starts)) return null;
    opensMs = starts - 10 * 60 * 1000;
  }
  return { opensMs, closesMs };
}

/** A Live Activity is capped at 160 points tall on the lock screen and truncated past it, so the
 *  coach's message gets ONE line. The whole message stays in the notification body, the bell row
 *  and the app. Cut on a word boundary; never mid-word, never mid-emoji.
 *  (https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) */
export const LIVE_LINE_MAX_CHARS = 64;

export function liveLine(message: string | null | undefined, max = LIVE_LINE_MAX_CHARS): string {
  const flat = (message ?? '').replace(/\s+/g, ' ').trim();
  // Count by code point so a 2-unit emoji is one character, never half of one.
  const chars = [...flat];
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, max - 1).join('');
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

const sec = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? Math.round(t / 1000) : 0;
};

/** Build the content state for one phase. Pure. */
export function liveContentState(row: {
  respond_by_at?: string | null;
  closes_at?: string | null;
  message?: string | null;
}, phase: LivePhase, checkedInAtIso?: string | null, team?: LiveTeam | null): LiveContentState {
  return {
    phase,
    deadlineEpoch: sec(row.respond_by_at),
    closesEpoch: sec(row.closes_at),
    checkedInEpoch: checkedInAtIso ? sec(checkedInAtIso) : null,
    line: liveLine(row.message),
    ...NO_TEAM,
    ...(team ?? {}),
  };
}

/** The `ActivityAttributes` type name, as Swift will spell it. The push must name it exactly or
 *  iOS drops the start silently. */
export const LIVE_ATTRIBUTES_TYPE = 'RollCallAttributes';

/* ---------------------------------------------------------------- the Android half
   Android has no Live Activity. What it has is a notification the OS will tick a chronometer on,
   tint, treat as an alarm, and (on Android 16) pin to the lock screen as a Live Update — none of
   which expo-notifications exposes a push field for. So the facts ride in the push's own `data`
   and RollCallPresentationDelegate (modules/rollcall-live) applies them natively.

   These key names are a hand-kept contract with that Kotlin file, exactly like the notification
   category ids in rollcall-category.ts. A drift here does not throw: the notification simply
   arrives looking ordinary, which is indistinguishable from the feature not existing. */

/** The colour each state paints, matching the proto's own tokens (css/tokens.css):
 *  --blue-bright, --amber, --red. Blue is the calm state because green is status-only app-wide. */
export const LIVE_PHASE_COLOR: Record<'initial' | 'reminder' | 'late' | 'missed', string> = {
  initial: '#60A5FA',
  reminder: '#F5A524',
  late: '#F65757',
  missed: '#F65757',
};

export function rollCallPushData(
  row: { type?: string | null; respond_by_at?: string | null; closes_at?: string | null },
  phase: 'initial' | 'reminder' | 'late' | 'missed',
): Record<string, unknown> {
  // Only a wake-up roll call gets this treatment. Every other commitment type keeps the plain
  // notification it has always had.
  if (row.type !== 'morning_roll_call') return {};
  const deadline = Date.parse(row.respond_by_at ?? '');
  const closes = Date.parse(row.closes_at ?? '');
  return {
    rc_phase: phase,
    // MILLISECONDS here, unlike the Live Activity's seconds: this number is handed straight to
    // Android's `Notification.when`, which is epoch millis.
    ...(Number.isFinite(deadline) ? { rc_deadline: deadline } : {}),
    ...(Number.isFinite(closes) ? { rc_closes: closes } : {}),
    rc_color: LIVE_PHASE_COLOR[phase],
  };
}

/** APNs headers for any Live Activity push. The topic suffix is Apple's, and the dot before
 *  `push-type` is required (Apple's own curl uses it; one table in their docs omits it). */
export function liveActivityHeaders(bundleId: string, jwt: string, priority: LivePriority = 10): Record<string, string> {
  return {
    authorization: `bearer ${jwt}`,
    'apns-push-type': 'liveactivity',
    'apns-topic': `${bundleId}.push-type.liveactivity`,
    // 10 by default: priority 5 is delivered "opportunistically" and may be deferred, and a roll
    // call that arrives late is the one thing this feature cannot do. Only a team count goes at 5
    // (livePriority).
    'apns-priority': String(priority === 5 ? 5 : 10),
    'content-type': 'application/json',
  };
}

/** APNs priority for one Live Activity push (final review I3, 2026-09-23).
 *
 *  iOS budgets priority-10 Live Activity updates per app, and throttles past it. A card now lives
 *  about 40 minutes (open to close) and the team-count fan-out can update it once a minute, so if
 *  every push went at 10 the cosmetic count updates would spend the budget and the ones that matter
 *  (the athlete's own answered card, the amber reminder, the red late) could be delayed or dropped
 *  behind them. So:
 *    'team_count'                                  5   a teammate checked in; the count moves
 *    'start' | 'answered' | 'reminder' | 'late' | 'end'   10  this athlete's own moment
 *  plugins/withRollCallLiveActivity.js leaves NSSupportsLiveActivitiesFrequentUpdates unset; with
 *  the counts at 5 that stays true. */
export type LivePriority = 5 | 10;
export type LivePushKind = 'start' | 'answered' | 'reminder' | 'late' | 'end' | 'team_count';
export function livePriority(kind: LivePushKind): LivePriority {
  return kind === 'team_count' ? 5 : 10;
}

/** `sound` may be '' to alert SILENTLY: the card still lights the screen and carries the words,
 *  but plays nothing. That is the opening push for an athlete whose phone is already ringing a
 *  real alarm for this same morning (0239 alarm_armed_at). The key is omitted from the payload
 *  rather than sent empty, which APNs treats as "no sound". */
export type LiveAlert = { title: string; body: string; sound: string };

function apsAlert(alert: LiveAlert): Record<string, string> {
  return alert.sound ? { title: alert.title, body: alert.body, sound: alert.sound } : { title: alert.title, body: alert.body };
}

/** The `start` payload. Apple requires `event`, an `alert`, `attributes-type` and `attributes`.
 *  `stale-date` is defensive: if the device never reports an update token back to us (the app was
 *  never able to run), the card greys itself out at the deadline instead of sitting there stating
 *  a countdown that stopped being true. */
export function liveStartPayload(
  attributes: LiveAttributes, state: LiveContentState, alert: LiveAlert, nowMs: number,
): Record<string, unknown> {
  return {
    aps: {
      timestamp: Math.round(nowMs / 1000),
      event: 'start',
      'attributes-type': LIVE_ATTRIBUTES_TYPE,
      attributes,
      'content-state': state,
      alert: apsAlert(alert),
      'stale-date': state.deadlineEpoch || undefined,
      'relevance-score': 100,
    },
  };
}

/** An `update`. `alert` is optional here; pass one only when the phase change is worth lighting the
 *  screen for (it is, on REMINDER and LATE, and it is not when the athlete's own tap is what
 *  changed the state). */
export function liveUpdatePayload(
  state: LiveContentState, nowMs: number, alert?: LiveAlert,
): Record<string, unknown> {
  return {
    aps: {
      timestamp: Math.round(nowMs / 1000),
      event: 'update',
      'content-state': state,
      ...(alert ? { alert: apsAlert(alert) } : {}),
      'stale-date': state.phase === 'late' ? state.closesEpoch || undefined : state.deadlineEpoch || undefined,
    },
  };
}

/** The athlete's own check-in (2026-09-23). It used to END the card; now the card STAYS, in the
 *  answered state, carrying their place, their points and the team count until the roll call
 *  closes (the close sweep in commitment-escalation ends it). No alert: the athlete is holding the
 *  phone. Stale at the close, when the answered card has nothing left to say. */
export function liveAnsweredUpdate(state: LiveContentState, nowMs: number = Date.now()): Record<string, unknown> {
  return {
    aps: {
      timestamp: Math.round(nowMs / 1000),
      event: 'update',
      'content-state': { ...state, phase: 'answered' },
      'stale-date': state.closesEpoch || undefined,
    },
  };
}

/** An `end`. `dismissal-date` in the past dismisses immediately; we give the athlete a short beat to
 *  see the final verdict instead, then it clears itself rather than lingering the default 4 hours. */
export const LIVE_LINGER_SEC = 5 * 60;

export function liveEndPayload(
  state: LiveContentState, nowMs: number, lingerSec = LIVE_LINGER_SEC,
): Record<string, unknown> {
  return {
    aps: {
      timestamp: Math.round(nowMs / 1000),
      event: 'end',
      'content-state': state,
      'dismissal-date': Math.round(nowMs / 1000) + lingerSec,
    },
  };
}
