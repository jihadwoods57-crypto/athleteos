// supabase/functions/commitment-reminders/logic.ts
// Pure half of the reminder push: WHO is speaking, and what the notification says.
// ZERO framework imports on purpose: loaded by both Deno (edge) and jest (babel).
//
// THE ONE RULE (Wake-Up Roll Call): the FIRST push of a roll call is the coach addressing the
// athlete, in the coach's own words. Every push after it is OnStandard enforcing the standard, in
// OnStandard's words. The athlete must always be able to tell which is which, so the coach's message
// is never paraphrased or wrapped in product copy, and product copy is never attributed to the coach.
//
// The three lock-screen states, as the founder specified them (2026-09-02, second design pass):
//   INITIAL   "Coach D'Onofrio" / "Wake-Up Roll Call · up by 6:05 AM" / the message   [I'M UP]
//   REMINDER  "2 minutes left"  / "Wake-Up Roll Call" / "On Standard until 6:05 AM."  [I'M UP]
//   LATE      "You're late · 3 min" / "Wake-Up Roll Call" / "Check in now. ..."  [CHECK IN NOW]
//                                                                        (LATE lives in the escalation fn)
//
// WHY A SUBTITLE. iOS draws title / subtitle / body as three distinct lines; Android draws no
// subtitle at all. Before this pass both names were crammed into the title so the two platforms
// read alike, which cost the title its punch on the platform that had room for it. Now each
// platform gets the shape it can actually render: `title`+`subtitle` on iOS, `androidTitle` (the
// two halves joined) on Android. `platformCopy()` picks; the caller passes the token's platform.
//
// WHY "OnStandard" IS NOT IN OUR COPY. Both operating systems draw the app name in the
// notification header themselves. Repeating it in our own subtitle just spent a line saying what
// the OS already said. (The iOS Live Activity is the exception and DOES name OnStandard in its
// eyebrow: a Live Activity is a fully custom surface with no system header.)

export type ReminderRow = {
  athlete_id: string;
  instance_id: string;
  title: string;
  body: string;                 // the SQL's generic body ("N minutes left to respond.")
  offset_min: number;
  action_label: string | null;
  respond_by_at: string | null;
  type?: string | null;
  message?: string | null;      // the coach's morning message, verbatim (instance override wins)
  coach_name?: string | null;
  starts_at?: string | null;
  closes_at?: string | null;
  fires_at?: string | null;     // deadline - offset: when this rung was scheduled to fire
  timezone?: string | null;
};

import { copy, type PushCopy } from '../_shared/rollcall-copy.ts';
export { platformCopy, fold } from '../_shared/rollcall-copy.ts';
export type { PushCopy };

/** Expo caps one push message at 4096 bytes total. Title, route, code and category share it, so the
 *  body gets this much and no more. The full message always lives in the app and the bell row. */
export const PUSH_BODY_MAX_BYTES = 1200;

const ms = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : NaN;
};

/** "6:00 AM" in the commitment's own zone. Falls back to UTC when the zone is unknown rather
 *  than throwing inside a push loop. */
export function clockIn(iso: string | null | undefined, tz: string | null | undefined): string {
  const t = ms(iso);
  if (!Number.isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  } catch {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  }
}

/** The rung that lands AT the scheduled time (offset == grace) is the roll call itself. Anything
 *  scheduled later than a minute after the start is a follow-up. A row without timing data
 *  (pre-0211 claim) is treated as a follow-up, which is the pre-0211 behaviour. */
export function isInitialPush(row: ReminderRow): boolean {
  const fires = ms(row.fires_at);
  const starts = ms(row.starts_at);
  if (!Number.isFinite(fires) || !Number.isFinite(starts)) return false;
  return fires <= starts + 60_000;
}

/** Whole minutes left before the deadline, floored at 1 so the copy never says "0 minutes". */
export function minutesLeft(row: ReminderRow, nowMs: number): number | null {
  const dl = ms(row.respond_by_at);
  if (!Number.isFinite(dl)) return null;
  return Math.max(1, Math.ceil((dl - nowMs) / 60_000));
}

