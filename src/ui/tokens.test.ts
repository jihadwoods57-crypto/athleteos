// OnStandard — theming foundation invariants. Dark mode is only a clean palette swap if
// the dark palette mirrors EVERY light key; this locks that so a future color added to
// one palette must be added to both.
import { lightColors, darkColors } from './tokens';
import { contrastRatio, meetsAA } from '@/core/contrast';

describe('color theme foundation', () => {
  it('dark palette mirrors every light key', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it('every palette value is a 6-digit hex color', () => {
    for (const v of [...Object.values(lightColors), ...Object.values(darkColors)]) {
      expect(v).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('light and dark actually differ on the core surfaces', () => {
    expect(darkColors.bg).not.toBe(lightColors.bg);
    expect(darkColors.card).not.toBe(lightColors.card);
    expect(darkColors.text).not.toBe(lightColors.text);
  });
});

describe('text contrast clears WCAG AA on its surfaces (guards the audit fix)', () => {
  // Muted labels (tertiary/secondary) render at small sizes (11px eyebrows, meta), so they
  // need the 4.5:1 normal-text bar — not the 3:1 large-text bar. Locked so no future token
  // edit can regress tertiary back to the illegible #94A3B8 (2.56:1) the audit flagged.
  // Tertiary is held to the full surface set (incl. the bg2 tint used behind tiny tile
  // labels); secondary carries body text on card/bg (bg2 tiles use the dark primary text).
  const cases: [string, keyof typeof lightColors, readonly ('card' | 'bg' | 'bg2')[]][] = [
    ['light', 'textTertiary', ['card', 'bg', 'bg2']],
    ['light', 'textSecondary', ['card', 'bg']],
    ['dark', 'textTertiary', ['card', 'bg', 'bg2']],
    ['dark', 'textSecondary', ['card', 'bg']],
  ];
  for (const [theme, key, surfaces] of cases) {
    const palette = theme === 'light' ? lightColors : darkColors;
    for (const surfaceKey of surfaces) {
      it(`${theme} ${key} on ${surfaceKey} clears 4.5:1`, () => {
        const ratio = contrastRatio(palette[key], palette[surfaceKey]);
        expect(meetsAA(ratio)).toBe(true);
      });
    }
  }
});
