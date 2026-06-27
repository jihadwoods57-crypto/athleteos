# Dark Mode — remaining work (foundation done, migration pending)

**Status:** the theming **foundation is shipped** (`ccd2185`) and the app defaults to
light, so nothing looks different today. Dark mode is now a palette swap away. This is the
checklist to actually finish and ship it — a dedicated effort, **best done after the
launch-blocker work** (it's premium polish, not a launch gate, and it needs real-device QA).

## Already done (the hard part)
- `src/ui/tokens.ts` — `lightColors` (default) + a full `darkColors` mirroring every key,
  and a `ColorTheme` type. A test locks the invariant that dark mirrors every light key.
- `src/ui/theme.tsx` — `ThemeProvider` + `useColors()` / `useTheme()` hooks (defaults to
  light, safe outside a provider).
- App root wrapped in `<ThemeProvider initial="light">`.

## What's left to complete (≈ one focused sprint)
1. **Migrate components off the static palette.** Replace `import { colors } from '@/ui/tokens'`
   with `const c = useColors()` (and use `c.*`) in every screen/overlay/primitive (~30 files
   under `src/screens` + `src/ui`). Note: `useColors()` is a hook, so module-scope style
   objects that reference `colors` must move inside the component.
2. **Tokenize hardcoded surfaces.** Many views hardcode `'#fff'`, `'#0F172A'`, `'#CBD5E1'`,
   etc. Grep `rg "'#fff'|'#FFFFFF'|'#0F172A'|#CBD5E1" src/screens src/ui` and move each onto
   a token (`card`, `text`, `textTertiary`, …) or they will stay white/dark in dark mode.
3. **Shadows in dark.** Card shadows mostly disappear on dark backgrounds — rely on surface
   elevation (`card` vs `bg`) and reduce/disable `shadow.*` when `scheme === 'dark'`.
4. **Theme-aware extras.** The score `gradeRing`, chart strokes/fills (`TrendChart`,
   weight/compliance charts), and SVG gradients (`Ring`) need dark-tuned values; the
   `StatusBar` style must follow the scheme (`<StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />`).
5. **Drive the scheme.** Set `app.json` `userInterfaceStyle` to `automatic`, read the OS via
   `Appearance.getColorScheme()` / `useColorScheme()` to initialize `ThemeProvider`, and add
   an in-app override toggle (persist the choice in the store).
6. **Contrast QA on a real device.** Run `src/core/contrast.ts` (`contrastRatio` / `meetsAA`)
   over every text-on-surface pair in dark; dark mode is where contrast bugs hide and
   headless can't judge it.

## Acceptance
- Flipping the scheme (OS or toggle) renders a coherent dark UI with **no white flashes**,
  no unreadable text, and all status colors still legible.
- Light mode is byte-for-byte unchanged.
- Every text/surface pair passes WCAG-AA contrast in both schemes.

## Effort / risk
~1 focused sprint. Mechanical but app-wide (large diff), and it **requires real-device
testing** — do not consider it done from a headless/CI run alone.
