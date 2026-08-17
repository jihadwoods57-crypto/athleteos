/* Per-tab navigation stacks — the pure model behind "Back returns to the exact screen and
   scroll position you came from" (athlete-experience spec §1.5/§10).

   Shape: { tab: 'home', stacks: { home: [{r,s,v}], plan: [], progress: [], profile: [] } }
     - `tab` is the active bottom-tab id (the ORIGIN tab, which detail screens inherit).
     - Each stack entry is { r: 'route' or 'route/sub', s: scrollTop-at-departure, v?: anchor }.
     - `v` is the shared-element anchor the departure morphed FROM: { k: key, i: instance-id }.
       It exists so Back can morph too. On the way in, the tapped node is known and names itself;
       on the way OUT there is no tap, and the screen being returned to may hold several elements
       under one key (Home shows three meal photographs), so the pop needs to be told which one it
       came from. Kept as two short strings rather than anything richer because this whole object is
       JSON in sessionStorage.

   Rules (enforced by the router, modeled here):
     - Navigating to a tab ROOT resets that tab's stack (standard tab-bar semantics).
     - Navigating to a detail screen pushes the origin (unless the origin is transient —
       flow interstitials like the camera/analyzing never become back-targets).
     - Back pops one entry; the router restores its scroll position after paint.
   No DOM, no Date, no storage — the router owns persistence (sessionStorage). */

export const STACK_MAX = 24;

export function emptyNav(defaultTab = 'home') {
  return { tab: defaultTab, stacks: {} };
}

/** Push the departing screen onto the ACTIVE tab's stack. Consecutive duplicates collapse
 *  (re-tapping the same row can't build a pile of identical back-targets).
 *  `anchor` is the { k, i } the departure morphed from, or null; it rides along so Back can morph
 *  back to the same element. A collapsed duplicate takes the NEW anchor: the athlete's most recent
 *  tap is the one Back should return to. */
export function pushOrigin(nav, fullRoute, scroll, anchor) {
  if (!nav.stacks[nav.tab]) nav.stacks[nav.tab] = [];
  const st = nav.stacks[nav.tab];
  const top = st[st.length - 1];
  if (top && top.r === fullRoute) {
    top.s = scroll || 0;
    if (anchor) top.v = anchor; else delete top.v;
    return;
  }
  const entry = { r: fullRoute, s: scroll || 0 };
  if (anchor) entry.v = anchor;
  st.push(entry);
  if (st.length > STACK_MAX) st.shift();
}

/** Pop the active tab's stack: the exact screen (and scroll) to return to, or null. */
export function popOrigin(nav) {
  const st = nav.stacks[nav.tab];
  return (st && st.length) ? st.pop() : null;
}

export function peekOrigin(nav) {
  const st = nav.stacks[nav.tab];
  return (st && st.length) ? st[st.length - 1] : null;
}

/** Explicit switch to a main tab: activate it and clear its stack (tab roots never
 *  accumulate back-targets — tapping Home always lands on a root Home). */
export function resetTab(nav, tab) {
  nav.tab = tab;
  nav.stacks[tab] = [];
}
