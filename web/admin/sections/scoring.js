// OnStandard — Command Center · Scoring inspector (read-only). Makes the accountability score
// inspectable: the platform-owned weights per profile, the server evidence ceiling, the rules, the
// version signals, and the CONTRADICTION CATALOG (each guard + how it's enforced). The number is
// DETERMINISTIC and client-computed; the server only clamps DOWN to an evidence ceiling — there is NO
// server recompute (0029/0193 warn a partial port mis-scores everyone). A live what-if simulator reuses
// proto/breakdown-model.js and is a follow-up (the engine must be wired into web/admin first).
//
// PROFILE_WEIGHTS and WEIGHT_CAPS are IMPORTED from proto/redesign-2026-07/js/plan-style.js, not
// redeclared — this page was the sixth of nine independent v1 copies of the weights this project
// has been eliminating, and a stale copy on the one page whose job is to be the source of truth is
// worse than no page at all. scoring.test.mjs pins both imports to the engine's so they cannot
// silently drift, and every percent string below is computed from them at render time.
import { $, h, card, row, badge, emptyState } from '../ui.js';

/* THE weights AND caps, imported from the shipped engine — never a second literal. The whole point
   of this page is that the formula is inspectable, so a stale copy here is worse than no page.
   scoring.test.mjs pins both imports to the engine's, so they can never silently drift. Every
   percentage printed below is COMPUTED from these two objects at render time — no number on this
   page is typed as a literal string, because a caption or a ceiling row that reads a stale percent
   next to a bar that reads the true one is the same drift bug this page exists to prevent. */
export { PROFILE_WEIGHTS, WEIGHT_CAPS } from '../../../proto/redesign-2026-07/js/plan-style.js';
import { PROFILE_WEIGHTS, WEIGHT_CAPS } from '../../../proto/redesign-2026-07/js/plan-style.js';

/** 0-decimal percent, matching the bars' own formatting — the ONE place a fraction becomes a string. */
const wpct = (v) => (v * 100).toFixed(0) + '%';
/** The two athlete-visible pillars: Nutrition, and Recovery = checkin + recovery combined. */
const recoveryPillarPct = (w) => wpct(w.checkin + w.recovery);

/* The pre-cutover (rows before 2026-08-16) evidence ceiling is the v1/v2 UNION, componentwise
   max — same math as scoreIntegrity.ts's PRE_CUTOVER_CEILING (unexported, can't be imported
   without touching the scoring engine, so it's derived here instead of copied by hand). The
   nutrition slot is genuinely derived from WEIGHT_CAPS, the one v1 constant this page can import;
   V1_NUTRITION_CEILING is the one literal that has to stay a literal — v1's own caps were
   deleted with the v1 engine, so there is nothing left importable to derive it from. checkin+
   recovery and commitment don't need deriving: v2's caps for both (WEIGHT_CAPS.checkin +
   WEIGHT_CAPS.recovery, and WEIGHT_CAPS.commitment) are already below their v1 numbers, so the
   union is just the v1 side. */
const V1_NUTRITION_CEILING = 55;
const V1_CHECKIN_RECOVERY_CEILING = 35;
const V1_COMMITMENT_CEILING = 15;
const preCutoverCeilingPct = () => ({
  nutrition: Math.round(Math.max(V1_NUTRITION_CEILING, WEIGHT_CAPS.nutrition * 100)),
  checkinAndRecovery: Math.round(Math.max(V1_CHECKIN_RECOVERY_CEILING, (WEIGHT_CAPS.checkin + WEIGHT_CAPS.recovery) * 100)),
  commitment: Math.round(Math.max(V1_COMMITMENT_CEILING, WEIGHT_CAPS.commitment * 100)),
});

const CONTRADICTIONS = [
  ['A new user marked overdue immediately', 'Guarded — activation.js: pre-activation required windows read "Not required", drop out of the denominator, never break streak (activation anchors to profiles.created_at).'],
  ['A negative verdict before the day is decided', 'Guarded — dayverdict.js dayDecided(): "Missed/Off Standard" only shows once no required time-windowed item is still open.'],
  ['A perfect score despite missed requirements', `Guarded — the server evidence ceiling (0193) clamps score DOWN to what evidence supports (nutrition ${wpct(WEIGHT_CAPS.nutrition)} / a real check-in ${recoveryPillarPct(WEIGHT_CAPS)}). Rows before 2026-08-16 keep the pre-cutover union (${preCutoverCeilingPct().nutrition} / ${preCutoverCeilingPct().checkinAndRecovery} / ${preCutoverCeilingPct().commitment}) so frozen history is never re-clamped.`],
  ['A deleted meal still affecting analysis', 'Guarded — deleted-food isolation (per-meal DB grounding); a removed meal leaves the denominator.'],
  ['One meal included in another meal’s AI analysis', 'Guarded — session contamination fix; each analyze-meal call is scoped to its own meal.'],
  ['A duplicate photo scoring twice', 'Guarded — 0062 photo-hash unique index; a duplicate-flagged slot scores 0 (dup).'],
  ['A low score paired with overly positive coach copy', 'Partially — the number is deterministic; AI only EXPLAINS it. A live "text-vs-score conflict" attention rule already flags divergence (AI quality panel).'],
];

