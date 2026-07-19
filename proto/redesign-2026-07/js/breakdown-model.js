/* Score-explanation model (athlete-experience spec §2) — PURE functions over a day object.
   Every number here comes from the SAME engine that scores the day (day.js scoreFor /
   computeComponents), run on hypothetical day clones — never a second formula that could
   drift. No DOM, no storage, no Date: the clock and slot config arrive as arguments, so
   src/core tests can drive every state.

   Vocabulary (spec §2.6): a gain is GUARANTEED when the engine pays it deterministically
   for the action alone (weekly check-in, commitment answer); it is "up to" when the final
   points depend on plate protein, answer quality, or timing. */

import {
  computeComponents, scoreFor, PROFILE_WEIGHTS, slotDeadline, mealScored, slotGrace, slotLateCredit,
} from './day.js';

/* Lateness copy that matches the coach's real late policy (T-01) — never a hardcoded "half". */
function lateBadge(credit) { return credit >= 1 ? 'late (full credit)' : credit <= 0 ? 'late (no credit)' : 'late (half credit)'; }
function lateHint(credit) { return credit >= 1 ? 'log late, still full credit' : credit <= 0 ? 'logging late earns no credit now' : 'log late for half credit'; }

const clone = (day) => JSON.parse(JSON.stringify(day));
const weightsFor = (day) => PROFILE_WEIGHTS[day.scoringProfile] || PROFILE_WEIGHTS.athlete;

export function dayScoreOf(day) {
  const c = computeComponents(day);
  const w = weightsFor(day);
  return Math.max(0, Math.min(100, Math.round(
    w.nutrition * c.nutrition + w.recovery * c.recoveryContribution + w.commitment * c.commitment + w.checkin * c.checkin,
  )));
}

/* ---------------- hypothetical days ---------------- */

/** Protein still creditable today (grams to the target; 0 once the target is met). */
export function proteinRemaining(day, slots) {
  const target = day.proteinTarget > 0 ? day.proteinTarget : 180;
  let logged = 0;
  for (const k of slots) {
    if (mealScored(day, k) && day.slotMacros && day.slotMacros[k]) logged += day.slotMacros[k].protein || 0;
  }
  const q = day.quickAdded || [];
  const QUICK_G = [18, 30, 22];
  for (let i = 0; i < q.length; i++) if (q[i]) logged += QUICK_G[i] || 0;
  return Math.max(0, target - logged);
}

/** The day with one extra meal logged: `atMin` stamps timing (on-time vs late half-credit),
 *  `protein` the plate's grams. The engine judges it exactly like a real log. */
function withMeal(day, slot, atMin, protein) {
  const d = clone(day);
  d.meals[slot] = true;
  d.mealLoggedAt = { ...(d.mealLoggedAt || {}), [slot]: atMin };
  d.slotMacros = { ...(d.slotMacros || {}), [slot]: { ...((d.slotMacros || {})[slot] || {}), protein } };
  return d;
}

const CI_BEST = { energy: 10, recovery: 10, sleep: 10, confidence: 10, soreness: 0, motivation: 10 };

/** Ceiling day: everything still open completes as well as it possibly can — remaining meals
 *  logged on time (or with the late half-credit already locked in by the clock), remaining
 *  protein to target spread across them, best-case recovery answers, commitment "yes",
 *  weekly check-in submitted. This is the honest "up to" for the whole day. */
export function maxDay(day, { slots, nowMin }) {
  let d = clone(day);
  const open = slots.filter((k) => !mealScored(d, k));
  const remP = proteinRemaining(d, slots);
  open.forEach((k, i) => {
    const due = slotDeadline(k);
    const at = Math.min(Math.max(nowMin, 0), due); // loggable on time only while the window is open
    const share = Math.round(remP / open.length);
    d = withMeal(d, k, nowMin > due ? nowMin : at, i === open.length - 1 ? remP - share * (open.length - 1) : share);
  });
  if (!d.ciSubmitted) { d.ciSubmitted = true; d.ci = { ...d.ci, ...CI_BEST }; }
  if (d.dailyCommitment == null) d.dailyCommitment = 'yes';
  return d;
}

/** The exact best score still reachable today ("Possible: up to N"). */
export function maxPossibleScore(day, opts) { return dayScoreOf(maxDay(day, opts)); }

/* ---------------- reach plan (spec §2.6) ---------------- */

