// Per-tab navigation stacks (proto/redesign-2026-07/js/nav-stack.js) — the pure model
// behind "Back returns to the exact screen and scroll position you came from" (athlete
// experience spec §1.5/§10).
// @ts-ignore
import { emptyNav, pushOrigin, popOrigin, peekOrigin, resetTab, STACK_MAX } from '../../proto/redesign-2026-07/js/nav-stack.js';

describe('nav-stack', () => {
  test('push then pop returns the exact origin with its scroll position', () => {
    const nav = emptyNav();
    pushOrigin(nav, 'home', 340);
    expect(popOrigin(nav)).toEqual({ r: 'home', s: 340 });
    expect(popOrigin(nav)).toBeNull(); // stack drained → fallback territory
  });

  test('stacks are PER TAB: a profile drill-down never pollutes home', () => {
    const nav = emptyNav();
    pushOrigin(nav, 'home', 0);           // home tab: Home → detail
    resetTab(nav, 'profile');             // switch tabs
    pushOrigin(nav, 'profile', 800);      // profile tab: Profile → notif-settings
    expect(popOrigin(nav)).toEqual({ r: 'profile', s: 800 });
    resetTab(nav, 'home');                // tab switch resets ITS OWN stack
    expect(popOrigin(nav)).toBeNull();    // home stack was cleared by the explicit reset
  });

  test('sub-routes are preserved verbatim (meal-detail/lunch restores as itself)', () => {
    const nav = emptyNav();
    nav.tab = 'progress';
    pushOrigin(nav, 'history', 1200);
    pushOrigin(nav, 'meal-detail/lunch', 55);
    expect(peekOrigin(nav)).toEqual({ r: 'meal-detail/lunch', s: 55 });
    expect(popOrigin(nav)).toEqual({ r: 'meal-detail/lunch', s: 55 });
    expect(popOrigin(nav)).toEqual({ r: 'history', s: 1200 });
  });

  test('consecutive duplicates collapse (re-tapping a row cannot stack identical back-targets)', () => {
    const nav = emptyNav();
    pushOrigin(nav, 'home', 10);
    pushOrigin(nav, 'home', 90); // same route again → updates scroll, no second entry
    expect(popOrigin(nav)).toEqual({ r: 'home', s: 90 });
    expect(popOrigin(nav)).toBeNull();
  });

  test('depth is bounded at STACK_MAX (oldest entries fall off, never unbounded growth)', () => {
    const nav: any = emptyNav();
    for (let i = 0; i < STACK_MAX + 10; i++) pushOrigin(nav, `screen-${i}`, i);
    expect(nav.stacks.home.length).toBe(STACK_MAX);
    expect(nav.stacks.home[0].r).toBe('screen-10'); // the 10 oldest were shed
  });
});
