// OnStandard — design tokens, transcribed from the handoff README.
import { Platform } from 'react-native';

export const colors = {
  bg: '#F8FAFC',
  bg2: '#F1F5F9',
  card: '#FFFFFF',
  text: '#0F172A',
  textSecondary: '#64748B',
  // Darkened from #94A3B8 (2.56:1 — a WCAG AA fail flagged in the audit) to #667085,
  // which clears 4.5:1 on card/bg/accent surfaces while staying a touch lighter than
  // secondary. Small muted labels (11px eyebrows, meta, tab labels) are now legible.
  textTertiary: '#667085',
  slate500: '#64748B',
  slate600: '#475569',
  slate700: '#334155',

  accent: '#2563EB', // Athlete Blue
  accentLight: '#3B82F6',
  accentSurface: '#EFF6FF',
  accentBorder: '#DBEAFE',
  accentBorderStrong: '#BFDBFE',

  success: '#22C55E',
  successDeep: '#16A34A',
  successSurface: '#DCFCE7',

  warning: '#F59E0B',
  warningDeep: '#D97706',

  alert: '#EF4444',
  alertDeep: '#DC2626',
  alertSurface: '#FEF2F2',
  alertBorder: '#FECACA',

  hydration: '#38BDF8',
  trainer: '#7C3AED',
  trainerLight: '#A855F7',

  divider: '#EAEEF3',
  divider2: '#EEF2F6',
  track: '#EFF2F6',
  border: '#F1F5F9',
  hairline: '#E9EEF4',

  // Extended semantic surfaces — so screens stop hardcoding stray hexes. Premium
  // is zero color drift: every value comes from here.
  successTint: '#ECFDF5',
  successText: '#065F46',
  successBorderSoft: '#A7F3D0',
  warnTint: '#FEF3C7',
  warnText: '#B45309',
  slate300: '#CBD5E1',

  // Elevation surfaces + extra semantic accents the redesign leans on (dark holds the
  // premium values; light keeps sensible equivalents so both palettes share every key).
  surface2: '#F1F5F9',
  surface3: '#E9EEF4',
  cyan: '#0EA5E9',
  purple: '#7C3AED',

  // Dark text that sits on the green action button (proto's "Get Started"/"Log" CTAs use
  // near-black text on green, not white — green is light enough that dark reads far better).
  onGreen: '#04160D',

  white: '#FFFFFF',
} as const;

// ----------------------------------------------------------------- theming foundation
// `colors` above is the LIGHT palette and the app's default (every existing import keeps
// working unchanged, so nothing looks different today). Dark mode is now a palette swap:
// `darkColors` mirrors every key, and components migrate from the static `colors` import
// to the `useColors()` hook (src/ui/theme.tsx) incrementally. Surfaces still hardcoding
// '#fff' / '#0F172A' must move to a token before they theme — tracked as the migration.

/** The light palette, named for clarity once a dark one exists. Same object as `colors`. */
export const lightColors = colors;

/** Structural palette type: every color key, valued as a string (so the dark palette can
 *  hold different hexes than the light literals). */
export type ColorTheme = { [K in keyof typeof colors]: string };

/** Designed dark palette — same keys as light. Surfaces become elevated grays (not pure
 *  black), accents/status brighten for contrast on dark, white stays white (text on
 *  colored buttons). Tuned for WCAG-AA; run src/core/contrast.ts over pairs at QA time. */
// Redesign dark palette — transcribed from the proto's css/tokens.css. Deep navy-black
// canvas (never pure #000), cool-tinted text, brand-blue spine, and semantic accents that
// each hold ONE meaning (green positive, amber warning, purple recovery, cyan hydration,
// red critical). Hairlines are low-opacity slate so cards read as edges, not boxes.
export const darkColors: ColorTheme = {
  bg: '#070B14',
  bg2: '#05080F',
  card: '#0E1421',
  text: '#EEF3FB',
  textSecondary: '#9AA9C2',
  // Proto text-3 is #64748B, but that's ~4.1:1 on the near-black canvas — an AA fail on the
  // tiny meta labels the contrast guard covers. Held at #8A98AC: clears 4.5:1, still clearly
  // a step down from secondary. (Tints/borders below are the proto's rgba washes flattened to
  // solid hex over the dark surface, since the palette invariant requires 6-digit hex.)
  textTertiary: '#8A98AC',
  slate500: '#9AA9C2',
  slate600: '#B7C4D8',
  slate700: '#D7E0EE',

  accent: '#3B82F6',
  accentLight: '#60A5FA',
  accentSurface: '#14233F',
  accentBorder: '#1D3969',
  accentBorderStrong: '#2563EB',

  success: '#34D399',
  successDeep: '#4ADE80',
  successSurface: '#132D31',

  warning: '#F5A524',
  warningDeep: '#FBBF24',

  alert: '#F65757',
  alertDeep: '#FCA5A5',
  alertSurface: '#2C1D28',
  alertBorder: '#542831',

  hydration: '#38BDF8',
  trainer: '#A855F7',
  trainerLight: '#C084FC',

  divider: '#1B2434',
  divider2: '#151D2C',
  track: '#1A2436',
  border: '#1B2434',
  hairline: '#1B2434',

  successTint: '#132D31',
  successText: '#4ADE80',
  successBorderSoft: '#194D45',
  warnTint: '#2C2721',
  warnText: '#FBBF24',
  slate300: '#475569',

  surface2: '#131C2D',
  surface3: '#1A2436',
  cyan: '#38BDF8',
  purple: '#A855F7',

  // Near-black text that sits on the green action button (green is light; dark text reads best).
  onGreen: '#04160D',

  white: '#FFFFFF',
};