/** Cap a message for the push BODY only, by UTF-8 bytes, on a word boundary, with an ellipsis.
 *  Never splits a multibyte character. Returns the text and whether anything was cut. */
export function pushBody(message: string, maxBytes: number = PUSH_BODY_MAX_BYTES): { text: string; truncated: boolean } {
  const enc = new TextEncoder();
  if (enc.encode(message).length <= maxBytes) return { text: message, truncated: false };
  const ell = '…';
  const budget = maxBytes - enc.encode(ell).length;
  // Walk code points so a 4-byte emoji is never cut in half.
  let out = '';
  let bytes = 0;
  for (const ch of message) {
    const b = enc.encode(ch).length;
    if (bytes + b > budget) break;
    out += ch; bytes += b;
  }
  // Prefer a word boundary when one exists in the last quarter of what fits.
  const lastSpace = out.lastIndexOf(' ');
  if (lastSpace > out.length * 0.75) out = out.slice(0, lastSpace);
  return { text: out.trimEnd() + ell, truncated: true };
}

/** Compose one push. */
export function composeReminderPush(row: ReminderRow, nowMs: number): PushCopy {
  const isRollCall = row.type === 'morning_roll_call';
  if (!isRollCall) {
    // Every other commitment type keeps its pre-0211 push, byte for byte.
    return copy(row.title, null, row.body);
  }

  const message = (row.message ?? '').trim();
  const title = row.title || 'Wake-Up Roll Call';
  const dl = clockIn(row.respond_by_at, row.timezone);

  if (isInitialPush(row)) {
    if (message) {
      // The coach's voice: their NAME is the title, so the athlete reads who is speaking before
      // anything else. The roll call and the deadline drop to the subtitle, where they belong.
      // Their words stay the body, whole (capped for the push only; the app and the bell row keep
      // every character).
      const coach = row.coach_name?.trim() || 'Your coach';
      const b = pushBody(message);
      return copy(coach, dl ? `${title} · up by ${dl}` : title, b.text, { fromCoach: true, truncated: b.truncated });
    }
    // No message: still a roll call, addressed neutrally. Never invented words in the coach's name.
    // No subtitle either — with no coach name to separate out, the title already stands alone and a
    // subtitle would only repeat the body.
    return copy(title, null, dl ? `Check in by ${dl}.` : 'Check in now.');
  }

  // Follow-up inside the grace period: OnStandard's words, plainly system-generated. The TIME LEFT
  // is the title, because that is the one fact that changes between this push and the last one.
  const left = minutesLeft(row, nowMs);
  if (row.offset_min <= 0 || left == null) {
    return copy('Last call', title, 'Your coach is waiting.');
  }
  return copy(
    `${left} minute${left === 1 ? '' : 's'} left`,
    title,
    dl ? `On Standard until ${dl}.` : "You haven't checked in yet.",
  );
}

/** The signed code should outlive the deadline by the whole late window, so a lock-screen tap at
 *  6:20 on a 6:00 roll call records a LATE, not an "expired". Falls back to the deadline (the
 *  pre-0211 behaviour), then to now. */
export function codeDeadlineMs(row: { closes_at?: string | null; respond_by_at?: string | null }, nowMs: number): number {
  const c = ms(row.closes_at);
  if (Number.isFinite(c)) return c;
  const d = ms(row.respond_by_at);
  return Number.isFinite(d) ? d : nowMs;
}

/** Which Live Activity phase a claimed rung pushes, and whether it may START a card for ONE
 *  athlete (2026-09-23, per-athlete fix round).
 *
 *  The card now goes up at the OPEN, 10 minutes before the start (0242 rollcall_opens_at), through
 *  a claim per ATHLETE, not per instance (claim_rollcall_card_opens / claim_rollcall_card_starts;
 *  see commitment_responses.card_started_at) — a once-per-INSTANCE claim meant an athlete whose
 *  first attempt never reached Apple, or who registered a start token after the open, never got a
 *  card for the rest of the morning. The start-time rung is still the loud moment (the coach's
 *  words, with sound); `alreadyStarted` says whether THIS athlete's start was already claimed
 *  (whether or not it actually reached the device) — only then does starting a second one risk
 *  stacking two cards on a phone whose app never got to report its update token. A follow-up rung
 *  never starts one. */
