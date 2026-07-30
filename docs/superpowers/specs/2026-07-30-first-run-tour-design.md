# First-run guided tour — design

*2026-07-30 · status: approved design, not yet implemented*

## The problem

A new user finishes onboarding and lands on a screen full of surfaces nobody has
explained. The score ring, the log button, the plan, the coach receipt — every one
of them is obvious once you know, and invisible until then. Onboarding collects
answers; nothing in the app has ever oriented anyone.

## What we are building

A short spotlight tour that runs once, the first time a signed-in user reaches
their role's landing screen. It dims the real app, cuts a hole around one real
element at a time, and explains it in a sentence. Four to six steps, roughly
thirty seconds, Skip always visible, replayable from Settings.

It is personalized on two axes: **which** steps you get comes from your role, and
**which optional steps and wording** you get comes from what you set up during
onboarding (goal, coach link, connected wearable).

### Non-goals

- No video, no screenshots, no carousel of static welcome cards.
- No AI-generated copy. Every string is written, reviewed, and shipped in code.
- No blocking gate. Skip is always one tap, and skipping is a complete exit.
- No tour for signed-out or mid-onboarding users.

---

## 1. Architecture

Two modules, split the way `review-ask.js` is split — a pure predicate that can be
tested exhaustively in bare Node, and a DOM driver that cannot.

### `js/tour-plan.js` — pure, no DOM

```js
export function planTour(ctx) -> { id, steps: [Step] }
```

`ctx` is a plain object assembled by the caller from `RT` and `S`:

| field | source | used for |
|---|---|---|
| `role` | `RT.authRole` (`'athlete'\|'coach'\|'trainer'\|'parent'`) | picks the step list |
| `audience` | `S.audience` (`'client'` vs athlete) | copy variant only |
| `goal` | `RT.profile.baseGoal \|\| RT.ob.goal` | copy interpolation |
| `hasCoach` | `!!RT.myCoach \|\| !!RT.myTrainer` | conditional step |
| `hasStandards` | `(RT.csRows \|\| []).length > 0` | conditional step |
| `seenAt` | `RT.tourSeen[id]` | suppression |
| `route` | current hash route | must equal the role's landing route |

A `Step` is `{ key, anchor, title, body, optional }`. `anchor` is a `data-tour`
value, never a CSS id — see §3. `planTour` returns `{ id, steps: [] }` when the
tour should not run at all (already seen, wrong route, signed out, unknown role).

Conditional steps are resolved *inside* `planTour` by a `when(ctx)` predicate on
the step definition, so the returned array is already final. The driver never
makes an inclusion decision — that keeps every personalization rule inside the
tested module.

### `js/tour.js` — the DOM driver

```js
export function maybeStartTour(ctx)   // called from a screen's mount()
export function startTour(plan)       // called by the Settings replay row
```

Follows the house overlay idiom established by `image-viewer.js` and
`members-sheet.js`: module-level singleton, `document.body.appendChild`, then
`requestAnimationFrame(() => el.classList.add('on'))`, and a 180 ms removal
timeout matching the CSS transition.

Structure per step: a full-viewport `.tour` backdrop with a transparent cutout
positioned over the anchor's bounding rect, plus a `.tour-card` holding the
title, body, a step counter, **Skip** and **Next** (**Done** on the last step).

The cutout is a four-panel scrim rather than an SVG mask or `box-shadow` trick —
four absolutely-positioned divs (above / below / left / right of the anchor rect)
each with the backdrop color. It is trivially correct at any rect, needs no
`clip-path` support question, and lets the highlighted element stay fully
interactive if we ever want that. The card is placed below the anchor, flipping
above when there is not enough room, and clamped to the viewport.

---

## 2. When it fires

The router's `__render()` re-runs `mount()`. Three separate bugs in this codebase
have come from treating mount as "first time." The tour must not restart, stack,
or re-open on a repaint.

Guards, in order:

1. **Module-level singleton** — `let active = null` in `tour.js`; `startTour`
   returns immediately if an overlay exists. (Same shape as `lock-moment.js`'s
   `showing`.)
2. **Seen flag checked in `planTour`** — a tour that has been seen returns zero
   steps, so a repaint after completion is a no-op by construction.
3. **Marked on show, not on dismiss** — the flag is written when the first step
   paints, matching `maybeShowLock()`. A user who force-quits mid-tour does not
   get it again on next launch; they can replay from Settings. This is
   deliberate: a tour that reappears after being half-seen reads as broken.

