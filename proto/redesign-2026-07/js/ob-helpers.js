/* Pure onboarding helpers — no DOM, no state. Unit-tested from
   src/core/obHelpers.test.ts (same proto-ESM import pattern as scoreParity).
   The ONE import is plan-style.js, itself pure (no DOM/state/Date/imports): the score weights
   printed during onboarding must come from the same table the engine scores with. */

import { weightsFor, DEFAULT_STYLE } from './plan-style.js';

export const TOS_VERSION = '2026-07-09';

/** Validate MM/DD/YYYY parts into 'YYYY-MM-DD', or null. Real calendar dates only. */
export function dobFromParts(mm, dd, yyyy) {
  const m = parseInt(mm, 10), d = parseInt(dd, 10), y = parseInt(yyyy, 10);
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) return null;
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Whole-year age on todayISO. Both args 'YYYY-MM-DD'. Null-safe. */
export function ageOn(dobISO, todayISO) {
  if (!dobISO || !todayISO) return null;
  const [y, m, d] = dobISO.split('-').map(Number);
  const [ty, tm, td] = todayISO.split('-').map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age--;
  return age;
}

/* One vocabulary for the pressure knob the OB2 flows write into standard.pressure.
   Three writers used three: the athlete flow's all-in/steady/building, the client flow's
   gentle/steady/strict, and the legacy onboarding chip labels ("Hold me accountable").
   Canonical slugs: 'gentle' | 'steady' | 'strict'. The exec engine (exec.js mapPressure)
   folds label text into gentle/accountable/max; 'steady' and 'strict' both land on
   'accountable' there, exactly where the old OB2 values landed, so storing the slug never
   changes engine behavior. NOTE: mapPressure has no 'strict' rule, so the strict slug
   cannot reach the engine's 'max' tier until exec.js learns it; the legacy onboarding
   still captures its label strings for that reason (they are the only path to 'max'). */
export function normalizePressure(v) {
  const s = String(v || '').toLowerCase().trim();
  if (s === 'gentle' || s === 'steady' || s === 'strict') return s;
  if (s === 'building' || s.includes('gentl') || s.includes('support')) return 'gentle';
  if (s === 'all-in' || s.includes('max') || s.includes('high') || s.includes('intens') || s.includes('strict')) return 'strict';
  return 'steady';
}

/** 3-band strength: floor is 12 chars (long passphrases welcome). +1 for 2+ character
    classes; +1 for 16+ chars OR 3+ classes. Passphrases win on length, not symbol soup. */
export function passwordStrength(pw) {
  const p = pw || '';
  if (p.length < 12) return { ok: false, score: 0, label: 'Too short' };
  let variety = 0;
  if (/[a-z]/.test(p)) variety++;
  if (/[A-Z]/.test(p)) variety++;
  if (/[0-9]/.test(p)) variety++;
  if (/[^A-Za-z0-9]/.test(p)) variety++;
  const score = 1 + (variety >= 2 ? 1 : 0) + (p.length >= 16 || variety >= 3 ? 1 : 0);
  return { ok: true, score, label: ['Too short', 'Fair', 'Good', 'Strong'][score] };
}

/** Reject obviously-weak or identity-derived passwords regardless of length: a small bundled
    common-password list, the app name, or the user's own email / its local-part. Returns a
    reason string to show, or null when acceptable. (A full breached-password check against
    HIBP's k-anonymity API is a later phase.) Pure + tested. */
const COMMON_PW = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789', '1234567890',
  'qwerty', 'qwertyuiop', 'letmein', 'welcome', 'iloveyou', 'admin', 'abc123', 'monkey',
  'football', 'baseball', 'onstandard', 'changeme', 'passw0rd', 'trustno1', 'sunshine',
]);
export function weakPasswordReason(pw, email) {
  const p = String(pw || '');
  const low = p.toLowerCase();
  if (COMMON_PW.has(low)) return 'That password is too common. Pick something unique.';
  if (low.includes('onstandard')) return "Don't put the app name in your password.";
  const e = String(email || '').trim().toLowerCase();
  if (e) {
    if (low === e) return "Don't use your email as your password.";
    const local = e.split('@')[0];
    if (local && local.length >= 4 && low.includes(local)) return "Don't build your password from your email.";
  }
  return null;
}

/* Goal → emphasis copy. Athlete goals (gain/lose/maintain/perform) + client goals
   (build/health). Unknown goals fall back to maintain — never a blank standard. */
const GOAL_EMPHASIS = {
  gain:     'Protein first. Every meal moves the calorie floor.',
  lose:     'Honest portions carry this. Keep protein high.',
  maintain: 'Consistency over everything. Same standard, every day.',
  perform:  'Fuel training, then recover hard. The check-ins are where you win.',
  // canonical spelling (core's BaseGoal); 'perform' stays for legacy saved onboarding state
  performance: 'Fuel training, then recover hard. The check-ins are where you win.',
  build:    'Protein first. Never under-fueled, every meal counts.',
  health:   'Small meals logged honestly. Consistency is the whole game.',
};
const MEAL_WORD = { 2: 'Two', 3: 'Three', 4: 'Four' };

