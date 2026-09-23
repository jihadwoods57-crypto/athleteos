/* The picker's palette: the proto's own tokens (proto/redesign-2026-07/css/tokens.css), so the
   native map reads as the same app as the WebView it opens over. Follows the system appearance. */
import { useColorScheme } from 'react-native';

const dark = {
  scheme: 'dark' as const,
  bg: '#070B14', surface: '#0E1421', well: '#131C2D', line: 'rgba(238,243,251,0.10)',
  text: '#EEF3FB', text2: '#9AA9C2', text3: '#7C8BA6',
  blue: '#3B82F6', blueDeep: '#2563EB', blueInk: '#60A5FA', onBlue: '#FFFFFF',
  disabledBg: '#1A2436', disabledText: '#7C8BA6', warn: '#F87171',
  bubbleFill: 'rgba(59,130,246,0.20)', bubbleEdge: '#3B82F6', scrim: 'rgba(7,11,20,0.72)',
};
const light: typeof dark = {
  scheme: 'light' as unknown as 'dark',
  bg: '#F8FAFC', surface: '#FFFFFF', well: '#F1F5F9', line: 'rgba(15,23,42,0.10)',
  text: '#0F172A', text2: '#475569', text3: '#5B6675',
  blue: '#2563EB', blueDeep: '#1D4ED8', blueInk: '#2563EB', onBlue: '#FFFFFF',
  disabledBg: '#E8EEF5', disabledText: '#5B6675', warn: '#B91C1C',
  bubbleFill: 'rgba(37,99,235,0.16)', bubbleEdge: '#2563EB', scrim: 'rgba(248,250,252,0.80)',
};
export type PickerTheme = typeof dark;

export function usePickerTheme(): PickerTheme {
  return useColorScheme() === 'light' ? light : dark;
}

/** The app's typeface (loaded in app/_layout.tsx). */
export const font = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
};
