# UI/UX cohesion pass — 2026-09-22

Target: the shipped proto (`proto/redesign-2026-07/`). Judged against PRODUCT.md + DESIGN.md
(dark-first, Athlete Blue = action, one meaning per hue, Archivo for scores only).

Seed: `.impeccable/critique/2026-09-22T17-41-34Z__proto-redesign-2026-07-index-html.md` (31/40).
Then five area audits (athlete loop, meals/plan, progress/settings, coach, parent/trainer/
onboarding), each on real renders. Every item below was checked in source or a render.

Baseline renders: `qc/base/` (320 screens: every registered route, dark + light, 390w, FULL
page). After renders: `qc/after/`.

Legend: [ ] open · [x] done · [~] deliberately not done (reason)

## 0. Harness (so the audit sees what users see)

- [x] `--full` captured only one viewport (the app scrolls inside `.viewport`); now grows the
      window to the scroller's height.
- [x] `--port` / `--shard i/n` so four captures run in parallel (~4x faster).
- [x] Stub `commitment_board` returned one roll-call instance per athlete (wrong shape vs
      migration 0216): every operator Home showed 4 to 6 identical "5 AM Club" cards.
- [x] `camera` shot captured the one-time primer, never the viewfinder; `meal-analysis`
      captured zeros; `meal-questions` bounced to the camera. All three now reach their screen
      (`pre` hook in qc-capture.mjs).

## 1. System level (lead)

- [x] P0 One score, one colour ladder: `scoreColor` now = tier colour (80-89 blue under a blue
      "Locked In" header, not green). `BAND_COLOR` removed.
- [x] Red means missed: `below_standard` amber; `statusColor` / `statusLabel` helpers so the
      dot, number and band header on one row agree, and a 71 reads "Building".
