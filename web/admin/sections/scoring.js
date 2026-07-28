// OnStandard — Command Center · Scoring inspector (read-only). Makes the accountability score
// inspectable: the platform-owned weights per profile, the server evidence ceiling, the rules, the
// version signals, and the CONTRADICTION CATALOG (each guard + how it's enforced). The number is
// DETERMINISTIC and client-computed; the server only clamps DOWN to an evidence ceiling — there is NO
// server recompute (0029/0041 warn a partial port mis-scores everyone). A live what-if simulator reuses
// proto/breakdown-model.js and is a follow-up (the engine must be wired into web/admin first).
//
// Values MIRROR src/core/scoringProfiles.ts + scoreIntegrity.ts + proto day.js — SYNC on any change.
import { $, h, card, row, badge, emptyState } from '../ui.js';

const PROFILE_WEIGHTS = {
  athlete: { nutrition: 0.50, recovery: 0.25, commitment: 0.15, checkin: 0.10 },
  general: { nutrition: 0.55, recovery: 0.20, commitment: 0.15, checkin: 0.10 },
  gain:    { nutrition: 0.55, recovery: 0.25, commitment: 0.10, checkin: 0.10 },
};

const CONTRADICTIONS = [
  ['A new user marked overdue immediately', 'Guarded — activation.js: pre-activation required windows read "Not required", drop out of the denominator, never break streak (activation anchors to profiles.created_at).'],
  ['A negative verdict before the day is decided', 'Guarded — dayverdict.js dayDecided(): "Missed/Off Standard" only shows once no required time-windowed item is still open.'],
  ['A perfect score despite missed requirements', 'Guarded — the server evidence ceiling (0041) clamps score DOWN to what evidence supports (nutrition 55 / checkin 35 / commitment 15).'],
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
      h('span', { class: 'num', text: (v * 100).toFixed(0) + '%' }),
    ]),
  ]);
  return card(`Profile · ${profile}`, [
    bar('Nutrition', w.nutrition), bar('Recovery', w.recovery), bar('Commitment', w.commitment), bar('Check-in', w.checkin),
    h('p', { class: 'cap', text: profile === 'athlete' ? 'The shipped .50/.25/.15/.10 (do not change).' : 'v1 default — pending founder/RD sign-off.' }),
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

  grid.appendChild(card('Server evidence ceiling (0041)', [
    row('Nutrition (max)', '55'), row('Check-in (max)', '35'), row('Commitment (max)', '15'),
    h('p', { class: 'cap', text: 'A monotone BEFORE-insert trigger caps a fabricated over-report. The only server-side scoring logic — it caps, never recomputes.' }),
  ]));
  grid.appendChild(card('Rules', [
    row('Commitment (one-tap)', 'yes=100 · partial=60 · no=0'),
    row('Late meal credit', '0.5 (effectiveMealsLogged)'),
    row('Streak', 'grace + activation aware'),
    row('Missing data', 'recovery/check-in only count with a real check-in (86 is a display fallback = 0)'),
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
