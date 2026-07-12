# T2 — Log Meal Gallery + Live-Capture Integrity (Gated Spec)

Branch: `fable5/2026-07-12-founder-worklist` · Date: 2026-07-12 · Author: Fable 5 Design+Plan (Opus)

## What ships in this ticket (NOT gated — build now)
Frontend-only, presentation-only:
1. **Gallery picker works.** A second hidden `<input type="file" accept="image/*">` with **no `capture`
   attribute** (so mobile opens the photo library, not the camera). The Gallery tile in
   `camera.js` opens it; the picked image runs the exact same downscale → `act.captureMeal` →
   `#analyzing` flow the shutter uses.
2. **Non-live flag on the meal object.** `captureMeal(...)` gains a `live` arg. Shutter path =
   `live:true`; Gallery path = `live:false`. Stored on `MEAL.live` and persisted into
   `DAY.slotMacros[slot].live` via the existing `dayLogMeal` meta whitelist (rides the existing
   `checkin.slotMacros` jsonb — no migration, no new column, no backend code change).
3. **Honest NON-LIVE badge + integrity messaging** that travels through analyzing → pre-log
   analysis → meal thread, using the shared amber `.status-pill.a` component (`components.js`
   `nonLiveBadge()`), plus the copy: *"Live capture only for scored meals. Gallery photos are
   flagged non-live."*

Nothing in this ticket changes the score math (`day.js` `computeScore` reads only `.protein`),
withholds points, or fires a different analytics `source` (the `MEAL_LOGGED` `track()` call is
left untouched — analytics is out of scope).

## What is GATED (do NOT build without founder approval)
The **enforcement rule** — i.e. whether a non-live meal is *scored* — and any **reused-image
detection**. Both likely require model/backend work and a product-integrity decision. The badge
above is honest *disclosure*; it does not yet *enforce* anything. This section is the proposal the
founder approves before any enforcement is built.

### Proposed enforcement rule (pick one)
- **Option A — Block scoring entirely for non-live (recommended default).**
  A gallery/non-live meal is logged and reviewable by the coach, its macros are shown, but it
  contributes **0 to the Nutrition component / OnStandard Score and does not extend the streak**.
  UI already primes this with "Live capture only for scored meals." Cleanest integrity story;
  removes all incentive to farm points from a camera roll. Cost: an honest athlete who legitimately
  shot a photo a minute ago in the system camera but hit Gallery gets no credit.
- **Option B — Allow only if verified fresh.** Score the meal *only* when the image passes a
  freshness check (see detection below): capture timestamp within N minutes of submission AND not a
  prior submission. Fairer to honest edge cases, but only as trustworthy as the detection, and EXIF
  is trivially strippable/spoofable, so this leans on server-side signals.

Recommendation: ship **Option A** as the enforcement default the moment enforcement is greenlit
(it needs no detection stack and is the honest floor), and treat Option B as a later upgrade once a
trustworthy freshness signal exists.

### Detection method(s) — all require founder sign-off (backend/model work)
1. **EXIF `DateTimeOriginal` freshness** — read capture time client-side pre-upload; flag if missing
   or older than N minutes. Weak alone: EXIF is often stripped by the OS picker and is spoofable.
2. **Perceptual image hash (pHash/dHash) reuse check** — hash server-side, compare against this
   athlete's prior submissions (and optionally team-wide) to catch re-uploads of the same plate.
   Requires a hash column + index and a compare on insert. Backend + migration = gated.
3. **Server capture-token** — only the in-app live camera path mints a short-lived signed token that
   the analyze/insert endpoints require for "scored-live" status; gallery uploads never get one.
   Strongest anti-farming signal, but is real backend/auth work (token issuance + verification).
4. **AI liveness/authenticity signal from `analyze-meal`** — model returns a confidence that the
   image is a genuine fresh food photo (not a screenshot/stock/prior). Model work; probabilistic.

None of 1–4 are built here. The shipped flag is the presentation hook they would later read from.

## Founder decision needed
1. Approve enforcement? If yes, **Option A or B**?
2. If B (or anti-farming for A), which detection method(s) — and are we authorizing the backend
   migration (pHash column / capture-token verification) and any model change?

Until this is approved, non-live meals keep flowing through scoring unchanged; only the honest
badge + copy set expectations.
