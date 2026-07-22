// OnStandard — Command Center "attention" decision system. PURE + DETERMINISTIC (no LLM), so the
// browser dashboard loads it AND jest tests it. It turns a bundle of metrics into (a) attention
// items that state a FACT + an evidence link and never guess WHY, (b) a plain-English briefing,
// (c) anomaly context (z-scores over the metric's own history), (d) a month-end cost forecast, and
// (e) "what changed since last visit" movers. Extracted pure so a future automations cron reuses it.
//
// v2 (2026-07-22): added zscore / forecast / movers, series-aware anomaly annotations, and a numeric
// `severity` for sorting. evaluateFlags/briefing stay backward-compatible: anomaly logic only fires
// when the caller supplies *Series arrays, so a bundle without them yields the exact same flags.

/**
 * @typedef {Object} AdminMetrics
 * @property {number} [activeToday]
 * @property {number} [activeTodayPrev]
 * @property {number} [costPerMeal]
 * @property {number} [costPerMealAvg7]
 * @property {number} [calls]
 * @property {number} [medianDelta]
 * @property {number} [deltaEvents]
 * @property {number} [textConflictRate]
 * @property {number} [verifyFired]
 * @property {number} [verifyChanged]
 * @property {{opens?:number,rolePicked?:number,goalPicked?:number,completed?:number}} [funnel]
 * @property {{fn:string,okRate:number,calls:number}[]} [aiOkByFn]
 * @property {number} [appErrorsToday]
 * @property {number} [appErrors7dAvg]
 * @property {number} [subs]
 * @property {number[]} [costSeries]    PRIOR-days cost/meal baseline (EXCLUDES today's costPerMeal)
 * @property {number[]} [activeSeries]  PRIOR-days active-athletes baseline (EXCLUDES today's activeToday)
 * @property {number[]} [errorSeries]   PRIOR-days client-error baseline (EXCLUDES today's appErrorsToday)
 */

/**
 * @typedef {Object} Flag
 * @property {'warn'|'note'} level
 * @property {number} severity   2 = warn, 1 = note (for sorting)
 * @property {string} key
 * @property {string} label
 * @property {string} value
 * @property {string} link
 * @property {number} [sigma]    z-score of the triggering metric vs its own history, when available
 */

// ---- thresholds (named + auditable) ----
const COST_SPIKE_RATIO = 1.30;
const DELTA_BIAS = -15;
const DELTA_WIDE = 25;
const DELTA_MIN_EVENTS = 50;
const CONFLICT_RATE = 0.10;
const VERIFY_LOOSE = 0.10;
const FUNNEL_FLOOR = 0.50;
const OK_RATE_MIN_CALLS = 5;
const APP_ERR_MIN = 10;
const APP_ERR_RATIO = 2;
const ANOMALY_SIGMA = 2.5;   // |z| beyond this over the metric's own history is "unusual", not just high
const ANOMALY_MIN_POINTS = 5;

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function stddev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

/** z-score of `value` against a numeric `series`. Null when the series is too short or flat (no
 *  meaningful variance to judge against). Positive = above the norm, negative = below. */
export function zscore(series, value) {
  const a = (Array.isArray(series) ? series : []).map(num).filter((x) => x != null);
  const v = num(value);
  if (v == null || a.length < ANOMALY_MIN_POINTS) return null;
  const sd = stddev(a);
  if (sd < 1e-9) return null;
  return (v - mean(a)) / sd;
}

/** Project a month-end total from a daily series at the current run-rate. Uses the trailing 7-day
 *  average (or all points if fewer) × 30. Returns null when there's nothing to project. */
export function forecast(dailySeries, daysInMonth = 30) {
  const a = (Array.isArray(dailySeries) ? dailySeries : []).map(num).filter((x) => x != null && x >= 0);
  if (!a.length) return null;
  const recent = a.slice(-7);
  const runRate = mean(recent);
  return { dailyRunRate: runRate, monthlyProjection: runRate * daysInMonth, points: a.length };
}

/**
 * @param {AdminMetrics} m
 * @returns {Flag[]}
 */
