import { metersPerPoint, toScreen, handlePoint, radiusFromDrag, zoomToFit, type Region } from './geometry';

// A 400 x 800 pt map centred on the equator, 0.01 deg of longitude wide: ~1113 m across.
const size = { width: 400, height: 800 };
const eq: Region = { lat: 0, lng: 0, latDelta: 0.02, lngDelta: 0.01 };

test('metres per point come from the visible span and the map width', () => {
  expect(metersPerPoint(eq, size)).toBeCloseTo(1113.2 / 400, 1);
  // At 60 deg north a degree of longitude is half as long.
  expect(metersPerPoint({ ...eq, lat: 60 }, size)).toBeCloseTo(1113.2 / 800, 1);
});

test('the camera centre is the middle of the view; north is up, east is right', () => {
  expect(toScreen({ lat: 0, lng: 0 }, eq, size)).toEqual({ x: 200, y: 400 });
  const ne = toScreen({ lat: 0.005, lng: 0.0025 }, eq, size);
  expect(ne.x).toBeCloseTo(300);
  expect(ne.y).toBeCloseTo(200);
});

test('the drag handle sits on the east edge of the bubble, and hides when that is off screen', () => {
  const mpp = metersPerPoint(eq, size);
  const h = handlePoint({ lat: 0, lng: 0 }, 150, eq, size);
  expect(h).not.toBeNull();
  expect(h!.x).toBeCloseTo(200 + 150 / mpp);
  expect(h!.y).toBeCloseTo(400);
  expect(handlePoint({ lat: 0, lng: 0 }, 1000, eq, size)).toBeNull();
});

test('dragging the handle sets the radius from the finger distance, snapped and clamped', () => {
  const mpp = 2; // metres per point
  expect(radiusFromDrag({ x: 100, y: 100 }, { x: 175, y: 100 }, mpp)).toBe(150);
  expect(radiusFromDrag({ x: 100, y: 100 }, { x: 160, y: 180 }, mpp)).toBe(200); // 100 pt away
  expect(radiusFromDrag({ x: 100, y: 100 }, { x: 101, y: 100 }, mpp)).toBe(100);
  expect(radiusFromDrag({ x: 0, y: 0 }, { x: 5000, y: 0 }, mpp)).toBe(1000);
});

test('the camera zooms so the whole bubble fits with room around it', () => {
  const z = zoomToFit(150, 0);
  const lngDelta = 360 / Math.pow(2, z);
  const widthMeters = lngDelta * 111320;
  expect(widthMeters).toBeGreaterThan(300 * 1.5);
  expect(widthMeters).toBeLessThan(300 * 2.5);
  expect(zoomToFit(1000, 0)).toBeLessThan(z);
});
