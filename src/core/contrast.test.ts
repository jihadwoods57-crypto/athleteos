import { contrastRatio, meetsAA, parseHex, relativeLuminance } from './contrast';

describe('contrast', () => {
  describe('parseHex', () => {
    it('parses with and without the leading #', () => {
      expect(parseHex('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
      expect(parseHex('000000')).toEqual({ r: 0, g: 0, b: 0 });
      expect(parseHex('#64748B')).toEqual({ r: 100, g: 116, b: 139 });
    });
  });

  describe('relativeLuminance', () => {
    it('anchors black at 0 and white at 1', () => {
      expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
      expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
    });
  });

  describe('contrastRatio', () => {
    it('returns the canonical 21:1 for black on white', () => {
      expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
    });
    it('is symmetric in its arguments', () => {
      expect(contrastRatio('#64748B', '#FFFFFF')).toBeCloseTo(
        contrastRatio('#FFFFFF', '#64748B'),
        6,
      );
    });
    it('is 1:1 for a colour against itself', () => {
      expect(contrastRatio('#2563EB', '#2563EB')).toBeCloseTo(1, 6);
    });
  });

  describe('meetsAA', () => {
    it('requires 4.5:1 for normal text', () => {
      expect(meetsAA(4.5)).toBe(true);
      expect(meetsAA(4.49)).toBe(false);
    });
    it('relaxes to 3:1 for large text', () => {
      expect(meetsAA(3, true)).toBe(true);
      expect(meetsAA(2.99, true)).toBe(false);
      expect(meetsAA(3)).toBe(false);
    });
  });

  // Token guard: the colours we draw faint text in must clear WCAG AA on the
  // white card surface. #CBD5E1 used to be used for footers / the "/ cal" label
  // and fails badly (~1.48:1); textSecondary replaced it. This locks that in.
  describe('faint-text palette on white', () => {
    const WHITE = '#FFFFFF';
    const TEXT_SECONDARY = '#64748B';
    it('textSecondary clears AA for normal text on white', () => {
      expect(meetsAA(contrastRatio(TEXT_SECONDARY, WHITE))).toBe(true);
    });
    it('documents that #CBD5E1 fails AA (why it was retired for text)', () => {
      expect(meetsAA(contrastRatio('#CBD5E1', WHITE), true)).toBe(false);
    });
  });
});
