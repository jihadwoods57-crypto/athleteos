import { keyboardOverlap } from './keyboardOverlap';

const ev = (screenY: number, height: number) => ({ endCoordinates: { screenX: 0, screenY, width: 390, height } });

test('a docked keyboard covers the window from its top edge down', () => {
  expect(keyboardOverlap(ev(844 - 336, 336), 844)).toBe(336);
});

test('a hiding keyboard ends below the window and covers nothing', () => {
  expect(keyboardOverlap(ev(844, 336), 844)).toBe(0);
});

test('a floating iPad keyboard does not reach the bottom edge and covers nothing', () => {
  expect(keyboardOverlap(ev(400, 250), 1180)).toBe(0);
});

test('garbage in is zero out, never NaN into the page', () => {
  expect(keyboardOverlap({} as never, 844)).toBe(0);
  expect(keyboardOverlap(ev(Number.NaN, 336), 844)).toBe(0);
  expect(keyboardOverlap(ev(500, 344), 0)).toBe(0);
});
