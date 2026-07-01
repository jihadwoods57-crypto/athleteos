// OnStandard core — AI Personality (doc-05 §7). PURE, framework-agnostic.
//
// Personality is a STYLE TOKEN, not a model and not a content switch: it changes *how* something
// is said, never *what* the deterministic engine decided. It only ever produces a prompt
// directive (a string appended when the model phrases coaching). The numbers, targets, safety
// disclaimers, and at-risk decisions come from src/core and are untouched by personality.
//
// Safety floor (doc-05 §7): `tough_love`/`military` re-phrase firmly but may NEVER shame, attack
// body image, prescribe an unsafe deficit, or override the medical/scope disclaimers. For minors
// `clampForAudience` hard-caps the posture — an athlete may dial intensity DOWN, never up, and
// never below the floor. The medical/body-image disclaimers (coaching.ts) are appended by the
// caller regardless of personality.

export type PersonalityStyleKind =
  | 'encouraging'
  | 'performance_driven'
  | 'educational'
  | 'supportive'
  | 'tough_love'
  | 'military'
  | 'professional';

export type PersonalityIntensity = 'soft' | 'standard' | 'firm';

export interface PersonalityStyle {
  style: PersonalityStyleKind;
  intensity: PersonalityIntensity;
}

/** A solo athlete (no org/team posture) gets this. */
export const DEFAULT_PERSONALITY: PersonalityStyle = { style: 'encouraging', intensity: 'standard' };

/** Styles that carry a hard edge — clamped away for minors. */
const HARSH_STYLES: readonly PersonalityStyleKind[] = ['tough_love', 'military'];

/**
 * Resolve the effective posture. Mirrors doc-03's weight-set order: season > team/practice > org >
 * platform; the first layer that sets a posture wins, else the platform/default. Passing nothing
 * yields DEFAULT_PERSONALITY (the solo-athlete default).
 */
export interface PersonalityLayers {
  season?: PersonalityStyle | null;
  team?: PersonalityStyle | null;
  org?: PersonalityStyle | null;
  platform?: PersonalityStyle | null;
}
export function resolvePersonality(layers: PersonalityLayers = {}): PersonalityStyle {
  return layers.season ?? layers.team ?? layers.org ?? layers.platform ?? DEFAULT_PERSONALITY;
}

/**
 * The safety floor for who is being spoken to. For a minor: a harsh style (`tough_love`/`military`)
 * is softened to `supportive`, and `firm` intensity is capped to `standard`. This can only ever
 * make the posture gentler — never harsher — and it is deterministic, not the model's choice.
 * Non-minors pass through unchanged.
 */
export function clampForAudience(p: PersonalityStyle, isMinor: boolean): PersonalityStyle {
  if (!isMinor) return p;
  const style: PersonalityStyleKind = HARSH_STYLES.includes(p.style) ? 'supportive' : p.style;
  const intensity: PersonalityIntensity = p.intensity === 'firm' ? 'standard' : p.intensity;
  return { style, intensity };
}

const STYLE_VOICE: Record<PersonalityStyleKind, string> = {
  encouraging: 'Warm and encouraging; celebrate effort and progress.',
  performance_driven: 'Performance-focused; tie the guidance to getting better on the field.',
  educational: 'Teach the "why" in a sentence; explain the reasoning behind the guidance.',
  supportive: 'Supportive and patient; meet the athlete where they are.',
  tough_love: 'Direct and demanding, but never demeaning; hold a high standard.',
  military: 'Crisp, disciplined, and no-nonsense; the standard is the standard.',
  professional: 'Neutral and professional; clear and matter-of-fact.',
};

const INTENSITY_VOICE: Record<PersonalityIntensity, string> = {
  soft: 'Keep it gentle and low-pressure.',
  standard: '',
  firm: 'Be firm and hold the line.',
};

/**
 * The style instruction appended to a phrasing prompt. It carries the posture AND re-states the
 * hard boundary, so the model is reminded it may only phrase — never change a number, a target, or
 * the safety disclaimers. Callers should pass an already-`clampForAudience`d posture.
 */
export function personalityDirective(p: PersonalityStyle): string {
  const voice = [STYLE_VOICE[p.style], INTENSITY_VOICE[p.intensity]].filter(Boolean).join(' ');
  return `${voice} Phrasing only: never change a number, a target, or a decision, and never shame, ` +
    `attack body image, or prescribe an unsafe deficit. Keep the medical and scope disclaimers intact.`;
}
