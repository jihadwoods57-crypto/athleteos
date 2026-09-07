// Did the read narrate the athlete's DAY instead of judging the plate in front of them?
//
// The prompt has told the model for months not to write the athlete's day into the read: the app
// appends its own grounded day sentence immediately after, so a second set of totals from the model
// either duplicates it or contradicts it. Nothing measured whether the model complied, and it did
// not — a breakfast read opened "Zero on the board for protein until now, so this plate is a solid
// opening move... trying to build back toward 180g today" (founder 2026-09-07). Both halves are
// leaks, and both are counted here.
//
// EMPTY-DAY is the worse one and the reason this exists: it spends the verdict sentence narrating
// a board the athlete has not had a chance to fill. On a first meal there is nothing to be behind
// on. It is not a length problem — the message is deliberately a full nutritionist's breakdown
// (founder 2026-09-07) — it is a HOLLOW SENTENCE problem: a line that tells the athlete a fact they
// created ten seconds ago.
//
// ONE definition, two callers: the eval scores it (src/core/evalScore.ts) and analyze-meal records
// it as telemetry on live reads. A copy in each would drift, and then the number the dashboard
// shows and the number the gate enforces would quietly stop being the same number.
//
// Deliberately conservative. A day total must sit next to a DAY WORD, because the prompt actively
// wants numbers that ARE the advice ("add 30g of protein at lunch") and flagging those would train
// everyone to ignore the signal.

const EMPTY_DAY = [
  /\bzero\b[^.!?]{0,60}?\b(on the board|logged|so far|until now|to this point)\b/i,
  /\b(nothing|no protein|none)\b[^.!?]{0,40}?\b(on the board|logged yet|so far today|logged so far|yet today)\b/i,
  /\bstarting (?:the day|today|out)\s+(?:at|from)\s+(?:zero|0)\b/i,
  /\b(?:0|zero)\s?g\b[^.!?]{0,30}?\b(so far|on the board|today|to this point)\b/i,
  /\b(?:first|nothing) on the board\b/i,
];

const DAY_WORD = '(?:today|for the day|on the day|daily|a day)';
const DAY_TOTAL = [
  // "toward 180g today", "180g on the day", "your daily 180g"
  new RegExp(`\\b\\d{2,4}\\s?g\\b[^.!?]{0,20}?\\b${DAY_WORD}\\b`, 'i'),
  new RegExp(`\\b${DAY_WORD}\\b[^.!?]{0,20}?\\b\\d{2,4}\\s?g\\b`, 'i'),
  // "you're at 120 of 180", stated as a running day tally
  /\b\d{2,4}\s?(?:g|grams)?\s+of\s+(?:your\s+)?\d{2,4}\s?g?\b/i,
];

export type DayLeak = { emptyDay: boolean; dayTotal: boolean; leaked: boolean };

/** Inspect an athlete-facing read for day narration. Never throws; non-strings are simply clean. */
export function detectDayLeak(analysis: unknown): DayLeak {
  const text = typeof analysis === 'string' ? analysis : '';
  const emptyDay = EMPTY_DAY.some((re) => re.test(text));
  const dayTotal = DAY_TOTAL.some((re) => re.test(text));
  return { emptyDay, dayTotal, leaked: emptyDay || dayTotal };
}

/** Short, stable label for the `ai_calls.outcome` column. '' when the read is clean. */
export function dayLeakOutcome(leak: DayLeak): string {
  if (!leak.leaked) return '';
  const which = leak.emptyDay && leak.dayTotal ? 'both' : leak.emptyDay ? 'empty_day' : 'day_total';
  return `day_leak:${which}`;
}