/* The intended weight direction for a goal: 'down' (lose), 'up' (gain/build), or null
   (maintain/perform — no strong direction). Pure + tested. */
export function weightDirection(goal) {
  if (goal === 'lose') return 'down';
  if (goal === 'gain' || goal === 'build') return 'up';
  return null;
}

/* True when a target weight CONTRADICTS the goal (e.g. Lose fat with a target at or above
   current). Returns false when either value is missing/invalid or the goal has no strong
   direction — validation only fires on a genuine, complete contradiction. Pure + tested. */
export function weightContradictsGoal(goal, current, target) {
  const d = weightDirection(goal);
  if (!d) return false;
  const c = Number(current), t = Number(target);
  if (!isFinite(c) || !isFinite(t) || c <= 0 || t <= 0) return false;
  return (d === 'down' && t >= c) || (d === 'up' && t <= c);
}

/** The solo standard for a goal: requirement rows + focus line. `profile` relabels the
    component weights ('athlete' 50/25/15/10 · 'general' 55/20/15/10) — labels only; the
    scoring engine itself is untouched (DECISION-MEMO D3). */
/* One color per requirement category (matches Home's req-icon.* and the editor's std-ic-*), so
   the "Your Standard" preview rows carry the same semantic hues instead of flat grey. */
export function reqHeadTint(iconName) {
  const M = {
    utensils:  ['var(--green-surface)',  'var(--green-bright)'],
    bowl:      ['var(--green-surface)',  'var(--green-bright)'],
    moon:      ['var(--purple-surface)', 'var(--purple-bright)'],
    check:     ['var(--blue-surface)',   'var(--blue-bright)'],
    clipboard: ['var(--cyan-surface)',   'var(--cyan)'],
    scale:     ['var(--amber-surface)',  'var(--amber-bright)'],
    droplet:   ['var(--cyan-surface)',   'var(--cyan)'],
    bolt:      ['var(--amber-surface)',  'var(--amber-bright)'],
    target:    ['var(--blue-surface)',   'var(--blue-bright)'],
    users:     ['var(--blue-surface)',   'var(--blue-bright)'],
  };
  return M[iconName] || ['var(--surface-2)', 'var(--text-2)'];
}

export function standardForGoal(goal, mealsPerDay, profile = 'athlete', style = DEFAULT_STYLE) {
  const meals = Math.min(4, Math.max(2, Math.round(mealsPerDay || 3)));
  // The headline mix is style x profile aware (plan-style.js is the one source of truth). During
  // onboarding no day exists yet, so we preview the style the account will actually land on —
  // never a hardcoded row, which showed new Guided users weights they'd never be scored on.
  const w = weightsFor(style, profile);
  const pct = (k) => Math.round(w[k] * 100);
  // Recovery's DISPLAYED weight is the sum of the nightly check-in submission credit and the
  // recovery-answers credit — a lone liveWeightPct('recovery')-style read under-reports it.
  // Same pattern as log.js:137, features.js:369, recovery.js:95, requirements.js:44.
  const W = { n: pct('nutrition'), r: pct('recovery') + pct('checkin') };
  return {
    meals,
    focus: GOAL_EMPHASIS[goal] || GOAL_EMPHASIS.maintain,
    rows: [
      ['utensils', `${MEAL_WORD[meals]} meals, photo proof`, `Nutrition · ${W.n}%`],
      ['moon', 'Nightly recovery check-in before bed', `Recovery · ${W.r}%`],
      ['scale', 'Weight Mon / Wed / Fri', 'Season trend · not scored'],
    ],
  };
}

/* Confirmation-pending bridge. When Supabase email-confirmation is on, signUp returns no
   session, so onboarding can't drop the user straight into the app. Instead of a dead,
   disabled button, tell them exactly what to do and give a working path back in: one tap
   to the sign-in screen (which prefills their email), so after they click the email link
   they're one field away from starting. Shared by every onboarding flow's onSession(false). */
export function showConfirmPending(root, { email } = {}) {
  const err = root.querySelector('#su-err');
  if (err) {
    err.style.color = 'var(--text-2)';
    err.textContent = email
      ? `Account created. We sent a confirmation link to ${email}. Tap it, then sign in to start.`
      : 'Account created. Check your email for the confirmation link, then sign in to start.';
  }
  const btn = root.querySelector('#su-go');
  if (btn) {
    // Shallow-clone to strip the signup submit listener, then wire the sign-in hand-off.
    const fresh = btn.cloneNode(false);
    fresh.textContent = "I've confirmed. Sign in";
    fresh.disabled = false;
    btn.replaceWith(fresh);
    fresh.addEventListener('click', () => window.__go('signin'));
  }
}
