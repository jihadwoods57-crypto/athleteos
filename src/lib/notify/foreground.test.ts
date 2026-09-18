import { presentationFor } from './foreground';

// The regression: with no handler at all, expo-notifications shows nothing in the foreground.
// These pin the rule that the DEFAULT is to show, so a coach message arriving while the athlete
// is looking at the app can never silently disappear again.
describe('presentationFor', () => {
  it('shows a banner and lists an ordinary notification', () => {
    expect(presentationFor({ sound: 'default' })).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  it('still shows a notification that asked for no sound, just quietly', () => {
    const p = presentationFor({ sound: null });
    expect(p.shouldShowBanner).toBe(true);
    expect(p.shouldShowList).toBe(true);
    expect(p.shouldPlaySound).toBe(false);
  });

  it('shows anything at all rather than nothing — missing content is still a notification', () => {
    for (const input of [undefined, null, {}]) {
      expect(presentationFor(input).shouldShowBanner).toBe(true);
    }
  });

  it('stays out of the way for a data-only wake-up push', () => {
    expect(presentationFor({ data: { silent: true }, sound: 'default' })).toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });

  it('treats a route-carrying push as ordinary — a deep link is not a silent push', () => {
    expect(presentationFor({ data: { route: 'coach-meal/abc' }, sound: 'default' }).shouldShowBanner).toBe(true);
  });

  it('never sets the badge: the bell count is server truth', () => {
    expect(presentationFor({ sound: 'default' }).shouldSetBadge).toBe(false);
    expect(presentationFor({ data: { silent: true } }).shouldSetBadge).toBe(false);
  });
});