export function cardPlanAtRung(row: ReminderRow, alreadyStarted: boolean): { phase: 'initial' | 'reminder'; allowStart: boolean } {
  if (!isInitialPush(row)) return { phase: 'reminder', allowStart: false };
  return { phase: 'initial', allowStart: !alreadyStarted };
}

/** One push group for the start-time rung: which athletes, what sound, and whether this group
 *  may attempt a fresh card START (2026-09-23, fix round 1 — review round 1, Minor #2).
 *
 *  Extracted from the rung's orchestration so the starters/updaters × loud/quiet fan-out is
 *  tested directly rather than only ever exercised end to end. `sound: ''` is the quiet channel
 *  for an athlete whose own alarm is already ringing (isArmed); `allowStart: true` is only ever
 *  set for an athlete `justClaimed` names — one the caller just atomically claimed a fresh start
 *  for (claim_rollcall_card_starts). Everyone else in the batch already has a claim (accepted, or
 *  awaiting release) or no start token at all, and must only be sent an update, never a second
 *  start attempt. */
export type StartPushGroup = { ids: string[]; sound: 'default' | ''; allowStart: boolean };

export function splitStartGroups(
  athleteIds: string[],
  isArmed: (athleteId: string) => boolean,
  justClaimed: Set<string>,
): StartPushGroup[] {
  const uniq = [...new Set(athleteIds)];
  const loud = uniq.filter((id) => !isArmed(id));
  const quiet = uniq.filter((id) => isArmed(id));
  const out: StartPushGroup[] = [];
  for (const [ids, sound] of [[loud, 'default'], [quiet, '']] as Array<[string[], 'default' | '']>) {
    if (!ids.length) continue;
    const starters = ids.filter((id) => justClaimed.has(id));
    const updaters = ids.filter((id) => !justClaimed.has(id));
    if (starters.length) out.push({ ids: starters, sound, allowStart: true });
    if (updaters.length) out.push({ ids: updaters, sound, allowStart: false });
  }
  return out;
}

/** The reminder push's tap target: a wake-up opens its team board (roll call rebuilt,
 *  2026-09-23); every other commitment its detail. Older pushes' roll-call/<id> is handed over by
 *  the proto before it paints. */
export function reminderRoute(type: string | null | undefined, instanceId: string): string {
  return type === 'morning_roll_call' ? `rollcall-board/${instanceId}` : `roll-call/${instanceId}`;
}

/** The bundled alarm sound (assets/sounds/rollcall_alarm.caf, registered by the expo-notifications
 *  plugin in app.json). A binary without it plays the default sound for this name. */
export const BACKUP_SOUND = 'rollcall_alarm.caf';

/** How the START-TIME push of a wake-up is delivered (roll call v3, the backup alert).
 *
 *  Armed (the phone reported an AlarmKit alarm for this morning): the alarm is the sound, so the push
 *  is silent and the Live Activity alone is enough (0239).
 *  Not armed: nothing else will wake this athlete. The notification goes out even where the card is
 *  up, time-sensitive (breaks through a Focus that allows it; the silent switch still wins, and no
 *  Critical Alert is asked for, per the founder), with the 28-second alarm sound. The card's own
 *  alert goes quiet so the phone makes one noise, not two.
 *  Everything else (follow-up rungs, other commitment types) is unchanged. */
export function openingDelivery(row: ReminderRow, armed: boolean): {
  sound: string | null; interruptionLevel: 'active' | 'time-sensitive'; suppressWithCard: boolean; cardQuiet: boolean;
} {
  if (row.type !== 'morning_roll_call' || !isInitialPush(row)) {
    return { sound: 'default', interruptionLevel: 'active', suppressWithCard: true, cardQuiet: false };
  }
  if (armed) return { sound: null, interruptionLevel: 'active', suppressWithCard: true, cardQuiet: true };
  return { sound: BACKUP_SOUND, interruptionLevel: 'time-sensitive', suppressWithCard: false, cardQuiet: true };
}
