/* OnStandard — Recovery Check-In intelligence (pure; no DOM, no state, no imports).
   The AI Nutritionist's post-submit coaching message, DERIVED from the answers the athlete
   just gave — same contract as the meal opener in meal-intel.js: composed from real data,
   never persisted, costs nothing, and can't be forged. The engine already scored the
   check-in; this explains it and hands back ONE move, it never re-scores anything.

   Polarity mirrors day.js CI_INVERSE: soreness and cravings store their honest answer
   (5 chips = very sore / constant cravings), so HIGH raw is the negative pole there. */

const clean = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, 200);
const chipOf = (raw) => Math.min(5, Math.max(1, Math.round((Number(raw) || 0) / 2)));

/* Labels match state.js ANCHORS (the form the athlete just answered); `inverse` matches
   day.js CI_INVERSE. `fix` is the ONE coach-texting move for when that signal is the
   night's weakest — specific, doable tomorrow, never shaming. */
const FIELDS = {
  energy: { label: 'Energy', inverse: false, fix: 'Get a real breakfast in tomorrow and hit the first meal window. Low energy usually traces straight back to fuel or sleep.' },
  recovery: { label: 'Recovery', inverse: false, fix: 'Feeling beat up is information. Keep tomorrow honest and let food and sleep do the repair work before you add more load.' },
  sleep: { label: 'Sleep', inverse: false, fix: 'Tonight is the fix: screens down early, same lights-out, and tomorrow starts on a different footing.' },
  confidence: { label: 'Confidence', inverse: false, fix: 'Confidence follows evidence. Stack one clean, on-standard day tomorrow and let the score do the talking.' },
  soreness: { label: 'Soreness', inverse: true, fix: 'That soreness is real load. Ten minutes of easy movement and a protein-forward day tomorrow pays it down.' },
  motivation: { label: 'Motivation', inverse: false, fix: "Flat days happen. Make tomorrow's first move small and early, and momentum does the rest of the lifting." },
  digestion: { label: 'Digestion', inverse: false, fix: "Keep tomorrow's plates simpler and give your last meal more space before bed." },
  cravings: { label: 'Cravings', inverse: true, fix: 'Front-load protein at your first two meals tomorrow. Constant cravings usually mean protein or sleep ran short.' },
};

/** The night's signals, engine-honest: only fields the config enables and the athlete
 *  actually answered, each with a 0–10 "goodness" (inverse fields flipped, so higher is
 *  always better) and the 1–5 chip the athlete saw. Sorted worst-first. */
export function recoverySignals(ci, ciConfig) {
  const answers = ci && typeof ci === 'object' ? ci : {};
  const cfg = ciConfig && typeof ciConfig === 'object' ? ciConfig : {};
  return Object.keys(FIELDS)
    .filter((k) => cfg[k] && typeof answers[k] === 'number' && isFinite(answers[k]))
    .map((k) => {
      const raw = Math.max(0, Math.min(10, answers[k]));
      return { key: k, label: FIELDS[k].label, raw, chip: chipOf(raw), good: FIELDS[k].inverse ? 10 - raw : raw };
    })
    .sort((a, b) => a.good - b.good);
}

/**
 * The AI Nutritionist's coaching message for the confirm screen — three or four short
 * sentences in the coach-texting voice: the honest read of tonight's answers first (the
 * weakest signal named with the athlete's own 1–5 number), then ONE specific move for it,
 * then the day framed forward. A clean board gets recognition, not an invented problem.
 * '' when there's nothing real to speak to (caller hides the card).
 */
export function recoveryCoachMessage({ ci, ciConfig, hasCoach, coachName } = {}) {
  const sig = recoverySignals(ci, ciConfig);
  if (!sig.length) return '';
  const parts = [];
  const worst = sig[0];
  const best = sig[sig.length - 1];
  if (worst.good >= 8) {
    // Everything strong: recognition, and the only move is repetition.
    const named = sig.slice(-2).map((s) => s.label.toLowerCase()).reverse();
    parts.push(`Strong board tonight${named.length > 1 ? ` (${named.join(' and ')} both read high)` : ''}. This is what showing up ready looks like.`);
    parts.push('No fix needed: protect the bedtime that produced it and bring the same tomorrow.');
  } else {
    // Real read: credit what held up, name the weakest with THEIR number, hand back one move.
    if (best.good >= 8 && best.key !== worst.key) {
      parts.push(`${best.label} is holding up well.`);
    }
    parts.push(`${worst.label} came in at ${worst.chip}/5 tonight, and that's the one to work on.`);
    parts.push(FIELDS[worst.key].fix);
  }
  if (hasCoach && clean(coachName)) {
    parts.push(`${clean(coachName)} sees this before tomorrow's practice. Honest answers like these are exactly what makes it useful.`);
  } else {
    parts.push("Tomorrow's readiness starts with what you do tonight.");
  }
  return parts.join(' ').slice(0, 600);
}
