// OnStandard — deterministic meal-report verification + repair (pure TS, no Deno APIs).
//
// WHY THIS EXISTS (founder escalation 2026-08-06). A breakfast photo held a Fairlife Core Power
// bottle with "42g" printed across its face. The vision read logged the shake at 14g, the whole
// breakfast at 44g protein, and the AI Nutritionist then ARGUED with the athlete who corrected it.
// Three separate failures stacked: the label claim was read but not honored, nothing checked that
// a 42g-claim item couldn't sit in a 44g total next to a loaded omelet, and the meal record had no
// notion of "this number was READ, not guessed."
//
// This module is the arithmetic-and-consistency half of the fix. It runs AFTER the vision pass and
// BEFORE anything is returned, scored, or spoken:
//   * verifyMealReport — find every internal contradiction: per-item sums that don't reach the
//     totals, a printed label claim the item's own macros contradict, calorie totals that violate
//     food science (Atwater), prose that names the wrong meal slot.
//   * repairMealReport — fix deterministically what code can fix (claims override estimates,
//     totals re-derive from items, kcal reconciles to macros, slot words correct); report what it
//     could NOT fix so the caller can decide to escalate to a second model pass.
//
// AUTHORITY LADDER (per item, highest wins):
//   1. labelClaims — numbers READ off the packaging in the photo. Reading beats estimating.
//   2. database   — a resolved product/food DB match (basis 'database').
//   3. estimate   — the model's visual guess. Bounded by the client grounder downstream.
// Totals are always Σ items once items exist: the app already subtracts an item's macros when the
// athlete deletes it, so an unattributed calorie in the totals would survive the deletion anyway.
//
// Pure and jest-tested; never throws on junk input (vision output is untrusted data).

export type ItemBasis = 'label' | 'database' | 'estimate';

export interface LabelClaims {
  proteinG?: number;
  kcal?: number;
  carbsG?: number;
  fatG?: number;
  servingText?: string;
}

export interface ReportItem {
  name?: unknown;
  confidence?: unknown;
  kind?: unknown;          // 'prepared' | 'packaged' | 'beverage' | 'condiment'
  brand?: unknown;
  product?: unknown;       // exact product line + flavor + size, packaged items only
  basis?: unknown;         // ItemBasis
  labelClaims?: unknown;   // LabelClaims
  quantity?: unknown;
  protein?: unknown; kcal?: unknown; carbs?: unknown; fat?: unknown;
  [k: string]: unknown;
}

export interface Violation {
  kind: 'claim_contradiction' | 'sum_mismatch' | 'atwater' | 'slot_mismatch' | 'unresolved_product';
  item?: string;
  detail: string;
}

const MACROS = ['protein', 'carbs', 'fat'] as const;

