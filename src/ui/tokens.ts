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

export const font = {
  // Plus Jakarta Sans weights loaded via @expo-google-fonts.
  r: 'PlusJakartaSans_400Regular',
  m: 'PlusJakartaSans_500Medium',
  sb: 'PlusJakartaSans_600SemiBold',
  b: 'PlusJakartaSans_700Bold',
  eb: 'PlusJakartaSans_800ExtraBold',
} as const;

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
