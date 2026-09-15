# iPad layout: sidebar shell plus two-pane for the coach's lists

Date: 2026-09-15. Founder ruling: coaches and operators first; landscape, portrait and Split
View all supported; the phone stays portrait-only.

## What an iPad gets today

- `app.json` declares `ios.supportsTablet: false`. On an iPad the app runs in the scaled iPhone
  compatibility window: letterboxed, portrait only, no Split View.
- `app/_layout.tsx` pins the WebView to a 440px centered column (760px for oversight roles, but
  that branch reads a legacy store value the proto never sets, so it is dead).
- The proto has no wide-viewport rule at all. Every `@media` in `proto/redesign-2026-07/css/`
  is narrow-width, reduced-motion or pixel-ratio. At 820px or 1180px wide the cards stretch,
  the floating tab capsule spans the screen and every list is a phone drawn on a billboard.

## Goals

1. The app is a real iPad app: full screen, every orientation, Split View and Slide Over.
2. A coach at a desk sees the roster or inbox on the left and the athlete or thread on the
   right, without leaving the list.
3. Every other screen, for every role, sits in a comfortable centered column beside a
   navigation rail, with no per-screen work.
4. The phone is untouched. Below 700px wide nothing in this design applies, including a
   Split View third of an iPad screen.

## Non-goals

- Dashboard-style tablet layouts for coach home or insights. Those stay one column.
- Athlete-side two-pane layouts. The mechanism is general and a later pass can opt screens in.
- A desktop web build. The proto still runs in the WebView shell only.
- App Store submission itself. iPad screenshots become a submission requirement and are noted
  in `docs/APP-STORE-READINESS.md`; producing them is outside this change.

## Native shell

- `app.json`: `ios.supportsTablet` becomes `true`. `orientation` stays `"portrait"` for the
  phone. `ios.requireFullScreen` stays unset (false). Expo SDK 57's `withRequiresFullScreen`
  config plugin (`node_modules/@expo/config-plugins/build/ios/RequiresFullScreen.js`) then
  writes all four orientations into `UISupportedInterfaceOrientations~ipad` on its own, which
  is exactly what Apple's multitasking rule requires (ITMS-90474). No plist key is added by hand.
- `app/_layout.tsx`: the max-width wrapper goes. The Stack fills the window. The
  `DEVICE_MAX_WIDTH` import and the dead `flow` read go with it.
- Rotation and Split View resize the WebView. The proto's `.device` is already
  `100vw x calc(100dvh - var(--kb))` in phone-native mode, and `js/keyboard.js` measures the
  keyboard off `visualViewport`, so both keep working with no change.
- A new native build is required for the flag to take effect. An OTA update cannot change
  `supportsTablet`. The proto changes ship in the same build, and also over the air to phones,
  where they are inert.

## Layout tiers: the one new concept

A new module `proto/redesign-2026-07/js/layout.js` owns a single root attribute,
`html[data-layout]`, with three states:

| State | Window width | What it means |
|---|---|---|
| absent | under 700px | The phone layout, exactly as today |
| `wide` | 700px to 999px | Navigation rail on the left, one centered column |
| `split` | 1000px and up | Rail, plus master and detail panes when the route qualifies |

Rules:

- The tier is computed from `window.innerWidth`, re-evaluated on `resize` and on the two
  `matchMedia` queries `(min-width: 700px)` and `(min-width: 1000px)`. A tier change calls
  `window.__render()` so the shell re-lays out as the iPad rotates or a Split View divider moves.
- The tier only applies on a touch device with no hover, the same condition `css/app.css`
  already uses for phone-native mode, so a desktop browser at :8124 keeps showing the phone
  bezel. `?layout=auto` in the query string drops the pointer condition. That is the escape
  hatch for the desktop preview and for the headless render script.
- The pure function `layoutTier(width, phoneNative, force)` is exported and unit tested at the
  boundaries (699, 700, 999, 1000).

`css/wide.css` is a new stylesheet linked after `glass.css` and before `focus.css` (focus.css
owns `::after`). Every rule in it is scoped under `html[data-layout]` or
`html[data-layout="split"]`, so it is inert on the phone by construction.

## The rail

The same `tabbar()` markup becomes a vertical rail through CSS alone.

- `tabbar()` stops emitting an inline `grid-template-columns` and publishes the column count as
  `--n` instead. `app.css` reads `repeat(var(--n, 5), 1fr)`. `glass.css`'s lens already reads
  `--n`. The inline-style ratchet count does not grow: one style attribute becomes one style
  attribute.
- In wide tiers `.tabbar` is `position: absolute; left: 0; top: 0; bottom: 0;
  width: var(--rail-w)` with `--rail-w: 88px`, laid out as grid rows of 64px, top-aligned
  after the safe-area inset. The lens translates on Y instead of X. The FAB sits in its row
  with no negative margin and no scrim.
- `.screen` gets `padding-left: calc(var(--rail-w) + env(safe-area-inset-left, 0px))` so the
  viewport starts beside the rail.
- `--tab-clear` (glass.css, on `:root`) is overridden under `html[data-layout]` to the safe-area
  inset plus 24px, because nothing floats over the bottom edge any more. `.viewport`'s
  bottom padding and every sticky bar's `--bar-lift` follow from it without change.
- The keyboard: `body.kb-open .tabbar` keeps `transform: none` in wide tiers. The rail does not
  leave.

## The column

- `html[data-layout] .view { max-width: 720px; margin: 0 auto; width: 100%; }`. Every screen,
  every role. The screen canvas and its grain stay behind it.
- `.viewport` side padding widens to `var(--s6)` in wide tiers so the column never touches the
  rail.