/** Sequential, sum-exact action list: each action's "up to" is its marginal gain on the
 *  ceiling path (remaining protein spread evenly across open meals, best answers), so the
 *  rows ADD UP to exactly `maxPossible − score`. `kind` labels honesty per row. */
export function reachPlan(day, { slots, titles = {}, optional = [], nowMin, fmtClock }) {
  const rows = [];
  let cur = clone(day);
  let curScore = dayScoreOf(cur);
  const open = slots.filter((k) => !mealScored(day, k));
  const remP = proteinRemaining(day, slots);
  const share = open.length ? Math.floor(remP / open.length) : 0;
  open.forEach((k, i) => {
    const due = slotDeadline(k);
    const opt = optional.includes(k);
    const late = !opt && nowMin > due;
    const at = late ? nowMin : Math.min(Math.max(nowMin, 0), due);
    const p = i === open.length - 1 ? remP - share * (open.length - 1) : share;
    const next = withMeal(cur, k, at, p);
    const gain = dayScoreOf(next) - curScore;
    rows.push({
      id: k, label: `Log ${titles[k] || k.charAt(0).toUpperCase() + k.slice(1)}`,
      sub: opt ? 'Optional — counts whenever you log it'
        : late ? `Past ${fmtClock(due)} — late still counts for half` : `Due by ${fmtClock(due)}`,
      gain, kind: 'upTo', route: `camera/${k}`, accent: 'g', late,
    });
    cur = next; curScore += gain;
  });
  if (!day.ciSubmitted) {
    const next = clone(cur);
    next.ciSubmitted = true; next.ci = { ...next.ci, ...CI_BEST };
    const gain = dayScoreOf(next) - curScore;
    rows.push({
      id: 'recovery', label: 'Do Recovery Check-In',
      sub: 'Tonight, before bed — also refreshes your Weekly Check-In',
      gain, kind: 'upTo', route: 'recovery', accent: 'p', late: false,
    });
    cur = next; curScore += gain;
  }
  if (day.dailyCommitment == null) {
    const next = clone(cur);
    next.dailyCommitment = 'yes';
    const gain = dayScoreOf(next) - curScore;
    rows.push({
      id: 'commitment', label: 'Complete Daily Commitment', sub: 'End-of-day reflection',
      gain, kind: 'guaranteed', route: 'commitment', accent: 'b', late: false,
    });
    cur = next; curScore += gain;
  }
  return { rows: rows.filter((r) => r.gain > 0), maxPossible: curScore };
}

/** Best score movement one single meal can cause right now — everything else untouched.
 *  Powers "Log lunch on time to earn up to +N points" on the camera (spec §4.4). */
export function mealMaxGain(day, slot, { slots, nowMin }) {
  if (mealScored(day, slot)) return 0; // already scored — logging again earns nothing
  const before = dayScoreOf(day);
  const due = slotDeadline(slot);
  const at = nowMin > due ? nowMin : Math.min(Math.max(nowMin, 0), due);
  const after = dayScoreOf(withMeal(day, slot, at, proteinRemaining(day, slots)));
  return Math.max(0, after - before);
}

/* ---------------- per-category explanation (spec §2.2–2.5) ---------------- */

const CI_LABELS = {
  energy: 'Energy', recovery: 'Recovery', sleep: 'Sleep', confidence: 'Confidence',
  soreness: 'Soreness', motivation: 'Motivation',
};

/** Category cards: name, weight, earned/possible, plain-language result, exact remaining
 *  ("up to" vs guaranteed), and requirement-by-requirement rows for the expanded view. */
