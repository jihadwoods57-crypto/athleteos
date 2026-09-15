/* The layout tier: ONE root attribute, html[data-layout], that css/wide.css keys every wide-screen
   rule on and the router reads to decide whether a route renders beside its list.

   Absent below 700px: the phone, and a Slide Over strip, exactly as they have always rendered.
   'wide' from 700px: a navigation rail on the left and one centered column.
   'split' from 1000px: the rail, plus a master pane and a detail pane when the route qualifies.

   Only on a touch device with no hover, the same condition app.css uses for phone-native mode, so
   the desktop preview at :8124 keeps its bezel unless ?layout=auto asks otherwise (the headless
   render script does). Design: docs/superpowers/specs/2026-09-15-ipad-layout-design.md */
export const WIDE_MIN = 700;
export const SPLIT_MIN = 1000;

export function layoutTier(width, phoneNative, force = false) {
  if (!phoneNative && !force) return null;
  if (width >= SPLIT_MIN) return 'split';
  if (width >= WIDE_MIN) return 'wide';
  return null;
}

/* Which list a screen renders beside, in the split tier.
   A master pairs with itself: its detail pane shows a prompt until a row is chosen.
   A detail pairs with the master behind its ORIGIN tab (the tab that was lit when it was pushed),
   and only when that module has loaded and declares itself a master. A detail opened from Home
   has no master and renders one column. `pending` asks the router to load the master and paint
   the detail alone meanwhile. A sheet (transient) never pairs; it floats over whatever is there. */
export function masterFor({ mod, route, tab, tabs, modOf }) {
  if (!mod || mod.transient) return null;
  if (mod.pane === 'master') return { route, mod, self: true };
  if (mod.pane !== 'detail') return null;
  const t = (tabs || []).find((x) => x.id === tab && !x.fab);
  if (!t || t.route === route) return null;
  const m = modOf(t.route);
  if (m === null) return { route: t.route, mod: null, pending: true };
  if (!m || m.pane !== 'master') return null;
  return { route: t.route, mod: m, self: false };
}

/* A DOM with attributes, or nothing: the router's node:test suites stub `document` with plain
   objects at module eval, and a stub without attributes is not a place a layout can live. */
function root() {
  if (typeof document === 'undefined') return null;
  const el = document.documentElement;
  return el && typeof el.setAttribute === 'function' && typeof el.getAttribute === 'function' && typeof el.removeAttribute === 'function' ? el : null;
}

export function currentTier() {
  const el = root();
  return el ? (el.getAttribute('data-layout') || null) : null;
}

/* Keeps html[data-layout] honest as the iPad rotates or a Split View divider moves, and tells the
   router when it changed so the shell re-lays out. Inert on the phone: the attribute is simply
   never set. */
export function initLayout(onChange) {
  if (typeof window === 'undefined' || !root()) return;
  const force = /(?:^|[?&])layout=auto(?:&|$)/.test(String((window.location && window.location.search) || ''));
  const mq = window.matchMedia ? window.matchMedia('(pointer: coarse) and (hover: none)') : null;
  const apply = () => {
    const tier = layoutTier(window.innerWidth, !!(mq && mq.matches), force);
    const was = currentTier();
    const el = root();
    if (!el) return;
    if (tier) el.setAttribute('data-layout', tier);
    else el.removeAttribute('data-layout');
    if (tier !== was && onChange) onChange(tier, was);
  };
  apply();
  window.addEventListener('resize', apply);
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
}
