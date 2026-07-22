// OnStandard — Admin Command Center "attention" decision system. PURE + DETERMINISTIC (no LLM), so
// the browser dashboard loads it AND jest tests it (the proven proto pattern). It turns a bundle of
// metrics (assembled from the platform-admin RPCs) into (a) a list of things that need attention,
// each stating a FACT + an evidence link and never guessing WHY, and (b) a plain-English briefing.
//
// Extracted as pure logic on purpose: the next handoff item (founder automations) is the push side —
// a cron running evaluateFlags + briefing and notifying when a flag turns warn. That becomes wiring,
// not new logic, because this module is importable by a future scheduled function too.
//
// TS types below are JSDoc so this stays a plain .js file (no build step) while jest/tsc still see
// the shapes via the .d-less import; the exported `AdminMetrics`/`Flag` typedefs document the contract.

/**
 * @typedef {Object} AdminMetrics
 * @property {number} [activeToday]
 * @property {number} [activeTodayPrev]
 * @property {number} [costPerMeal]        window AI $ per meal-analysis call
 * @property {number} [costPerMealAvg7]    trailing 7-day avg $ per meal
 * @property {number} [calls]              window AI call count
 * @property {number} [medianDelta]        median (AI score - app score); <0 = AI scores lower
 * @property {number} [deltaEvents]        count of score-delta events in the window
 * @property {number} [textConflictRate]   fraction of meals where tone contradicts the band
 * @property {number} [verifyFired]        2nd-pass verify calls made
 * @property {number} [verifyChanged]      of those, how many changed the result
 * @property {{opens?:number,rolePicked?:number,goalPicked?:number,completed?:number}} [funnel]
 * @property {{fn:string,okRate:number,calls:number}[]} [aiOkByFn]
 * @property {number} [appErrorsToday]
 * @property {number} [appErrors7dAvg]
 * @property {number} [subs]               active paying subscriptions
 */

/**
 * @typedef {Object} Flag
 * @property {'warn'|'note'} level
 * @property {string} key    stable rule id
 * @property {string} label  what it is
 * @property {string} value  the fact (numbers), never a guessed cause
 * @property {string} link   evidence descriptor the dashboard resolves to a Studio/query link
 */

// ---- thresholds (the exact tier-1 rules; named so they're auditable) ----
const COST_SPIKE_RATIO = 1.30;   // cost/meal > 130% of the 7-day avg
const DELTA_BIAS = -15;          // median delta this low => one-sided AI under-scoring
const DELTA_WIDE = 25;           // |median delta| beyond this (with enough events) is a spread problem
const DELTA_MIN_EVENTS = 50;
const CONFLICT_RATE = 0.10;      // text-vs-band conflict rate ceiling
const VERIFY_LOOSE = 0.10;       // verify fires but changes < 10% => triggers too loose
const FUNNEL_FLOOR = 0.50;       // step-to-step conversion floor
const OK_RATE_MIN_CALLS = 5;     // ignore sub-5-call functions (noise)
const APP_ERR_MIN = 10;          // ignore tiny error counts
const APP_ERR_RATIO = 2;         // today > 2x the 7-day avg (and above the min) => spike

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

/**
 * @param {AdminMetrics} m
 * @returns {Flag[]}
 */