- Bottom-anchored overlays become centered dialogs: `.sheet`, `.memsheet` and `.mqsheet` get
  `left: 50%; top: 50%; bottom: auto; transform: translate(-50%, -50%); width: min(480px,
  calc(100% - 48px))` with an opacity-and-scale entrance in place of `sheetUp`. Their scrims
  are unchanged. `.imgview` and `.tour` already fill the screen and need nothing.

## Two-pane

### The module contract

A screen module may declare `pane: 'master'` (a list whose rows push details) or
`pane: 'detail'` (a screen that opens from such a list). Nothing else about the module changes.

Declarations in this change:

| Module | File | pane |
|---|---|---|
| `coachRoster` | `js/screens/coach-roster.js` | master |
| `coachInbox` | `js/screens/coach.js` | master |
| `coachAthlete` | `js/screens/coach.js` | detail |
| `coachMeal` | `js/screens/coach.js` | detail |
| `coachPlan` | `js/screens/coach.js` | detail |
| `coachAssign` | `js/screens/coach.js` | detail |

`coachRoster` serves both `coach-roster` and `trainer-roster`; `coachInbox` serves both inboxes.
Roll call (`coach-commitments`) keeps its detail as a sub of the same route and is left one
column in this change.

### Resolving the master

`masterFor({ mod, route, tab, tabs, modOf })` in `js/layout.js`, pure and unit tested:

1. If `mod.pane === 'master'`, the master is the current route itself and the detail pane shows
   a placeholder.
2. If `mod.pane === 'detail'`, look up the origin tab (`NAV.tab`) in the role's tab set, take
   its route, and ask `modOf(route)`. It qualifies only if that module declares
   `pane: 'master'`. A detail opened from Home has no master and renders one column.
3. If the master module is lazy and not yet loaded, the router asks `loadScreen(route)` for it,
   repaints when it lands, and renders one column meanwhile.
4. Never in the phone or wide tiers, never for a denied route, never for the pre-hydrate paint,
   never for a transient (sheet) route.

### What the router renders in split

```html
<div class="screen split">
  <div class="statusbar" aria-hidden="true"></div>
  <div class="pane pane-master">
    <div class="viewport" id="viewport-master">
      <main class="view" id="view-master">…master render…</main>
    </div>
  </div>
  <div class="pane pane-detail">
    <div class="viewport …" id="viewport">
      <main class="view enter" id="view">…detail render, or the placeholder…</main>
    </div>
  </div>
  <nav class="tabbar">…</nav>
</div>
```

- The master pane is 380px wide with a hairline on its right; the detail pane takes the rest,
  and the detail `.view` keeps the 720px column cap.
- The master renders with `{ sub: null, S }` and mounts against its own pane element. The detail
  keeps `id="viewport"` and `id="view"` and mounts against `#device` exactly as today, so every
  existing screen-side lookup still finds its own elements. Master mounts first.
- The row in the master whose `data-go` equals the current full route gets
  `aria-current="page"`, and `wide.css` paints it as selected.
- The master's scroll position is captured from `#viewport-master` before the replace and
  restored after, on the same terms the detail's already is.
- The placeholder is an `emptyState`-shaped card: "Choose an athlete" for the roster, "Choose a
  thread" for the inbox, with the role's noun from `vocab()`.
- Split renders never use the layered push/pop slide or a view transition: both are whole-screen
  choreographies and the screen is not what moved. The detail `.view` carries `.enter` on a real
  arrival, the same fade every screen has.
- `js/gestures.js`: `eligibleBack` refuses while `.screen.split` is present. The lateral pager
  only arms inside `#viewport`, never inside the master pane.
- `window.__screenCleanup` and `__threadTick` are single slots. Neither master module registers
  one (grep confirms), so the detail's registration stands. If a future master needs one the
  router must chain them; that is called out in a comment at the mount site.

### Back and deep links

- Back from a detail whose origin is the master pops to the master route, which in split renders
  the master with the placeholder. The back chip stays; it is also the way out of a nested detail
  (athlete into meal).
- A deep link straight to `coach-athlete/<id>` with `NAV.tab` stamped `roster` splits; with any
  other origin tab it renders one column. Both are correct.

## Verification

Default gates (part of `npm run verify`, in `test:proto`):

- `js/layout.test.mjs`: `layoutTier` boundaries; `masterFor` for every branch above (master
  route, detail with a loaded master, detail with a lazy master, detail from Home, transient).
- `js/wide.test.mjs` (regex over sources, in the manner of `glass.test.mjs`): `index.html`
  links `wide.css` between `glass.css` and `focus.css`; every top-level rule in `wide.css` is
  scoped under `html[data-layout`; `tabbar()` carries no inline `grid-template-columns`;
  `app.css` reads `--n`; the six modules carry the declared `pane`; `--tab-clear` is overridden.
- `js/gestures.test.mjs` gains: a split screen refuses the back drag.
- The inline-style, spacing and type ratchets must not grow. New CSS uses scale tokens.

Opt-in, because the cloud founder sessions have no browser: `scripts/ipad-shots.mjs` renders
the proto headless with `?layout=auto` at 820x1180, 1180x820, 1024x1366 and 375x1024 (Slide
Over), seeds a coach session by module mutation, walks welcome, coach-home, coach-roster and
coach-athlete, asserts the document and `.device` never scroll horizontally and that the rail
is present at 700px and up, and writes PNGs to `.tmp/ipad-shots/`. It borrows `playwright-core`
from the sibling Formation IQ checkout the way the existing headless recipe does, and says so
loudly when it cannot.

## Ship

- `node scripts/build-proto-zip.mjs`, `npm run verify` green, commit with explicit paths, push.
- A new EAS build is needed for `supportsTablet`. That is the founder's call and is not run here.
- `docs/APP-STORE-READINESS.md` gains the iPad screenshot requirement.
