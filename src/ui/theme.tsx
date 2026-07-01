// OnStandard — theming foundation (light/dark palette swap).
//
// The mechanism dark mode rides on. It defaults to LIGHT, so wrapping the app in
// <ThemeProvider> changes nothing today. To actually ship dark mode, two more steps
// remain (tracked, intentionally NOT done here so appearance is unchanged):
//   1) migrate components from `import { colors }` (static light) to `const c = useColors()`,
//      and move hardcoded '#fff'/'#0F172A' surfaces onto tokens;
//   2) set ThemeProvider's scheme from the OS (Appearance / userInterfaceStyle: 'automatic')
//      and/or an in-app toggle, then run the contrast util over dark pairs on a device.
import React from 'react';
import { darkColors, lightColors, type ColorTheme } from './tokens';

export type ColorScheme = 'light' | 'dark';

interface ThemeValue {
  scheme: ColorScheme;
  colors: ColorTheme;
  setScheme: (s: ColorScheme) => void;
  toggle: () => void;
}

const defaultValue: ThemeValue = {
  scheme: 'light',
  colors: lightColors,
  setScheme: () => {},
  toggle: () => {},
};

const ThemeContext = React.createContext<ThemeValue>(defaultValue);

/** Provides the active palette. Defaults to light, so the app looks identical until a
 *  caller flips the scheme (OS setting or a toggle). */
export function ThemeProvider({
  children,
  scheme: controlled,
  initial = 'light',
}: {
  children: React.ReactNode;
  /** When provided, the root controls the scheme (from the store + OS). */
  scheme?: ColorScheme;
  initial?: ColorScheme;
}) {
  const [internal, setScheme] = React.useState<ColorScheme>(controlled ?? initial);
  // Keep internal state in sync when a caller controls the scheme.
  React.useEffect(() => {
    if (controlled) setScheme(controlled);
  }, [controlled]);
  const scheme = controlled ?? internal;
  const value = React.useMemo<ThemeValue>(
    () => ({
      scheme,
      colors: scheme === 'dark' ? darkColors : lightColors,
      setScheme,
      toggle: () => setScheme((s) => (s === 'dark' ? 'light' : 'dark')),
    }),
    [scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Full theme handle: { scheme, colors, setScheme, toggle }. */
export function useTheme(): ThemeValue {
  return React.useContext(ThemeContext);
}

/** The active palette — the migration target for `import { colors }`. Falls back to the
 *  light palette when used outside a provider, so it is always safe. */
export function useColors(): ColorTheme {
  return React.useContext(ThemeContext).colors;
}
