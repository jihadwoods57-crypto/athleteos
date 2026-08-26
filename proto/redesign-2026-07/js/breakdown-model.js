/* Score-explanation model (athlete-experience spec §2) — PURE functions over a day object.
   Every number here comes from the SAME engine that scores the day (day.js scoreFor /
   computeComponents), run on hypothetical day clones — never a second formula that could
   drift. No DOM, no storage, no Date: the clock and slot config arrive as arguments, so
   src/core tests can drive every state.

   Vocabulary (spec §2.6): a gain is GUARANTEED when the engine pays it deterministically
   for the action alone (submitting tonight's check-in); it is "up to" when the final
   points depend on plate protein, answer quality, or timing. */

import {
  computeComponents, scoreFor, weightsForDay, slotDeadline, mealScored, slotGrace, slotLateCredit,
} from './day.js';

/* Lateness copy that matches the coach's real late policy (T-01) — never a hardcoded "half". */
function lateBadge(credit) { return credit >= 1 ? 'late (full credit)' : credit <= 0 ? 'late (no credit)' : 'late (half credit)'; }
function lateHint(credit) { return credit >= 1 ? 'log late, still full credit' : credit <= 0 ? 'logging late earns no credit now' : 'log late for half credit'; }

const clone = (day) => JSON.parse(JSON.stringify(day));
/* The headline mix is profile aware — weightsForDay(day) is the same lookup the engine scores
   with (day.js). Style no longer re-weights the score (PROFILE_WEIGHTS is profile-only; style
   shapes HOW nutrition is computed via knobsFor), so this reads identically for every style. */
const weightsFor = (day) => weightsForDay(day);

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

/* The best possible check-in, per day.js polarity (soreness/cravings invert: 0 is best).
   EXPORTED as the one shared ceiling constant — the Recovery Check-In screen's "earn up to"
   reads this same object, so it and the breakdown's reach plan can never quote different
   numbers. Includes the 0142 body signals so the ceiling stays honest for Guided/Intuitive
   athletes; disabled fields are ignored by the engine (ciConfig gates them), so athletes
   without them are byte-identical. */
export const CI_BEST = { energy: 10, recovery: 10, sleep: 10, confidence: 10, soreness: 0, motivation: 10, digestion: 10, cravings: 0 };

