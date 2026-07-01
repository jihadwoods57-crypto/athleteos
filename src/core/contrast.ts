// OnStandard — WCAG colour-contrast math (pure TS, no React/RN imports).
// Used to guard that text colours drawn on a surface clear the WCAG 2.1
// minimums. Keeping this in core (not the UI layer) keeps the formula
// framework-agnostic and unit-testable, and lets a token guard assert that the
// faint-text palette stays legible as the design system evolves.

/** Parse a "#RRGGBB" (or "RRGGBB") hex string into 0–255 channels. */
export const parseHex = (hex: string): { r: number; g: number; b: number } => {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
};

/** Relative luminance per WCAG 2.1 (sRGB, 0 = black, 1 = white). */
export const relativeLuminance = (hex: string): number => {
  const { r, g, b } = parseHex(hex);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** WCAG contrast ratio between two hex colours, in the range 1–21. */
export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

/** WCAG AA pass test. Normal text needs 4.5:1; "large" text (≥18px, or ≥14px
 *  bold) only needs 3:1. */
export const meetsAA = (ratio: number, large = false): boolean =>
  ratio >= (large ? 3 : 4.5);
