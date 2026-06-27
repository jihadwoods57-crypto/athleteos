// AthleteOS — theming foundation invariants. Dark mode is only a clean palette swap if
// the dark palette mirrors EVERY light key; this locks that so a future color added to
// one palette must be added to both.
import { lightColors, darkColors } from './tokens';

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