Entry point: `maybeStartTour(ctx)` is called at the end of `mount()` on
`home.js` (athlete), `coach-home.js` (coach and trainer), and the `parent` screen
in `coach.js`. It is not called from any onboarding screen, and `planTour`
independently rejects any route that is not the role's landing route — so an
onboarding detour through Settings cannot trigger it.

There is one deliberate delay: the driver waits one animation frame plus 600 ms
before painting, so the home entrance stagger and the score-ring animation finish
first. The number the tour points at should already be at rest.

---

## 3. Anchors

Recon found that Home's key surfaces have **no stable ids** — the score ring is
`.xhero`, the primary CTA is `.xnow .xcta`, and both are absent on some of Home's
four render branches. Adding ids would collide across branches.

So: **anchors are `data-tour="<name>"` attributes** added to the existing markup.
One attribute, no structural change, no styling impact, greppable, and safe on a
branch where the element does not render.

| anchor | element | file |
|---|---|---|
| `score` | `.xhero` | `home.js` |
| `log` | `.tabbar .fab[data-go="log"]` | `router.js` |
| `plan` | `.tabbar .tab[data-go="plan"]` | `router.js` |
| `standards` | `#cs-slot` card | `home.js` |
| `coach-seen` | `#seen-row` | `home.js` |
| `roster` | scope switcher `[data-scopes]` | `coach-home.js` |
| `priority` | priority queue card | `coach-home.js` |
| `activity` | live activity feed | `coach-home.js` |
| `followups` | follow-ups card | `coach-home.js` |
| `children` | `#par-list` | `coach.js` |
| `visibility` | the "what you can see" `.sidebox` | `coach.js` |
| `funding` | `.lrow[data-go="fund-plan"]` | `coach.js` |

Two anchors live on the tab bar, which the router owns and which is absent for
parents — correct, since no parent step references it.

**Missing anchors are dropped, not fatal.** At open time the driver resolves each
step's anchor with `querySelector('[data-tour="…"]')` and silently discards steps
whose element is missing or has a zero-size rect. Home's async slots (`#cs-slot`,
`#seen-row`) fill after mount, which is the main reason the 600 ms delay exists;
if they are still empty, those steps simply do not appear. A plan that resolves
to fewer than two steps is abandoned entirely rather than shown as a stub.

---

## 4. The step lists

Copy below is the intent, not final wording — it gets a pass before ship. Steps
marked *(conditional)* only appear when their predicate holds.

### Athlete (and client — same steps, different nouns)

1. **`score`** — "This is your Standard. One number for the day. It moves when you log."
2. **`log`** — "Everything starts here. Photograph a meal, log training, mark a commitment."
3. **`plan`** — "Your plan lives here." Goal-aware tail: for `lose`, "Built around cutting"; for `gain`, "Built around adding size"; `maintain` / `performance` / `build` / `health` get their own tail. Unknown or missing goal falls back to no tail.
4. *(conditional, `hasCoach`)* **`coach-seen`** — "Your coach sees what you log. This shows when they've looked."
5. *(conditional, `hasStandards`)* **`standards`** — "Connected Standards verify some of this automatically from your watch."
6. **`log`** again, as the closing frame — "That's it. Log something and your number moves."

Steps 4 and 5 are both optional, so an unlinked solo athlete with no wearable
gets a four-step tour and a linked athlete with a watch gets six. Both read as
complete.

### Coach

1. **`roster`** — "Everything here is scoped. Switch between your whole team and a group."
2. **`priority`** — "Who needs you today, ranked. Start here every morning."
3. **`activity`** — "Live activity — meals and logs as they land."
4. **`followups`** — "Anything you flagged waits here until you close it."

### Trainer

Same four anchors, since trainer and coach render the same module. The copy runs
through the existing `vocab()` layer so "team" becomes "practice" and "athletes"
become "clients" without a second step list. This is why the tour id is
`tour:coach` and `tour:trainer` separately even though the steps are shared —
each role marks its own seen flag.

### Parent

1. **`children`** — "The athletes you're linked to."
2. **`visibility`** — "You see their standard and whether the work is happening. You don't see their photos or messages."
3. **`funding`** — "You can fund a plan for them from here."

Three steps, and that is honestly the whole parent surface. Padding it would be
worse than ending early.

---

## 5. Persistence

Two layers, matching how the codebase already handles one-time flags.