function weightsCard(profile, w) {
  const bar = (label, v) => h('div', { class: 'row' }, [
    h('span', { class: 'k', text: label }),
    h('span', { class: 'v', style: 'display:flex; align-items:center; gap:8px' }, [
      h('span', { style: `display:inline-block; height:8px; width:${Math.round(v * 120)}px; border-radius:4px; background:var(--sig)` }),
      h('span', { class: 'num', text: wpct(v) }),
    ]),
  ]);
  // Nutrition either sits at its own cap (general) or at the shared floor forced by recovery
  // sitting at ITS cap (athlete/gain) — computed, not asserted, so this can't drift from the bars.
  const atNutritionCap = w.nutrition >= WEIGHT_CAPS.nutrition - 1e-9;
  return card(`Profile · ${profile}`, [
    bar('Nutrition', w.nutrition), bar('Checked in tonight', w.checkin), bar('Answers', w.recovery),
    h('p', { class: 'cap', text: `The athlete sees ONE Recovery pillar (${recoveryPillarPct(w)}) — split into "Checked in tonight" and "Answers" above only for engine inspection.` }),
    h('p', { class: 'cap', text: `Commitment is 0 — the reflection is captured and shown to the coach, it just no longer scores. ${atNutritionCap
      ? `${profile} spends the freed-up slack pushing nutrition to its ${wpct(WEIGHT_CAPS.nutrition)} cap.`
      : `${profile} sits at the ${wpct(w.nutrition)} nutrition floor / ${wpct(w.recovery)} recovery cap — no headroom, do not change.`}` }),
  ]);
}

function mount(view) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'Scoring' }), h('span', { class: 'line' }), badge('read-only', '')]));
  view.appendChild(h('p', { class: 'cap', style: 'margin:0 2px 12px', text: 'The score is ONE deterministic, platform-owned formula; a profile only re-weights it. Client-computed; the server clamps down to an evidence ceiling and never recomputes.' }));
  const g = $('scoring-grid');
  const grid = g || h('div', { class: 'grid', id: 'scoring-grid' });
  if (!g) view.appendChild(grid);
  grid.appendChild(weightsCard('athlete', PROFILE_WEIGHTS.athlete));
  grid.appendChild(weightsCard('general', PROFILE_WEIGHTS.general));
  grid.appendChild(weightsCard('gain', PROFILE_WEIGHTS.gain));

  grid.appendChild(card('Server evidence ceiling (0193)', [
    row('Nutrition (max)', wpct(WEIGHT_CAPS.nutrition)),
    row('Real check-in (max)', `${recoveryPillarPct(WEIGHT_CAPS)} — checkin (${wpct(WEIGHT_CAPS.checkin)}) + recovery (${wpct(WEIGHT_CAPS.recovery)}) combined`),
    row('Commitment (max)', WEIGHT_CAPS.commitment > 0 ? wpct(WEIGHT_CAPS.commitment) : '0 — no longer scored'),
    h('p', { class: 'cap', text: `A monotone BEFORE-insert trigger caps a fabricated over-report. The only server-side scoring logic — it caps, never recomputes. Date-guarded at 2026-08-16: rows on/after that date get this ceiling; rows before it keep the pre-cutover union (nutrition ${preCutoverCeilingPct().nutrition} / checkin+recovery ${preCutoverCeilingPct().checkinAndRecovery} / commitment ${preCutoverCeilingPct().commitment}) so no historical row can move.` }),
  ]));
  grid.appendChild(card('Rules', [
    row('Daily reflection', 'Captured and shown to the coach · worth 0 points — an honest "no" costs nothing'),
    row('Late meal credit', '0.5 (effectiveMealsLogged)'),
    row('Streak', 'grace + activation aware'),
    row('Missing data', 'recovery and check-in only count when a check-in was submitted TODAY — nothing carries (86 is a display fallback = 0)'),
    row('Standard', 'requirement_sets (0055) reshape the nutrition denominator, resolved as-of-date'),
  ]));
  grid.appendChild(card('Version signals', [
    row('Numeric scoring-version', 'none (implicit)'),
    h('p', { class: 'cap', text: 'Versioning is implicit: requirement_set.effective_date (as-of-date), the proto asset content-hash (PROTO_VERSION), and git. A numeric per-row version + the D3 bounded weight-set table are an RD-governance decision (not built).' }),
  ]));

  const contra = [h('p', { class: 'cap', text: 'Contradictions the system guards against, and how:' })];
  for (const [claim, guard] of CONTRADICTIONS) {
    contra.push(h('div', { class: 'item', style: 'display:block; margin-bottom:8px' }, [
      h('div', { class: 'lbl', text: claim }), h('div', { class: 'val', text: guard }),
    ]));
  }
  grid.appendChild(card('Contradiction catalog', contra));

  grid.appendChild(card('What-if simulator', [
    emptyState('A live per-day what-if (reusing proto/breakdown-model.js on day clones) + as-of-date backtests are a follow-up — the pure engine must be wired into the web/admin runtime first. Scoring inspection here is read-only.'),
  ]));
}

export default { id: 'scoring', title: 'Scoring', rail: 'Product', render(view) { mount(view); } };
