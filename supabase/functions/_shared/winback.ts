// OnStandard — winback: the only message that goes to someone who has already stopped.
//
// WHY THIS EXISTS
// Every reminder the app sends is anchored to a requirement that exists TODAY. An athlete who
// logs nothing gets a 'soon', a 'due', and then silence — forever. There is no D3, no D7, no
// "you haven't logged in a while", no path back. The one moment retention is actually decided
// was the one moment nothing spoke. This closes that.
//
// WHY IT IS THE MOST DANGEROUS MESSAGE WE SEND
// It reaches people who are already unhappy with us, so the rules are all about restraint:
//   · At most TWO in a lifetime per athlete (day 3 and day 10). Not a drip campaign.
//   · Never inside the first days of an account (a new athlete who hasn't started isn't lapsed).
//   · Never twice for the same stage — dedupe is a durable notifications row, not a timer.
//   · Never to someone who opted out of notifications.
//   · Never guilt. No streak they lost, no score they dropped, no "you missed 7 days".
// Anyone still gone after the day-10 message has told us something, and the respectful reading is
// that they are done. Silence after that is the product being honest, not the feature failing.
//
// Pure selection + copy. No I/O, no clock of its own — the caller passes `todayISO`.

/** One athlete's activity summary, as the caller reads it out of the database. */
export interface LapsedCandidate {
  athleteId: string;
  /** Local ISO date (YYYY-MM-DD) of their most recent logged day; null if they never logged. */
  lastActiveISO: string | null;
  /** Local ISO date the account was created. */
  createdISO: string;
  optedOut?: boolean | null;
  /** Winback kinds already sent to this athlete (from the notifications table). */
  alreadySent?: string[];
}

export type WinbackStage = 'd3' | 'd10';

export interface WinbackSend {
  athleteId: string;
  stage: WinbackStage;
  kind: string;
  title: string;
  body: string;
  route: string;
  daysGone: number;
}

/** The two moments we speak, and the gap that qualifies for each. */
const STAGES: Array<{ stage: WinbackStage; minDays: number; maxDays: number }> = [
  // Day 3 is early enough that the habit is still warm. Day 10 is the last honest attempt.
  { stage: 'd3', minDays: 3, maxDays: 9 },
  { stage: 'd10', minDays: 10, maxDays: 30 },
];

/** Beyond this, a returning athlete is a new start, not a continuation — stay quiet. */
const ABANDONED_AFTER_DAYS = 30;
/** An account younger than this hasn't lapsed; it has never begun. Onboarding owns that. */
const MIN_ACCOUNT_AGE_DAYS = 3;

export function winbackKind(stage: WinbackStage): string {
  return `winback:${stage}`;
}

/** Whole days between two local ISO dates (b - a). Date-only, so DST never shifts a boundary. */
export function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T00:00:00Z`);
  const b = Date.parse(`${bISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/* Copy rules: name what is waiting, never what was lost. No streak, no score, no count of missed
   days — someone who already feels behind does not need the arithmetic. One plate is the whole
   ask, because the real barrier to returning is believing it takes a whole day of effort. */
const COPY: Record<WinbackStage, { title: string; body: string }> = {
  d3: {
    title: 'Still here when you are',
    body: 'One plate is enough to pick this back up. No catching up required.',
  },
  d10: {
    title: 'Your log is where you left it',
    body: 'Nothing expired and nothing reset. Log one meal whenever you want to start again.',
  },
};

/**
 * Decide who hears from us today. Returns at most one send per athlete, and nothing at all for
 * anyone who is active, brand new, opted out, already told at this stage, or long gone.
 */
export function selectWinbacks(candidates: LapsedCandidate[], todayISO: string, limit = 200): WinbackSend[] {
  const out: WinbackSend[] = [];

  for (const c of candidates) {
    if (!c || !c.athleteId || c.optedOut) continue;

    // Never logged anything: onboarding and activation own that athlete, not winback. Speaking
    // here would mean nagging someone about a habit they were never shown how to start.
    if (!c.lastActiveISO) continue;

    if (daysBetween(c.createdISO, todayISO) < MIN_ACCOUNT_AGE_DAYS) continue;

    const daysGone = daysBetween(c.lastActiveISO, todayISO);
    if (daysGone <= 0 || daysGone > ABANDONED_AFTER_DAYS) continue;

    const stage = STAGES.find((s) => daysGone >= s.minDays && daysGone <= s.maxDays);
    if (!stage) continue;

    const kind = winbackKind(stage.stage);
    const sent = c.alreadySent ?? [];
    if (sent.includes(kind)) continue;
    // Day 10 supersedes day 3, but never the reverse: someone who came back, lapsed again and
    // crossed day 3 a second time must not be told the same thing twice.
    if (stage.stage === 'd3' && sent.includes(winbackKind('d10'))) continue;

    const copy = COPY[stage.stage];
    out.push({
      athleteId: c.athleteId,
      stage: stage.stage,
      kind,
      title: copy.title,
      body: copy.body,
      route: 'home',
      daysGone,
    });
  }

  // Oldest-lapsed first: if the batch is capped, the athlete closest to being written off is the
  // one whose last chance this is.
  out.sort((a, b) => b.daysGone - a.daysGone);
  return out.slice(0, Math.max(0, limit));
}