/** Finite non-negative number, else 0 — vision output is untrusted. */
function nn(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A claim value sane enough to override an estimate (a misread "420g protein" must not win). */
const CLAIM_SANE: Record<string, number> = { proteinG: 150, kcal: 2000, carbsG: 300, fatG: 200 };

function saneClaims(raw: unknown): LabelClaims {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const c = raw as Record<string, unknown>;
  const out: LabelClaims = {};
  for (const k of ['proteinG', 'kcal', 'carbsG', 'fatG'] as const) {
    const n = nn(c[k]);
    if (n > 0 && n <= CLAIM_SANE[k]) out[k] = Math.round(n);
  }
  if (typeof c.servingText === 'string' && c.servingText.trim()) out.servingText = c.servingText.trim().slice(0, 80);
  return out;
}

const CLAIM_TO_MACRO: Array<[keyof LabelClaims, 'protein' | 'kcal' | 'carbs' | 'fat']> = [
  ['proteinG', 'protein'], ['kcal', 'kcal'], ['carbsG', 'carbs'], ['fatG', 'fat'],
];

/** Does this item's own macro contradict its printed claim? (>20% or >5g / >40kcal off). */
function claimDelta(claimKey: keyof LabelClaims, claim: number, actual: number): boolean {
  const tol = claimKey === 'kcal' ? Math.max(40, claim * 0.2) : Math.max(5, claim * 0.2);
  return Math.abs(actual - claim) > tol;
}

const SLOT_WORDS = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * Correct prose that calls THIS meal by the wrong slot name ("Based on this lunch" under a
 * Breakfast header). DELIBERATELY NARROW: only demonstrative references to the current meal
 * ("this lunch", "today's lunch") are rewritten. A bare slot word is usually legitimate forward
 * advice — "bring dinner in around 78g" inside a breakfast analysis is the coach doing their job —
 * and a blanket replace would corrupt exactly the sentences the athlete needs.
 */
export function fixSlotWords(text: string, mealType: string): { text: string; changed: boolean } {
  const slot = String(mealType || '').toLowerCase();
  if (!SLOT_WORDS.includes(slot)) return { text, changed: false };
  let changed = false;
  const wrong = SLOT_WORDS.filter((w) => w !== slot);
  const re = new RegExp(`\\b(this|today's) (${wrong.join('|')})\\b`, 'gi');
  const out = String(text || '').replace(re, (_m, det: string) => {
    changed = true;
    return `${det} ${slot}`;
  });
  return { text: out, changed };
}

export interface VerifyResult {
  violations: Violation[];
}

/**
 * Find every internal contradiction in a meal report. Read-only; `repairMealReport` is the
 * mutating sibling. `mealType` is the REQUEST's slot (client truth), used for prose checks.
 */
export function verifyMealReport(input: Record<string, unknown>, mealType?: string): VerifyResult {
  const violations: Violation[] = [];
  const items = Array.isArray(input.detected) ? (input.detected as ReportItem[]) : [];

  // (1) label-claim vs per-item contradiction — the Core Power bug, caught in code.
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const claims = saneClaims(it.labelClaims);
    const name = typeof it.name === 'string' ? it.name : 'item';
    for (const [ck, mk] of CLAIM_TO_MACRO) {
      const claim = claims[ck];
      if (typeof claim !== 'number') continue;
      const actual = nn(it[mk]);
      if (claimDelta(ck, claim, actual)) {
        violations.push({
          kind: 'claim_contradiction', item: name,
          detail: `${name}: package reads ${claim}${ck === 'kcal' ? ' kcal' : 'g ' + mk} but the item was logged at ${Math.round(actual)}`,
        });
      }
    }
  }

  // (2) per-item sums vs meal totals. Items are the authority once any item carries macros.
  const withMacros = items.filter((it) => it && typeof it === 'object'
    && nn(it.protein) + nn(it.kcal) + nn(it.carbs) + nn(it.fat) > 0);
  if (withMacros.length) {
    for (const k of [...MACROS, 'kcal'] as const) {
      const sum = withMacros.reduce((s, it) => s + nn(it[k]), 0);
      const total = nn(input[k]);
      const tol = k === 'kcal' ? Math.max(60, sum * 0.12) : Math.max(6, sum * 0.12);
      if (Math.abs(total - sum) > tol) {
        violations.push({
          kind: 'sum_mismatch',
          detail: `${k}: items sum to ${Math.round(sum)} but the meal total says ${Math.round(total)}`,
        });
      }
    }
  }

  // (3) Atwater: total calories must be explainable by the total macros (4p + 4c + 9f).
  const atwater = 4 * nn(input.protein) + 4 * nn(input.carbs) + 9 * nn(input.fat);
  const kcal = nn(input.kcal);
  if (atwater > 0 && kcal > 0 && Math.abs(kcal - atwater) / atwater > 0.3) {
    violations.push({ kind: 'atwater', detail: `kcal ${Math.round(kcal)} vs macro-implied ${Math.round(atwater)}` });
  }

  // (4) prose naming the wrong meal slot ("this lunch" under a Breakfast header).
  if (mealType) {
    for (const field of ['analysis', 'note'] as const) {
      const t = typeof input[field] === 'string' ? (input[field] as string) : '';
      if (t && fixSlotWords(t, mealType).changed) {
        violations.push({ kind: 'slot_mismatch', detail: `${field} names a different meal slot than ${mealType}` });
        break;
      }
    }
  }

  // (5) a MAJOR packaged product left unresolved: low confidence, no claim read, no exact
  // product named — and it carries a meaningful share of the meal. This is the "don't display
  // high confidence while a major item is a guess" rule, surfaced as an escalation trigger.
  const totalKcal = withMacros.reduce((s, it) => s + nn(it.kcal), 0);
  for (const it of withMacros) {
    const packaged = it.kind === 'packaged' || it.kind === 'beverage';
    const claims = saneClaims(it.labelClaims);
    const named = typeof it.product === 'string' && it.product.trim().length > 0;
    const share = totalKcal > 0 ? nn(it.kcal) / totalKcal : 0;
    if (packaged && it.confidence === 'low' && !named && !Object.keys(claims).length && share >= 0.25) {
      violations.push({
        kind: 'unresolved_product', item: typeof it.name === 'string' ? it.name : 'item',
        detail: `${typeof it.name === 'string' ? it.name : 'a packaged item'} is ${Math.round(share * 100)}% of the meal but its exact product is unresolved`,
      });
    }
  }

  return { violations };
}

export interface RepairResult {
  input: Record<string, unknown>;
  /** What deterministic code fixed, for telemetry ('claim_override:Core Power', 'totals_from_items', ...). */
  repaired: string[];
  /** What it could NOT fix — the caller's escalation trigger. */
  remaining: Violation[];
}