export function explainCategories(day, { slots, denom, titles = {}, optional = [], nowMin, fmtClock }) {
  const w = weightsFor(day);
  const c = computeComponents(day);
  const target = day.proteinTarget > 0 ? day.proteinTarget : 180;
  const remP = proteinRemaining(day, slots);
  const pMax = (frac) => Math.round(w.nutrition * 100 * frac); // category ceilings in score points

  /* --- Nutrition --- */
  const nutriPossible = Math.round(w.nutrition * 100);
  const nutriEarned = Math.round(w.nutrition * c.nutrition);
  const loggedSlots = slots.filter((k) => mealScored(day, k));
  const openSlots = slots.filter((k) => !mealScored(day, k));
  const lateCount = loggedSlots.filter((k) => (day.mealLoggedAt || {})[k] != null && day.mealLoggedAt[k] > slotDeadline(k) + slotGrace(k)).length;
  const title = (k) => titles[k] || k.charAt(0).toUpperCase() + k.slice(1).replace('-', ' ');
  const mealRows = slots.map((k) => {
    const due = slotDeadline(k);
    if (mealScored(day, k)) {
      const at = (day.mealLoggedAt || {})[k];
      const late = at != null && at > due + slotGrace(k);
      const g = (day.slotMacros && day.slotMacros[k] && day.slotMacros[k].protein) || 0;
      return { label: title(k), sub: `Logged ${at != null ? fmtClock(at) : ''}${late ? ` · ${lateBadge(slotLateCredit(k))}` : ' · on time'}`, value: `${g} g protein`, state: late ? 'late' : 'done' };
    }
    const dupped = day.meals && day.meals[k] && day.slotMacros && day.slotMacros[k] && day.slotMacros[k].flagged === 'dup';
    if (dupped) return { label: title(k), sub: 'Duplicate photo — logged, not scored', value: '0 pts', state: 'flagged' };
    const opt = optional.includes(k);
    const late = !opt && nowMin > due + slotGrace(k);
    const credit = slotLateCredit(k);
    return {
      label: title(k),
      sub: opt ? 'Optional — counts whenever you log it'
        : late ? `Was due ${fmtClock(due)} — ${lateHint(credit)}` : `Due by ${fmtClock(due)}`,
      value: `+${Math.round(w.nutrition * 35 / denom * (late ? credit : 1))} on log`,
      state: late ? 'overdue' : 'open',
    };
  });
  const proteinLogged = Math.max(0, target - remP);
  const nutriRows = [
    { label: 'Protein', sub: `${proteinLogged} g of ${target} g target`, value: `${Math.round(w.nutrition * 65 * Math.min(proteinLogged, target) / target)} of ${pMax(0.65)} pts`, state: proteinLogged >= target ? 'done' : 'open' },
    ...mealRows,
  ];
  const nutriRemaining = nutriPossible - nutriEarned;
  let nutriNote;
  const requiredOpen = openSlots.filter((k) => !optional.includes(k));
  if (!loggedSlots.length) nutriNote = `No meals logged yet · ${denom} count today`;
  else {
    const nextOpen = requiredOpen.find((k) => nowMin <= slotDeadline(k)) || requiredOpen[0];
    const parts = [`${loggedSlots.length} of ${denom} meals completed`];
    if (lateCount) parts.push(`${lateCount} late (half credit)`);
    if (nextOpen) parts.push(nowMin > slotDeadline(nextOpen) ? `${title(nextOpen)} overdue` : `${title(nextOpen)} due ${fmtClock(slotDeadline(nextOpen))}`);
    else if (openSlots.length) parts.push(`${title(openSlots[0])} still available`);
    nutriNote = parts.join(' · ');
  }

  /* --- Recovery --- */
  const recPossible = Math.round(w.recovery * 100);
  const recEarned = Math.round(w.recovery * c.recoveryContribution);
  const recRows = [];
  let recNote, recRemaining = 0, recRemainingKind = 'upTo';
  if (day.ciSubmitted) {
    recNote = `Check-in completed · Recovery quality ${c.recovery}%`;
    const lost = recPossible - recEarned;
    const deficits = Object.keys(CI_LABELS)
      .filter((k) => day.ciConfig && day.ciConfig[k] && typeof day.ci[k] === 'number')
      .map((k) => ({ k, miss: k === 'soreness' ? day.ci[k] : 10 - day.ci[k] }))
      .filter((d) => d.miss > 0)
      .sort((a, b) => b.miss - a.miss)
      .slice(0, 2)
      .map((d) => CI_LABELS[d.k]);
    if (lost > 0 && deficits.length) recNote += ` · ${deficits.join(' and ')} cost ${lost} pt${lost === 1 ? '' : 's'}`;
    Object.keys(CI_LABELS).forEach((k) => {
      if (day.ciConfig && day.ciConfig[k] && typeof day.ci[k] === 'number') {
        const v = k === 'soreness' ? 10 - day.ci[k] : day.ci[k];
        recRows.push({ label: CI_LABELS[k], sub: k === 'soreness' ? 'Lower soreness scores higher' : '', value: `${v}/10`, state: v >= 8 ? 'done' : 'open' });
      }
    });
  } else if (day.ciLast && day.ciLast.date) {
    recNote = `Carried from your last check-in (${Math.round(day.ciLast.recovery)}%) · tonight's refreshes it`;
    recRemaining = recPossible - recEarned;
    recRows.push({ label: 'Tonight’s check-in', sub: 'Answers set the quality — best answers earn it all', value: `up to +${recRemaining}`, state: 'open' });
  } else {
    recNote = 'No check-in yet — answer tonight to earn this';
    recRemaining = recPossible;
    recRows.push({ label: 'Tonight’s check-in', sub: 'Answers set the quality — best answers earn it all', value: `up to +${recPossible}`, state: 'open' });
  }

  /* --- Daily Commitment --- */
  const comPossible = Math.round(w.commitment * 100);
  const comEarned = Math.round(w.commitment * c.commitment);
  const ans = day.dailyCommitment;
  const comNote = ans === 'yes' ? 'Reflection complete — you executed your plan today'
    : ans === 'partial' ? 'Reflection complete — a partial day, honestly logged'
    : ans === 'no' ? 'Reflection complete — an off day, honestly logged'
    : 'Set today’s commitment, then close the day with an honest reflection';
  const comRows = [
    { label: 'End-of-day reflection', sub: 'Did you execute today’s plan? Your honest answer sets the points', value: ans == null ? `up to +${comPossible}` : `${comEarned} of ${comPossible} pts`, state: ans == null ? 'open' : 'done' },
    { label: 'Why it counts', sub: 'Intent vs. execution is the habit coaches trust — the answer is yours, and your coach sees it', value: '', state: 'info' },
  ];

  /* --- Weekly check-in ---
     Engine truth (day.js checkinReal): this component is earned by ANY check-in inside the
     trailing 7 days — tonight's recovery check-in both fills Recovery and keeps this green.
     The copy must say that, not invent a separate Sunday-only ritual. */
  const wkPossible = Math.round(w.checkin * 100);
  const wkEarned = Math.round(w.checkin * c.checkin);
  const wkIn = c.checkin > 0;

  return [
    {
      id: 'nutrition', key: 'Nutrition', accent: 'g', weightPct: Math.round(w.nutrition * 100),
      earned: nutriEarned, possible: nutriPossible, note: nutriNote,
      remaining: nutriRemaining, remainingKind: 'upTo',
      remainingNote: nutriRemaining > 0 ? `Up to ${nutriRemaining} points still available — on-time logs that reach your protein target earn it all.` : 'Full nutrition points earned.',
      rows: nutriRows,
    },
    {
      id: 'recovery', key: 'Recovery', accent: 'p', weightPct: Math.round(w.recovery * 100),
      earned: recEarned, possible: recPossible, note: recNote,
      remaining: recRemaining, remainingKind: recRemainingKind,
      remainingNote: day.ciSubmitted ? 'Tonight’s check-in is in — this category is settled for today.'
        : `Up to ${recRemaining || recPossible} points available tonight. Your answers set the exact number.`,
      rows: recRows,
    },
    {
      id: 'commitment', key: 'Daily Commitment', accent: 'b', weightPct: Math.round(w.commitment * 100),
      earned: comEarned, possible: comPossible, note: comNote,
      remaining: ans == null ? comPossible : 0, remainingKind: 'guaranteed',
      remainingNote: ans == null ? `“Executed my plan” earns +${comPossible} · “Partially” earns +${Math.round(w.commitment * 60)} · an honest off day earns 0 and keeps your record true.` : 'Reflection is in — this category is settled for today.',
      rows: comRows, action: ans == null ? { label: 'Complete reflection', route: 'commitment' } : null,
    },
    {
      id: 'checkin', key: 'Weekly Check-In', accent: 'g', weightPct: Math.round(w.checkin * 100),
      earned: wkEarned, possible: wkPossible,
      note: wkIn ? 'Checked in this week — full points held' : 'No check-in in the last 7 days',
      remaining: wkIn ? 0 : wkPossible, remainingKind: 'guaranteed',
      remainingNote: wkIn
        ? 'A check-in inside the last 7 days holds these points. Tonight’s check-in restarts the week.'
        : `Tonight’s recovery check-in earns the full +${wkPossible}, guaranteed, and holds it for 7 days.`,
      rows: [{
        label: 'Checked in within 7 days',
        sub: wkIn ? 'Your recovery check-ins keep this green' : 'Complete tonight’s recovery check-in to earn it',
        value: wkIn ? `${wkEarned} of ${wkPossible} pts` : `+${wkPossible} on check-in`,
        state: wkIn ? 'done' : 'open',
      }],
    },
  ];
}