- [x] Amber is warning only: an item merely due later today is neutral (was amber from 7 AM).
- [x] FAB dot only when something is closing/late (amber) or missed (red).
- [x] Sticky action bar double-counted the tab-bar clearance (parked ~150px high, over the
      recovery check-in's last question). Verified the sticky/padding rule in WebKit + Chromium.
- [x] Light theme: tab-bar capsule tinted lavender by the recovery card scrolling under it.
- [x] Trainer "Clients" tab used a heart; now the same people glyph as the coach Roster.
- [~] Tier named "OnStandard" (90+) vs status "on standard" (80+): naming collision. Founder.

## 2. Athlete daily loop

- [x] Home: NOW button hidden behind the FAB/tab bar at 390x844 in morning/midday/late/
      roster-ended; two status lines under the ring; "Next:" repeats the NOW card.
- [x] NOW tile painted amber on green/purple cards (CSS source-order bug); same in log sheet.
- [x] Recovery: hide tabs on the 20-second form; re-measure the sticky bar.
- [x] Score-family screens (breakdown/streak/roll-call record/trust): one hero treatment,
      neutral streak flame, remove repeated counts and stacked explainers.
- [x] Roll-call record told athletes the roll call does not move the score (it does, 8 pts).
- [x] Log sheet icon stretched by sign-in's `.si`; commitment cards had no padding; past-day
      rails flush to the screen edge; Trust Pass shield purple; empty group header.

## 3. Meals, AI nutritionist, Plan

- [x] Tap targets: meal-thread participants button + composer (42px), food search (40px).
- [x] Meal dial: 8.5-10px label crowding the arc, (i) over the arc and dead on Intuitive.
- [x] Nutrition chat shows the tab bar under the composer; disclaimer styled as a card.
- [x] Meal-analysis (confirm screen): four boxed tiles, boxed AI note, boxed green hint.
- [x] Past meal still on the pre-09-15 green confirm card; card inside card in Detected foods.
- [x] Food search: no plate tally, Log button not sticky, plate below the fold.
- [x] Camera primer has no side gutter. Plan tabs cut off at 390. "0g protein left".
- [~] Plan "600 calories left": budgeting language vs PRODUCT.md red line. Founder.

## 4. Progress, profile, settings, paywall

- [x] Day 0 Profile said "Off Standard" in red before anything was logged.
- [x] Discipline record said "Verified" with no data; duplicated Verified Profile.
- [x] Privacy said "nothing is public" while Verified Profile publishes a page.
- [x] Profile/Settings: duplicate doors (edit x2, privacy x2, delete x3, plan style, Apple
      Health); one-row cards; Done buttons that repeat Back.
- [x] Progress bars on a third ladder (45 was Locked-In blue); week average not the score font.
- [x] Paywall: selected plan in success-green with glow; web branch "Memberships open at
      launch"; purchase button alone in a card. Monthly report "No card today" copy.
- [x] Notifications: amber "High" pills, Tone as chips not a segmented control.
- [~] Individual plan description vs "your stats are always free". Founder.

## 5. Coach, trainer, dietitian, parent

- [x] Coach Home: first athlete name at 1711px; praise card first; legend counts not tappable.
- [x] Priority card "Due soon" pill beside "Lunch overdue".
- [x] Athlete detail: breakdown contradicts the ring; 4 action buttons + 6 tabs, 2 hidden.
- [x] Inbox rows are dead ends; no caught-up state; "Athletes 12" counts threads not people.
- [x] Announce: irreversible armed send looks like any button.
- [x] Roster: selected filter chip weaker than unselected; select checkbox green.
- [x] Headers / row shapes / section labels differ across coach tabs.
- [x] Dietitian: meal reviews buried (4th chip, off screen).
- [x] Parent: one card with a letter grade no other screen uses, no staleness cue, while
      onboarding promised score + streak + weekly view.
- [~] Parent onboarding still promises a weekly digest, milestone pushes and missed-day alerts;
      none exist on the server (guardian escalation step not built; digest choice saved nowhere).
      Founder: build them or cut the promise.

## 6. Onboarding + auth

- [x] Answers vertically centred ~330px below their question.
- [x] Two different primary buttons (welcome/sign-in blue-teal sweep vs app blue).
- [x] Four back controls; `.ob-back` is a div. Label drift (Next/Continue/Show me).
- [x] Role icons use status hues as identity.
- [~] 19 to 27 steps per flow; three narrative slides before the first question. Founder.
- [~] Legacy onboarding routes still registered (kept for rollback). Founder.

## 7. Consistency pass (after the area work)

- [x] Headers · buttons · radius · pills · icons · status colour · empty/loading/error states

## 8. Verification

- [x] `npm run verify` green: all 18 gates.
- [x] After renders (`qc/after/`, 320 screens): 0 defects, down from 42 small tap targets,
      2 clipped labels and 2 failed renders in `qc/base/`. Nothing new introduced.
- [x] Visual inspection of every changed screen, dark + light (area agents + lead).
- [x] Self-review of the diff + two independent code reviews (coach side, athlete side): no
      high-confidence bugs. Hardened one pre-existing unescaped coach title (requirement.js).
- [x] Zip rebuilt (version c77e10110cef65fc) and content-verified.
- [x] OTA published (founder request): update group 2e66c9a0; iOS + Android live manifests carry zip md5 db6d11c3.

## Also changed on the way

- Profile stat tiles flattened to one strip; recent-result captions sentence case; three
  sub-scale font sizes (7px, 8.5px) snapped to `--t-micro`; NOW card drops a pill that restated
  its own countdown; coach praise card blue (was recovery purple); week bars on the tier ladder.
- Parent onboarding / invite copy no longer promises a streak or weekly grade the parent view
  does not show; Family plan blurb no longer says "every dashboard".
- Ratchets re-baselined to the new, lower counts (raw font sizes 234 -> 184 in screens.css;
  off-scale spacing 216 -> 200). Boot graph +1 module (week-bars.js extracted from Progress).

# Roll call, rebuilt: 2026-09-23

Spec: `docs/superpowers/specs/2026-09-23-roll-call-rebuilt-design.md`. Branch:
`feat/rollcall-rebuilt`. Shipped on the branch so far (Tasks 1 to 12): the live team board (`rb-`,
athlete + coach), the athlete's day screen after I'm Up, the coach's four-answer setup with an
optional place + arrive-by, the week strip, the closing summary, coach History, arrival check-in
restored from before the 2026-09-09 removal (automatic walk-in on "Always" location, "I'm here"
as the always-available fallback, server-side distance check that never stores coordinates), the
morning-block score split (wake-up + arrival = 4 + 4, either alone = 8), the harness shots for
every board/setup/history state, `docs/go-live/ROLLCALL-DEVICE-TEST.md`, and this DESIGN.md
amendment.

## Owed before this reaches a team

- [ ] **Device test.** Nobody has run `ROLLCALL-DEVICE-TEST.md` on a real phone yet; everything
      native (AlarmKit, Live Activity, region monitoring) is unverified outside the harness.
- [ ] **Prod migration 0242** (the team-visibility RPC, arrival-on-roll-calls columns, the
      morning-block score split, the history RPC) and four function deploys (`roll-call-ack`,
      `roll-call-coach`, `commitment-reminders`, `commitment-escalation`) carrying the Live
      Activity update + closing-summary changes.
- [ ] **A native build.** The push-to-start Live Activity, the I'm Up intent on both the card and
      the alarm, MapKit picker and `expo-maps`, and the restored location bridge all need a build;
      none of it reaches a phone over the air.
- [ ] **App Privacy answers** for Precise Location (now collected again after the 2026-09-09
      removal) and updated review notes explaining "Always" location and the lock-screen card, so
      the resubmission doesn't repeat the App Review questions the removal was avoiding.
