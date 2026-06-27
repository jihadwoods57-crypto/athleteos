// AthleteOS — design tokens, transcribed from the handoff README.
import { Platform } from 'react-native';

export const colors = {
  bg: '#F8FAFC',
  bg2: '#F1F5F9',
  card: '#FFFFFF',
  text: '#0F172A',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
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
export const darkColors: ColorTheme = {
  bg: '#0B1120',
  bg2: '#111827',
  card: '#1E293B',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  slate500: '#94A3B8',
  slate600: '#CBD5E1',
  slate700: '#E2E8F0',

  accent: '#3B82F6',
  accentLight: '#60A5FA',
  accentSurface: '#172554',
  accentBorder: '#1E3A8A',
  accentBorderStrong: '#2563EB',

  success: '#22C55E',
  successDeep: '#4ADE80',
  successSurface: '#052E16',

  warning: '#F59E0B',
  warningDeep: '#FBBF24',

  alert: '#F87171',
  alertDeep: '#FCA5A5',
  alertSurface: '#450A0A',
  alertBorder: '#7F1D1D',

  hydration: '#38BDF8',
  trainer: '#A855F7',
  trainerLight: '#C084FC',

  divider: '#1E293B',
  divider2: '#172033',
  track: '#334155',
  border: '#1E293B',

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

export const shadow = {
  card: makeShadow(12, 0.06, 6, 3),
  elevated: makeShadow(20, 0.08, 10, 6),
  cta: {
    shadowColor: '#2563EB',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
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