/**
 * Repair what code can repair, in authority order. Returns a NEW object (never mutates the
 * model's output) plus what changed and what still stands.
 *
 *   1. Claims override estimates: a packaged item whose printed claim contradicts its logged
 *      macro adopts the claim, gets basis 'label' and confidence 'high' for that item.
 *   2. Totals re-derive as Σ items whenever they disagree (items are the deletion authority).
 *   3. Total kcal reconciles to Atwater when it disagrees with the (repaired) macros.
 *   4. Wrong slot words in prose are corrected in place.
 */
export function repairMealReport(raw: Record<string, unknown>, mealType?: string): RepairResult {
  const input: Record<string, unknown> = { ...raw };
  const repaired: string[] = [];
  const items: ReportItem[] = Array.isArray(raw.detected)
    ? (raw.detected as ReportItem[]).map((it) => (it && typeof it === 'object' ? { ...it } : it))
    : [];
  if (items.length) input.detected = items;

  // (1) claims override estimates, per item.
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const claims = saneClaims(it.labelClaims);
    let overrode = false;
    for (const [ck, mk] of CLAIM_TO_MACRO) {
      const claim = claims[ck];
      if (typeof claim !== 'number') continue;
      if (claimDelta(ck, claim, nn(it[mk]))) {
        (it as Record<string, unknown>)[mk] = claim;
        overrode = true;
      }
    }
    if (overrode) {
      // Re-derive the ITEM's kcal from its macros when the claim didn't print calories itself:
      // adopting 42g of protein while keeping the 14g item's calories would just move the
      // contradiction one level down.
      if (typeof claims.kcal !== 'number') {
        const ik = 4 * nn(it.protein) + 4 * nn(it.carbs) + 9 * nn(it.fat);
        if (ik > 0 && Math.abs(nn(it.kcal) - ik) / ik > 0.2) (it as Record<string, unknown>).kcal = Math.round(ik);
      }
      (it as Record<string, unknown>).basis = 'label';
      (it as Record<string, unknown>).confidence = 'high';
      repaired.push(`claim_override:${typeof it.name === 'string' ? it.name : 'item'}`);
    }
  }

  // (2) totals from items (only when items carry macros and disagree with the stated totals).
  const withMacros = items.filter((it) => it && typeof it === 'object'
    && nn(it.protein) + nn(it.kcal) + nn(it.carbs) + nn(it.fat) > 0);
  if (withMacros.length) {
    let moved = false;
    for (const k of [...MACROS, 'kcal'] as const) {
      const sum = Math.round(withMacros.reduce((s, it) => s + nn(it[k]), 0));
      const tol = k === 'kcal' ? Math.max(60, sum * 0.12) : Math.max(6, sum * 0.12);
      if (Math.abs(nn(input[k]) - sum) > tol) { input[k] = sum; moved = true; }
    }
    if (moved) repaired.push('totals_from_items');
  }

  // (3) Atwater reconciliation on the (possibly re-derived) totals.
  const atwater = 4 * nn(input.protein) + 4 * nn(input.carbs) + 9 * nn(input.fat);
  if (atwater > 0 && Math.abs(nn(input.kcal) - atwater) / atwater > 0.3) {
    input.kcal = Math.round(atwater);
    repaired.push('kcal_atwater');
  }

  // (4) wrong slot words in prose.
  if (mealType) {
    for (const field of ['analysis', 'note', 'reconcile'] as const) {
      const t = typeof input[field] === 'string' ? (input[field] as string) : '';
      if (!t) continue;
      const fixed = fixSlotWords(t, mealType);
      if (fixed.changed) {
        input[field] = fixed.text;
        if (!repaired.includes('slot_words')) repaired.push('slot_words');
      }
    }
  }

  const remaining = verifyMealReport(input, mealType).violations
    // slot words are always fully repaired above; anything still flagged is claim/sum/product.
    .filter((v) => v.kind !== 'slot_mismatch');
  return { input, repaired, remaining };
}

/**
 * The tool_result correction message for the escalation retry: hand the model its own output
 * back with the specific contradictions, so the second pass fixes THESE, not a cold re-read.
 */
export function verifyCorrectionMessage(remaining: Violation[]): string {
  const lines = remaining.slice(0, 6).map((v) => `- ${v.detail}`).join('\n');
  return `Your report contradicts itself or the visible evidence. Fix these specific problems and re-report the full meal:\n${lines}\n` +
    'Rules: a number printed on a package in the photo is READ evidence and beats any estimate; ' +
    'per-item macros must sum to the meal totals; calories must equal 4*protein + 4*carbs + 9*fat within rounding. ' +
    'Resolve the exact product variant (brand, line, flavor, size) for every packaged item you can see.';
}
