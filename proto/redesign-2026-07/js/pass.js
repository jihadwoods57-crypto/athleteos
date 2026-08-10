/* Trust Pass engine (0196) — pure, import-free, Node-testable, the same rule day.js's compute
   functions follow. Nothing here touches the DOM, window.sb, or the RT/DAY singletons, so the
   whole thing can be reasoned about and tested without booting the app.

   THE SEAM. A covered slot is not "scored specially". Its macros are SYNTHESIZED from the
   athlete's own trailing median and injected into a CLONE of the day, after which the existing
   six-part nutrition formula (protein / calorie / timing / hydration / quality / awareness)
   scores it unchanged. Patching a pass into those six places instead would drift apart inside a
   release, and the drift would be silent because every part still returns a plausible number.

   TWO INVARIANTS THIS FILE OWNS, both of which exist so the reward can never cost the athlete:

     1. Pass-covered days are EXCLUDED from the median source (see coveredKeys). Without that the
        median averages its own output and decays toward nothing across a long window.
     2. A thin history is EXCUSED, never credited. Fewer than five real earned days for a slot
        means there is no honest number to credit, so the slot leaves the denominator instead of
        being filled from almost nothing. Granting a pass to a barely-active athlete must not
        drag their score down; that would inverse the entire feature. */

const MIN_REAL_DAYS = 5;   // below this there is no honest median, so the slot is excused
const MEDIAN_WINDOW = 10;  // "your trailing-10", the number the client-facing copy promises
const CLASSIC_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Slots covered on `dateISO`.
 *
 *  A WINDOW pass covers every slot in range with no ledger row: it is passive by design, there is
 *  nothing to tap. A CREDIT pass covers exactly the slots that carry a spend, even when it is
 *  also fenced to a window — the fence narrows when a credit may be spent, it never auto-spends. */
export function passCoverage(dateISO, passes, spends, slots) {
  const out = new Set();
  if (!dateISO) return out;

  const live = (passes || []).filter((p) => p && !p.ended_at && !(p.expires_on && dateISO > p.expires_on));

  for (const p of live) {
    if (p.credits_total != null) continue;                       // credits never auto-cover
    if (!p.covers_from || dateISO < p.covers_from || dateISO > p.covers_until) continue;
    for (const s of (slots && slots.length ? slots : CLASSIC_SLOTS)) out.add(s);
  }

  const liveIds = new Set(live.map((p) => p.id));
  for (const s of spends || []) {
    if (s && s.day_date === dateISO && liveIds.has(s.pass_id)) out.add(s.slot);
  }
  return out;
}

/** Credits remaining, or null for a window pass, which has no counter worth showing. */
export function creditsLeft(pass, spends) {
  if (!pass || pass.credits_total == null) return null;
  const used = (spends || []).filter((s) => s && s.pass_id === pass.id).length;
  return Math.max(0, pass.credits_total - used);
}

/** Median of a non-empty number list. Even lengths average the middle pair. */
function med(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2);
}

/** Per-slot median over the trailing real earned days, or null where the history is too thin.
 *
 *  `history` is DAY.scoreHistory: rows carrying the day's `meals` and `checkin` jsonb, oldest
 *  first. The per-slot macros live at checkin.slotMacros, which is the same store the live day
 *  writes through, so today and history are measured the same way.
 *
 *  `opts.coveredKeys` is a Set of `${date}|${slot}` that were themselves pass-covered. Passing it
 *  is not optional in real use: see invariant 1 in the header. */
export function slotMedians(history, slots, opts) {
  const covered = (opts && opts.coveredKeys) || new Set();
  const rowsIn = history || [];
  const out = {};

  for (const slot of (slots && slots.length ? slots : CLASSIC_SLOTS)) {
    const rows = [];
    for (let i = rowsIn.length - 1; i >= 0 && rows.length < MEDIAN_WINDOW; i--) {
      const r = rowsIn[i];
      if (!r || !r.meals || r.meals[slot] !== true) continue;
      if (covered.has(`${r.date}|${slot}`)) continue;
      const sm = r.checkin && r.checkin.slotMacros && r.checkin.slotMacros[slot];
      // A dup-flagged plate stays visible to the coach but earns nothing (0062), so it is not
      // evidence here either. `via: 'pass'` is belt-and-braces alongside coveredKeys.
      if (!sm || sm.flagged === 'dup' || sm.via === 'pass') continue;
      if (typeof sm.protein !== 'number') continue;
      rows.push(sm);
    }

    if (rows.length < MIN_REAL_DAYS) { out[slot] = null; continue; }

    const m = {
      protein: med(rows.map((r) => r.protein || 0)),
      kcal:    med(rows.map((r) => r.kcal || 0)),
      carbs:   med(rows.map((r) => r.carbs || 0)),
      fat:     med(rows.map((r) => r.fat || 0)),
    };
    const q = med(rows.filter((r) => typeof r.quality === 'number').map((r) => r.quality));
    if (q != null) m.quality = q;
    out[slot] = m;
  }
  return out;
}

/** The day and standard the scorer should use: a CLONE with covered slots filled, plus a standard
 *  whose denominator has shrunk by any slot that had to be excused.
 *
 *  WHY A CLONE. The live DAY must keep telling the truth so the UI can distinguish "covered" from
 *  "logged". If this mutated DAY.meals[k] = true, mealScored() would report a meal the athlete
 *  never ate as one they did, and the meal thread would offer to open a plate that does not
 *  exist. Scoring reads the clone; display reads the real day.
 *
 *  Returns the inputs unchanged when nothing is covered, which is the overwhelmingly common path
 *  and must cost nothing. */
export function withPassCredit(day, std, coverage, medians) {
  if (!coverage || !coverage.size) return { day, std };

  const clone = { ...day, meals: { ...(day.meals || {}) }, slotMacros: { ...(day.slotMacros || {}) } };
  const excused = [];

  for (const slot of coverage) {
    if (clone.meals[slot] === true) continue;   // a real log always beats a pass
    const m = medians && medians[slot];
    if (!m) { excused.push(slot); continue; }
    clone.meals[slot] = true;
    // `via` marks the slot as credited rather than logged. It keeps this plate out of tomorrow's
    // median (invariant 1) and lets any future reader tell the two apart.
    clone.slotMacros[slot] = { ...m, via: 'pass' };
  }

  if (!excused.length) return { day: clone, std };

  const base = std || { mealsRequired: 4, slots: CLASSIC_SLOTS.slice(), deadlines: {}, titles: {} };
  const kept = (base.slots || CLASSIC_SLOTS).filter((s) => !excused.includes(s));
  return {
    day: clone,
    std: {
      ...base,
      slots: kept,
      // Floor at 1: a denominator of zero would divide the whole nutrition score by nothing.
      mealsRequired: Math.max(1, (base.mealsRequired || 4) - excused.length),
    },
  };
}