export function evaluateFlags(m) {
  m = m || {};
  const flags = [];
  const add = (level, key, label, value, link, sigma) => {
    const f = { level, severity: level === "warn" ? 2 : 1, key, label, value, link };
    if (sigma != null && isFinite(sigma)) f.sigma = Math.round(sigma * 10) / 10;
    flags.push(f);
  };

  // AI cost per meal vs the trailing 7-day average (+ anomaly context from the full series).
  const cpm = num(m.costPerMeal), cpmAvg = num(m.costPerMealAvg7);
  const cpmZ = zscore(m.costSeries, cpm);
  if (cpm != null && cpmAvg != null && cpmAvg > 0 && cpm > cpmAvg * COST_SPIKE_RATIO) {
    const pct = Math.round(((cpm / cpmAvg) - 1) * 100);
    add("warn", "ai_cost", "AI cost per meal spiking", `$${cpm.toFixed(4)}/meal, +${pct}% vs 7-day avg $${cpmAvg.toFixed(4)}`, "ai_call_costs", cpmZ);
  } else if (cpmZ != null && cpmZ > ANOMALY_SIGMA) {
    add("note", "ai_cost_anomaly", "AI cost unusual for its history", `$${cpm.toFixed(4)}/meal, ${cpmZ.toFixed(1)}σ above the norm`, "ai_call_costs", cpmZ);
  }

  // Score-delta: one-sided bias, or too-wide spread once there are enough events.
  const md = num(m.medianDelta), de = num(m.deltaEvents) ?? 0;
  if (md != null) {
    if (md <= DELTA_BIAS) {
      add("warn", "score_delta", "AI scores lower than the app", `median delta ${md} over ${de} events`, "analytics_events?name=meal_score_delta");
    } else if (Math.abs(md) > DELTA_WIDE && de >= DELTA_MIN_EVENTS) {
      add("warn", "score_delta", "AI vs app score spread is wide", `median delta ${md} over ${de} events`, "analytics_events?name=meal_score_delta");
    }
  }

  const tc = num(m.textConflictRate);
  if (tc != null && tc > CONFLICT_RATE) {
    add("warn", "text_conflict", "Meal tone contradicts the score", `${(tc * 100).toFixed(1)}% of meals`, "analytics_events?name=meal_text_conflict");
  }

  const vf = num(m.verifyFired);
  if (vf != null) {
    if (vf === 0) {
      add("note", "verify_tight", "AI verify never fired", "no 2nd-pass triggered in window — may be too tight", "ai_verify_effectiveness");
    } else {
      const changed = num(m.verifyChanged) ?? 0;
      if (changed / vf < VERIFY_LOOSE) {
        add("note", "verify_loose", "AI verify rarely changes anything", `${changed}/${vf} changed — triggers may be too loose`, "ai_verify_effectiveness");
      }
    }
  }

  const f = m.funnel || {};
  const rp = num(f.rolePicked), gp = num(f.goalPicked), cp = num(f.completed);
  if (rp != null && rp > 0 && gp != null && gp / rp < FUNNEL_FLOOR) {
    add("warn", "funnel_role_goal", "Onboarding drop: role → goal", `${gp}/${rp} (${Math.round((gp / rp) * 100)}%) continued`, "admin_onboarding_funnel");
  }
  if (gp != null && gp > 0 && cp != null && cp / gp < FUNNEL_FLOOR) {
    add("warn", "funnel_goal_complete", "Onboarding drop: goal → complete", `${cp}/${gp} (${Math.round((cp / gp) * 100)}%) finished`, "admin_onboarding_funnel");
  }

  for (const r of Array.isArray(m.aiOkByFn) ? m.aiOkByFn : []) {
    const rate = num(r && r.okRate), calls = num(r && r.calls) ?? 0;
    if (rate != null && rate < 1 && calls >= OK_RATE_MIN_CALLS) {
      add("warn", "ai_ok_rate", "AI function erroring", `${r.fn}: ${(rate * 100).toFixed(1)}% ok over ${calls} calls`, `ai_calls?fn=${r.fn}`);
    }
  }

  const et = num(m.appErrorsToday), e7 = num(m.appErrors7dAvg);
  const errZ = zscore(m.errorSeries, et);
  if (et != null && e7 != null && et > APP_ERR_MIN && et > e7 * APP_ERR_RATIO) {
    add("warn", "app_error", "Client error spike", `${et} today vs ~${e7.toFixed(1)}/day this week`, "analytics_events?name=app_error", errZ);
  }

  // Activity drop anomaly: today's active athletes far below their own recent norm (a silent churn
  // signal a fixed threshold can't catch as the base grows). Series-gated, so no-series callers skip.
  const at = num(m.activeToday);
  const atZ = zscore(m.activeSeries, at);
  if (atZ != null && atZ < -ANOMALY_SIGMA) {
    add("warn", "activity_drop", "Activity dropped sharply", `${at} active today, ${Math.abs(atZ).toFixed(1)}σ below the norm`, "admin_daily_activity", atZ);
  }

  return flags.sort((a, b) => b.severity - a.severity);
}

/** Compare two metric bundles and return the biggest changes, most-significant first. `goodUp` marks
 *  whether an increase is good (active up = good; cost/errors up = bad) so the UI can color it. */
export function movers(current, previous) {
  if (!current || !previous) return [];
  const specs = [
    { key: "activeToday", label: "Active today", goodUp: true, fmt: (v) => String(Math.round(v)) },
    { key: "calls", label: "AI calls", goodUp: true, fmt: (v) => String(Math.round(v)) },
    { key: "costPerMeal", label: "Cost / meal", goodUp: false, fmt: (v) => `$${v.toFixed(4)}` },
    { key: "subs", label: "Paying subs", goodUp: true, fmt: (v) => String(Math.round(v)) },
    { key: "appErrorsToday", label: "Client errors", goodUp: false, fmt: (v) => String(Math.round(v)) },
  ];
  const out = [];
  for (const s of specs) {
    const a = num(current[s.key]);
    const b = num(previous[s.key]);
    if (a == null || b == null) continue;
    const delta = a - b;
    if (Math.abs(delta) < 1e-9) continue;
    const deltaPct = b !== 0 ? (delta / Math.abs(b)) * 100 : null;
    out.push({
      key: s.key, label: s.label, from: s.fmt(b), to: s.fmt(a),
      delta, deltaPct, dir: delta > 0 ? "up" : "down",
      good: delta > 0 ? s.goodUp : !s.goodUp,
    });
  }
  return out.sort((x, y) => Math.abs(y.deltaPct ?? 0) - Math.abs(x.deltaPct ?? 0));
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
  const cpmStr = cpm != null ? `$${cpm.toFixed(4)}` : "$—";
  const calls = num(m.calls) ?? 0;
  const subs = num(m.subs) ?? 0;
  const n = evaluateFlags(m).length;
  return (
    `${at} athletes active today (${sign} vs last week). ` +
    `AI holding at ~${cpmStr}/meal over ${calls} calls. ` +
    `${subs} paying subscription${subs === 1 ? "" : "s"}. ` +
    `${n} item${n === 1 ? "" : "s"} need attention.`
  );
}