**Device-local (the fast path):** `RT.tourSeen` — a map of tour id → ISO
timestamp, added to `DEFAULT_RT`, with `act.markTourSeen(id)` writing it and
calling `save()`. Identical in shape to `RT.lastLockSeen` / `RT.keepRecordSeen`.
Cleared by `_wipeUserScopedState` on account switch, which is correct — a
different person on the same device should get their own tour.

**Server-side (survives reinstall):** migration `0165_tour_seen.sql` adds

```sql
alter table profiles add column if not exists tour_seen_at timestamptz;
```

written best-effort on completion (`update profiles … .eq('id', RT.userId)`,
errors swallowed) and read during session sync into `RT.tourSeen['tour:' + role]`
if the local map has no entry. This is the `plan_style_preference` /
`notifications_opt_out` pattern, and it means a user who reinstalls after six
months is not tutorialized again.

The server column covers **only the main tour.** Contextual tips (§6) stay
device-local — a repeated one-line tip on a new device is a shrug, not a bug, and
it is not worth a column each.

---

## 6. Contextual tips

The same engine, one step, no counter. The first time a user opens a major screen
the main tour never covered — Progress, Insights, Messages — a single spotlight
explains that screen in one sentence and dismisses on any tap.

Each has its own device-local flag in `RT.tourSeen` under a `tip:` prefix, so the
main tour and the tips share one map and one marking function. Tips are
suppressed entirely while the main tour has never been completed, so a brand new
user is never spotlighted twice in one session.

Scope for the first build: **Progress only.** The rest land once we can see
whether the first one helps.

---

## 7. Replay

A `.lrow` in Settings under a new "Help" eyebrow:

```html
<div class="lrow" id="set-tour" role="button" style="cursor:pointer">
  <div class="lic">…</div>
  <div class="lm"><div class="lt">Replay app tour</div>
    <div class="ls">A quick walk through the app</div></div>
</div>
```

Wired in `settings.mount()`, after `wireToggles(root)`. It routes to the current
role's landing screen and starts the tour with the seen-check bypassed. Note the
existing warning in `settings.js` about chip handlers calling `stopPropagation()`
— this row needs its own listener, not a delegate.

---

## 8. Accessibility and motion

- `role="dialog" aria-modal="true"` on the card, labelled by the step title.
- Focus moves to **Next** on each step; **Escape** skips the whole tour; focus is
  restored to whatever held it before the tour opened. Nothing in this codebase
  currently traps focus or locks body scroll — the tour adds both, because unlike
  the image viewer it sits over a scrollable screen it is actively pointing at.
- Backdrop click advances; the Skip button is always reachable and never the
  focus target by default.
- `prefers-reduced-motion: reduce` gets a CSS block that removes the cutout
  transition and the card's entrance, matching `css/flows.css:80-82`. The tour
  still runs; it just cuts between steps instead of sliding.
- Reduced motion also skips the 600 ms settle delay, since there is no entrance
  animation to wait out.
- Every interpolated string goes through `esc()` — `npm run lint:xss` enforces it.

---

## 9. Testing

`js/tour-plan.test.mjs`, plain `node:test`, next to the source. The predicate is
the spec:

- each role returns its expected step keys, in order
- `hasCoach: false` drops the coach-seen step; `hasStandards: false` drops standards
- every `goal` value from both onboarding flows (`gain`, `lose`, `maintain`,
  `performance`, `build`, `health`) produces copy, and an unknown or missing goal
  falls back cleanly
- a seen flag returns zero steps
- a non-landing route returns zero steps
- an unknown or null role returns zero steps
- trainer and coach return the same anchors under different ids

`js/tour.test.mjs` covers the driver's pure helpers only — card placement math
(below / flipped above / clamped) and the anchor-filter function, both of which
take rects as plain objects and return plain objects. The overlay itself has no
DOM test; it gets QA through the existing proto render harness.

Run: `npm run test:proto`. Full gate: `npm run verify`.

---

## 10. Build order

1. `tour-plan.js` + its test — no UI, fully verifiable.
2. `data-tour` attributes across the five screen files — inert on their own.
3. `tour.js` + CSS — the athlete tour end to end.
4. Coach / trainer / parent step lists.
5. `RT.tourSeen` + `act.markTourSeen` + migration 0165 + session-sync read-back.
6. Settings replay row.
7. Progress contextual tip.

Steps 1–3 are the vertical slice worth reviewing before the rest is written.

---

## Open questions

None blocking. Final copy needs a voice pass before ship, and the Progress tip's
sentence should be written after the tour's own copy settles so the two do not
repeat each other.