export function evaluateFlags(m) {
  m = m || {};
  const flags = [];
  const add = (level, key, label, value, link) => flags.push({ level, key, label, value, link });

  // AI cost per meal vs the trailing 7-day average.
  const cpm = num(m.costPerMeal), cpmAvg = num(m.costPerMealAvg7);
  if (cpm != null && cpmAvg != null && cpmAvg > 0 && cpm > cpmAvg * COST_SPIKE_RATIO) {
    const pct = Math.round(((cpm / cpmAvg) - 1) * 100);
    add('warn', 'ai_cost', 'AI cost per meal spiking', `$${cpm.toFixed(4)}/meal, +${pct}% vs 7-day avg $${cpmAvg.toFixed(4)}`, 'ai_call_costs');
  }

  // Score-delta: one-sided bias, or too-wide spread once there are enough events.
  const md = num(m.medianDelta), de = num(m.deltaEvents) ?? 0;
  if (md != null) {
    if (md <= DELTA_BIAS) {
      add('warn', 'score_delta', 'AI scores lower than the app', `median delta ${md} over ${de} events`, 'analytics_events?name=meal_score_delta');
    } else if (Math.abs(md) > DELTA_WIDE && de >= DELTA_MIN_EVENTS) {
      add('warn', 'score_delta', 'AI vs app score spread is wide', `median delta ${md} over ${de} events`, 'analytics_events?name=meal_score_delta');
    }
  }

  // Coach-voice / tone vs score-band contradiction rate.
  const tc = num(m.textConflictRate);
  if (tc != null && tc > CONFLICT_RATE) {
    add('warn', 'text_conflict', 'Meal tone contradicts the score', `${(tc * 100).toFixed(1)}% of meals`, 'analytics_events?name=meal_text_conflict');
  }

  // 2nd-pass verify effectiveness — too tight (never fires) or too loose (fires, rarely changes).
  const vf = num(m.verifyFired);
  if (vf != null) {
    if (vf === 0) {
      add('note', 'verify_tight', 'AI verify never fired', 'no 2nd-pass triggered in window — may be too tight', 'ai_verify_effectiveness');
    } else {
      const changed = num(m.verifyChanged) ?? 0;
      if (changed / vf < VERIFY_LOOSE) {
        add('note', 'verify_loose', 'AI verify rarely changes anything', `${changed}/${vf} changed — triggers may be too loose`, 'ai_verify_effectiveness');
      }
    }
  }

  // Onboarding funnel step conversions.
  const f = m.funnel || {};
  const rp = num(f.rolePicked), gp = num(f.goalPicked), cp = num(f.completed);
  if (rp != null && rp > 0 && gp != null && gp / rp < FUNNEL_FLOOR) {
    add('warn', 'funnel_role_goal', 'Onboarding drop: role → goal', `${gp}/${rp} (${Math.round((gp / rp) * 100)}%) continued`, 'admin_onboarding_funnel');
  }
  if (gp != null && gp > 0 && cp != null && cp / gp < FUNNEL_FLOOR) {
    add('warn', 'funnel_goal_complete', 'Onboarding drop: goal → complete', `${cp}/${gp} (${Math.round((cp / gp) * 100)}%) finished`, 'admin_onboarding_funnel');
  }

  // AI-function reliability (any fn below 100% ok-rate with real volume).
  for (const r of Array.isArray(m.aiOkByFn) ? m.aiOkByFn : []) {
    const rate = num(r && r.okRate), calls = num(r && r.calls) ?? 0;
    if (rate != null && rate < 1 && calls >= OK_RATE_MIN_CALLS) {
      add('warn', 'ai_ok_rate', 'AI function erroring', `${r.fn}: ${(rate * 100).toFixed(1)}% ok over ${calls} calls`, `ai_calls?fn=${r.fn}`);
    }
  }

  // Client error spike vs the trailing week.
  const et = num(m.appErrorsToday), e7 = num(m.appErrors7dAvg);
  if (et != null && e7 != null && et > APP_ERR_MIN && et > e7 * APP_ERR_RATIO) {
    add('warn', 'app_error', 'Client error spike', `${et} today vs ~${e7.toFixed(1)}/day this week`, 'analytics_events?name=app_error');
  }

  return flags;
}

/**
 * Plain-English one-liner. No LLM, so it can never invent a cause — it only fills real numbers.
 * @param {AdminMetrics} m
 * @returns {string}
 */
export function briefing(m) {
  m = m || {};
  const at = num(m.activeToday) ?? 0;
  const atp = num(m.activeTodayPrev) ?? 0;
  const d = at - atp;
  const sign = d >= 0 ? `+${d}` : `${d}`;
  const cpm = num(m.costPerMeal);
  const cpmStr = cpm != null ? `$${cpm.toFixed(4)}` : '$—';
  const calls = num(m.calls) ?? 0;
  const subs = num(m.subs) ?? 0;
  const n = evaluateFlags(m).length;
  return (
    `${at} athletes active today (${sign} vs last week). ` +
    `AI holding at ~${cpmStr}/meal over ${calls} calls. ` +
    `${subs} paying subscription${subs === 1 ? '' : 's'}. ` +
    `${n} item${n === 1 ? '' : 's'} need attention.`
  );
}
