/* The capability line the proto reads before its first line runs (final review I-1, I-2). An OTA
   puts the same bridge shim on every binary, so only the NATIVE side can say what is really there.
   On an old build (no ExpoLocation, no ExpoMaps) every answer must be false. */
jest.mock('../lib/location', () => ({
  isLocationAvailable: jest.fn(() => true),
  walkInAllowed: jest.fn(() => true),
}));
jest.mock('../lib/maps/mapsNative', () => ({
  mapSupport: jest.fn(() => ({ ok: true, maps: {} })),
  locationModule: jest.fn(() => ({})),
}));

import { nativeCaps, nativeCapsScript } from './nativeCaps';

const loc = () => jest.requireMock('../lib/location') as Record<string, jest.Mock>;
const maps = () => jest.requireMock('../lib/maps/mapsNative') as Record<string, jest.Mock>;

describe('nativeCaps', () => {
  test('a new build with everything: location, walk-in and the map', () => {
    expect(nativeCaps()).toEqual({ location: true, walkIn: true, maps: true, mapReason: null });
  });

  test('an OLD build (the modules are not compiled in) reports every capability false', () => {
    loc().isLocationAvailable.mockReturnValueOnce(false);
    maps().mapSupport.mockReturnValueOnce({ ok: false, reason: 'Update OnStandard to see the map.' });
    maps().locationModule.mockReturnValueOnce(null);
    expect(nativeCaps()).toEqual({ location: false, walkIn: false, maps: false, mapReason: 'update' });
  });

  test('a map module without location search is no map: the search box would not take input', () => {
    maps().locationModule.mockReturnValueOnce(null);
    expect(nativeCaps()).toMatchObject({ maps: false, mapReason: 'update' });
  });

  test('a binary with the map but an OS that cannot draw it says so as an OS reason, not "update"', () => {
    maps().mapSupport.mockReturnValueOnce({ ok: false, reason: 'The map needs iOS 17 or later.' });
    expect(nativeCaps()).toMatchObject({ maps: false, mapReason: 'os' });
  });

  test('walk-in switched off (WALK_IN) leaves "I\'m here" on', () => {
    loc().walkInAllowed.mockReturnValueOnce(false);
    expect(nativeCaps()).toMatchObject({ location: true, walkIn: false });
  });

  test('a throwing probe is a false, never a crash at launch', () => {
    loc().isLocationAvailable.mockImplementationOnce(() => { throw new Error('boom'); });
    maps().mapSupport.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(nativeCaps()).toMatchObject({ location: false, walkIn: false, maps: false });
  });

  test('the injected line sets window.__OS_NATIVE_CAPS to plain JSON', () => {
    const line = nativeCapsScript({ location: false, walkIn: false, maps: false, mapReason: 'update' });
    expect(line).toBe('window.__OS_NATIVE_CAPS = {"location":false,"walkIn":false,"maps":false,"mapReason":"update"}; true;');
  });
});
