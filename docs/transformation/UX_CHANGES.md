# UX Changes

Every change below was verified in a real browser via `scripts/qc-capture.mjs`, not inferred from
source. Screenshots: `qc/transformation/` (baseline), `qc/light-baseline/`, `qc/light-after/`,
`qc/dark-after/`, `qc/parent-after/`.

## Shipped

### The AI meal analysis no longer renders its labels as loading skeletons

`.sk` is the skeleton-shimmer primitive. `.ai-sum .sk` reused the same two-letter class for a
section label and never reset `background`/`animation`, so **"What went well", "Biggest
opportunity" and "Next time" each rendered with an infinite shimmer gradient behind them** — on
the screen that carries the core value moment. An athlete reading their AI analysis saw three
labels that looked permanently stuck loading.

Confirmed via `getComputedStyle` before the fix: `animationName: sk-sheen`, iteration count
`infinite`. Renamed to `.ai-k`.

### "Already have an account?Sign in"

Missing space on the **first screen of the app**. `.wel-signin` is `display:flex`, and flex
discards the whitespace between a text node and `<b>Sign in</b>`. Added `gap: 0.32em` so it scales
with font size rather than restructuring the markup.

### `#meal-questions` no longer crashes

`render()` bails to `#camera` when there is nothing to ask, but the router calls `mount()`
unconditionally — so `querySelector('#mq-go')` returned null and threw, leaving a dead screen on
any stale or deep-linked entry. This sits on the clarifying-questions step of meal logging, the
most important flow in the product.

### Roll-call rows open the commitment, not Home

`location.hash = '#/roll-call/<id>'` had a leading slash; the router parses with `split('/')`, so
the route name came out empty and fell back to Home. Tapping a commitment did nothing visible.

### Parents no longer get the athlete tab bar

Opening *Fund a plan* or *Funded plans* handed a parent five tabs — Home, Plan, Camera, Progress,
Profile — to places a parent has no account for. Fixed at the router: a nav-less screen now renders
in the signed-in role's chrome, and a role with no tabs renders **no** tab bar.

### Every role can reach account deletion

`delete-account` resolved to the athlete shell, so the mirror guard bounced coaches and trainers
back to their root and `navAdmits` refused parents. **Three of four roles could not delete their
account from the UI.** A data-rights problem, not a cosmetic one.

### Keyboard users can see where they are

4 focus rules covered 82 interactive affordances; 9 rules removed outlines; `.composer input` had
no focus indication at all. A dedicated focus layer now covers links, buttons, chips, tiles, tabs,
rows, cards and every text field. Verified: all 9 previously-suppressed fields compute a 2px ring.

### Light mode is legible where it was measured

The coach's **"Critical" status label measured 2.02:1** — effectively invisible on white, on both
coach and trainer home. Also fixed: the water-log buttons (4.1:1) and the paywall "Save 30%" badge
(3.77:1). Light-mode contrast failures went **5 to 0**.

## Observed but not changed, and why

**Athlete Home states the same fact three times.** "4 requirements remaining today", "0 of 4 done"
and "4 to go — your day is still open" all appear above the fold. The score ring — the product's
signature — renders as a small "0" on a dashed circle while an amber CTA card dominates the
screen. Fixing this well means redesigning the screen against the new type scale, which is the
next piece of work, not a copy tweak.

**59 touch targets are under 44px**, including a 20px-tall date filter and a 19px-tall "View full
analysis". These need a shared tap-floor utility, not 59 patches — see KNOWN_RISKS #5.

**`monthly-report` renders "Building your report…" forever** when its fetch never resolves. Needs
a timeout, an error state and a retry.

**107 routes**, with three hard orphans (`safety`, `states`, `copilot`) and two dead entries
(`legacy-role`, `meal-confirm`). Removal is safe but is product surgery worth doing deliberately.