export const font = {
  // Plus Jakarta Sans weights loaded via @expo-google-fonts.
  r: 'PlusJakartaSans_400Regular',
  m: 'PlusJakartaSans_500Medium',
  sb: 'PlusJakartaSans_600SemiBold',
  b: 'PlusJakartaSans_700Bold',
  eb: 'PlusJakartaSans_800ExtraBold',
} as const;

/**
 * Named type scale — one source of truth for hierarchy so weight/size/spacing work
 * together instead of everything defaulting to extra-bold. Use these presets for new
 * text instead of ad-hoc size/weight pairs. (size, lineHeight in pt; ls = letterSpacing.)
 */
export const typeScale = {
  display: { size: 48, weight: font.eb, ls: -2, lineHeight: 50 },
  title: { size: 28, weight: font.eb, ls: -0.8, lineHeight: 32 },
  heading: { size: 16, weight: font.eb, ls: -0.3, lineHeight: 22 },
  body: { size: 14, weight: font.m, ls: 0, lineHeight: 20 },
  bodyStrong: { size: 14, weight: font.b, ls: 0, lineHeight: 20 },
  caption: { size: 12, weight: font.sb, ls: 0.2, lineHeight: 16 },
  overline: { size: 11, weight: font.eb, ls: 0.6, lineHeight: 14 },
} as const;

/**
 * The Development Score's color story, keyed on the letter grade so the ring, number, and
 * grade chip all speak ONE status color that shifts A (green) -> F (red) — instead of a
 * fixed-green ring fighting an orange chip. [light, deep] for the ring gradient.
 */
export const gradeRing: Record<string, [string, string]> = {
  A: ['#34D399', '#16A34A'],
  B: ['#60A5FA', '#2563EB'],
  C: ['#FBBF24', '#D97706'],
  D: ['#FB923C', '#EA580C'],
  F: ['#F87171', '#DC2626'],
};

/**
 * The redesign's signature score ring: a premium green → cyan → blue sweep, constant across
 * every score. The ring reads as "energy/progress"; the TIER CHIP (below) carries the status
 * color, so a low score isn't a red ring fighting a red chip — the ring stays aspirational.
 */
export const ringGradient = ['#34D399', '#22D3EE', '#3B82F6'] as const;

/**
 * Tier chip palette keyed by the proto's tier class:
 *   r = Off Standard (red) · a = Building (amber) · b = Locked In (cyan) · g = OnStandard (green).
 * Filled tint + hairline border in the tier color — legible on the dark canvas.
 */
export const tierChip: Record<'r' | 'a' | 'b' | 'g', { fg: string; bg: string; border: string }> = {
  r: { fg: '#F65757', bg: 'rgba(246,87,87,0.13)', border: 'rgba(246,87,87,0.30)' },
  a: { fg: '#F5A524', bg: 'rgba(245,165,36,0.13)', border: 'rgba(245,165,36,0.32)' },
  b: { fg: '#38BDF8', bg: 'rgba(56,189,248,0.13)', border: 'rgba(56,189,248,0.30)' },
  g: { fg: '#34D399', bg: 'rgba(52,211,153,0.13)', border: 'rgba(52,211,153,0.30)' },
};

export const radius = {
  card: 22,
  cardLg: 24,
  pill: 14,
  chip: 11,
  tile: 14,
  full: 999,
} as const;

export const space = {
  screen: 20,
  card: 20,
  gap: 12,
} as const;

// Cross-platform shadows (RN: elevation on Android, shadow* on iOS/web).
type Shadow = {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
};

function makeShadow(radius: number, opacity: number, dy: number, elevation: number): Shadow {
  return {
    shadowColor: '#0F172A',
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: dy },
    elevation,
  };
}

// Elevation ladder — a considered hierarchy, not one shadow on everything. Secondary
// content sits `low`; standard cards `card`; the single hero of a screen gets `hero`
// (a softer, deeper float). Premium depth is the CONTRAST between levels, so use them
// deliberately: at most one `hero` per screen.
export const shadow = {
  low: makeShadow(7, 0.05, 3, 2),
  card: makeShadow(14, 0.06, 6, 3),
  elevated: makeShadow(20, 0.08, 10, 6),
  hero: makeShadow(34, 0.13, 22, 14),
  pressed: makeShadow(6, 0.04, 2, 1),
  cta: {
    shadowColor: '#2563EB',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  } as Shadow,
  // Green action glow — the redesign's primary CTA (Get Started / Log meal) + camera FAB.
  ctaGreen: {
    shadowColor: '#34D399',
    shadowOpacity: 0.34,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  } as Shadow,
} as const;

export const DEVICE_MAX_WIDTH = 440; // keep the phone frame centered on web/tablet

// Dynamic Type ceiling for text in FIXED-GEOMETRY chrome (the score/macro ring
// numerals, tab labels, button/stepper/avatar/pill text) where the OS "larger
// text" setting at 2–3x would spill or break a non-reflowing container. Body
// text inside scrollable cards is intentionally left uncapped so it can still
// reach the WCAG 1.4.4 200% target (cards reflow and the screen scrolls).
export const MAX_FONT_SCALE = 1.3;

// Some web environments need a hint that letterSpacing is in px.
export const isWeb = Platform.OS === 'web';