/** Ceiling day: everything still open completes as well as it possibly can — remaining meals
 *  logged on time (or with the late half-credit already locked in by the clock), remaining
 *  protein to target spread across them, best-case recovery answers, tonight's check-in
 *  submitted. This is the honest "up to" for the whole day. */
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
  // Required meals first (by deadline), optional last. The walk is sequential and sum-exact, so
  // ORDER is the advice: unsorted, "how to climb" ranked an optional snack above a required
  // dinner, which is bad coaching — and it contradicted the 4-meal standard where snack is the
  // bonus slot at the end. Sorting BEFORE the marginal-gain walk keeps every gain attached to
  // its own row and the total unchanged.
  const open = slots.filter((k) => !mealScored(day, k))
    .sort((a, b) => ((optional.includes(a) ? 1 : 0) - (optional.includes(b) ? 1 : 0)) || (slotDeadline(a) - slotDeadline(b)));
  const remP = proteinRemaining(day, slots);
  const share = open.length ? Math.floor(remP / open.length) : 0;
  open.forEach((k, i) => {
    const due = slotDeadline(k);
    const opt = optional.includes(k);
    const pastDue = nowMin > due;
    const late = !opt && pastDue;
    // Simulate the log at the REAL clock for optional slots too: pinning a late optional at its
    // deadline promised a full-credit gain the engine would then halve on the actual log.
    const at = pastDue ? nowMin : Math.min(Math.max(nowMin, 0), due);
    const credit = slotLateCredit(k);
    const p = i === open.length - 1 ? remP - share * (open.length - 1) : share;
    const next = withMeal(cur, k, at, p);
    const gain = dayScoreOf(next) - curScore;
    rows.push({
      id: k, label: `Log ${titles[k] || k.charAt(0).toUpperCase() + k.slice(1)}`,
      sub: opt ? (credit >= 1 ? 'Optional · counts whenever you log it'
        : pastDue ? `Optional · past ${fmtClock(due)} · ${credit ? 'counts for half' : 'window closed'}`
          : `Optional · full credit by ${fmtClock(due)}`)
        : late ? `Past ${fmtClock(due)} · late still counts for half` : `Due by ${fmtClock(due)}`,
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
      sub: 'Tonight, before bed. Submitting it is worth 12 on its own',
      gain, kind: 'upTo', route: 'recovery', accent: 'p', late: false,
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
export function explainCategories(day, { slots, denom, titles = {}, optional = [], nowMin, fmtClock, std }) {
  const w = weightsFor(day);
  // std defaults (undefined) to day.js's module global — byte-identical for the athlete's own
  // breakdown. A coach viewing another athlete passes that athlete's reconstructed standard so
  // deadlines/grace/late-credit read the athlete's windows, not the coach device's.
  const c = computeComponents(day, std);
  const target = day.proteinTarget > 0 ? day.proteinTarget : 180;
  const remP = proteinRemaining(day, slots);
  const pMax = (frac) => Math.round(w.nutrition * 100 * frac); // category ceilings in score points

  /* --- Nutrition --- */
  const nutriPossible = Math.round(w.nutrition * 100);
  const nutriEarned = Math.round(w.nutrition * c.nutrition);
  const loggedSlots = slots.filter((k) => mealScored(day, k));
  const openSlots = slots.filter((k) => !mealScored(day, k));
  const lateCount = loggedSlots.filter((k) => (day.mealLoggedAt || {})[k] != null && day.mealLoggedAt[k] > slotDeadline(k, std) + slotGrace(k, std)).length;
  const title = (k) => titles[k] || k.charAt(0).toUpperCase() + k.slice(1).replace('-', ' ');
  const mealRows = slots.map((k) => {
    const due = slotDeadline(k, std);
    if (mealScored(day, k)) {
      const at = (day.mealLoggedAt || {})[k];
      const late = at != null && at > due + slotGrace(k, std);
      const g = (day.slotMacros && day.slotMacros[k] && day.slotMacros[k].protein) || 0;
      return { label: title(k), sub: `Logged ${at != null ? fmtClock(at) : ''}${late ? ` · ${lateBadge(slotLateCredit(k, std))}` : ' · on time'}`, value: `${g} g protein`, state: late ? 'late' : 'done' };
    }
    const dupped = day.meals && day.meals[k] && day.slotMacros && day.slotMacros[k] && day.slotMacros[k].flagged === 'dup';
    if (dupped) return { label: title(k), sub: 'Duplicate photo: logged, not scored', value: '0 pts', state: 'flagged' };
    const opt = optional.includes(k);
    const pastDue = nowMin > due + slotGrace(k, std);
    const late = !opt && pastDue;
    const credit = slotLateCredit(k, std);
    // Founder ruling 2026-08-20: the engine halves a late optional slot too, so an optional row
    // past its window quotes the halved value and says why — "counts whenever you log it" is
    // reserved for a late-forgives-all policy, the one case where it is true. It still never
    // reads 'overdue': skipping stays penalty-free.
    return {
      label: title(k),
      sub: opt ? (credit >= 1 ? 'Optional · counts whenever you log it'
        : pastDue ? `Optional · past ${fmtClock(due)} · ${credit ? 'half credit now' : 'window closed'}`
          : `Optional · full credit by ${fmtClock(due)}`)
        : late ? `Was due ${fmtClock(due)} · ${lateHint(credit)}` : `Due by ${fmtClock(due)}`,
      value: `+${Math.round(w.nutrition * 35 / denom * (pastDue ? credit : 1))} on log`,
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
    const nextOpen = requiredOpen.find((k) => nowMin <= slotDeadline(k, std)) || requiredOpen[0];
    const parts = [`${loggedSlots.length} of ${denom} meals completed`];
    if (lateCount) parts.push(`${lateCount} late (half credit)`);
    if (nextOpen) parts.push(nowMin > slotDeadline(nextOpen, std) ? `${title(nextOpen)} overdue` : `${title(nextOpen)} due ${fmtClock(slotDeadline(nextOpen, std))}`);
    else if (openSlots.length) parts.push(`${title(openSlots[0])} still available`);
    nutriNote = parts.join(' · ');
  }

  /* --- Recovery ---
     No headline "note" is built here: the merged card below states ciSubmitted status and
     quality directly. This block's only job is recRows — the per-metric detail (Energy, Sleep,
     ...) that only exists once the check-in is IN. When it is not, the two guaranteed rows on
     the merged card ("Checked in tonight" / "How you answered") already say everything there is
     to say; pushing a third "Tonight's check-in" row here would just repeat them. */
  const recRows = [];
  if (day.ciSubmitted) {
    Object.keys(CI_LABELS).forEach((k) => {
      if (day.ciConfig && day.ciConfig[k] && typeof day.ci[k] === 'number') {
        const v = k === 'soreness' ? 10 - day.ci[k] : day.ci[k];
        recRows.push({ label: CI_LABELS[k], sub: k === 'soreness' ? 'Lower soreness scores higher' : '', value: `${v}/10`, state: v >= 8 ? 'done' : 'open' });
      }
    });
  }

  /* ONE Recovery card worth checkin + recovery. The engine keeps two internal slots because
     `checkin` is binary and `recovery` is graded, but the athlete must never be shown two
     categories for one action — that duplicate is exactly what v2 removes. */
  const recPossible = Math.round((w.checkin + w.recovery) * 100);
  const recEarned = Math.round(w.checkin * c.checkin + w.recovery * c.recoveryContribution);
  const ciPts = Math.round(w.checkin * 100);
  const ansPts = Math.round(w.recovery * 100);

  return [
    {
      id: 'nutrition', key: 'Nutrition', accent: 'g', weightPct: Math.round(w.nutrition * 100),
      earned: nutriEarned, possible: nutriPossible, note: nutriNote,
      /* ACTION-AWARE, matching Recovery (ciSubmitted) below — this
         was the one category whose "remaining" was pure arithmetic (possible − earned). With every
         meal logged, a gap left by late half-credit or plate quality is NOT claimable by any
         action, but this card kept saying "Up to +4 still available … logs earn it all" while
         reachPlan — the authority on what can still be DONE — rendered "Every point that was on
         the table is in" six hundred pixels below it. Two verdicts about the same day, on the one
         screen whose whole job is being trustworthy about the number. `remaining` is what an
         ACTION can still earn; a settled gap is named as settled, not dangled as available. */
      remaining: openSlots.length ? nutriRemaining : 0, remainingKind: 'upTo',
      remainingNote: nutriRemaining <= 0 ? 'Full nutrition points earned.'
        : openSlots.length ? `Up to ${nutriRemaining} points still available. On-time logs that reach your protein target earn it all.`
          : `Settled for today. The ${nutriRemaining}-point gap came from late credit or plate quality on meals already logged. No action can re-earn it tonight. Tomorrow starts at the full ${nutriPossible}.`,
      rows: nutriRows,
    },
    {
      id: 'recovery', key: 'Recovery', accent: 'p', weightPct: recPossible,
      earned: recEarned, possible: recPossible,
      note: day.ciSubmitted
        ? `Checked in tonight · Recovery quality ${c.recovery}%`
        : 'Not checked in yet. Tonight’s check-in is the only way to earn this',
      remaining: day.ciSubmitted ? 0 : recPossible,
      remainingKind: day.ciSubmitted ? 'guaranteed' : 'upTo',
      remainingNote: day.ciSubmitted
        ? 'Tonight’s check-in is in. This category is settled for today.'
        : `Submitting tonight’s check-in earns +${ciPts} guaranteed. Your answers set the last ${ansPts}.`,
      rows: [
        {
          label: 'Checked in tonight',
          sub: day.ciSubmitted ? 'Submitted · guaranteed points' : 'Before bed · nothing carries from another day',
          value: day.ciSubmitted ? `${ciPts} of ${ciPts} pts` : `+${ciPts} on check-in`,
          state: day.ciSubmitted ? 'done' : 'open',
        },
        {
          label: 'How you answered',
          sub: day.ciSubmitted ? '' : 'Honest answers cost you almost nothing. A rough night is a few points',
          value: day.ciSubmitted ? `${Math.round(w.recovery * c.recoveryContribution)} of ${ansPts} pts` : `up to +${ansPts}`,
          state: day.ciSubmitted ? 'done' : 'open',
        },
        ...recRows,
      ],
      action: day.ciSubmitted ? null : { label: 'Do check-in', route: 'recovery' },
    },
  ];
}
