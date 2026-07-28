# Product screenshot set — what each image is, and which section consumes it

**Regenerate:**
```bash
node scripts/serve-proto.mjs 8799          # shell 1
node web/landing-src/shoot-proto.mjs       # shell 2  (or pass a filter: "style-,coach-")
```

Output: `web/landing/assets/product/*.webp` — 1170×2532 (390×844 @3x), webp, 35–112 kB each.

## How these are made (and why you can trust the numbers in them)

No Playwright package is installed in this repo, so `lib/cdp.mjs` drives the Playwright-managed
Chromium binary directly over the DevTools Protocol using Node 24's built-in `WebSocket`. **No new
dependency, no build step.**

Every screen is the **real proto**, served by the existing `scripts/serve-proto.mjs`, rendered by
the real engines. The harness seeds **evidence only** — logged meals with real macros, check-in
answers, roster rows — and then the app computes everything on screen itself:

- `lib/seeds.mjs` mutates the live `DAY` / `RT` module instances (the proto serves native ES
  modules, so `import('/js/day.js')` from the page returns the same instance the app is using).
- `lib/sb-stub.mjs` answers the same RPCs and table reads `roles.js` makes, with fixture rows
  shaped to the real contracts, so operator/parent screens render populated instead of empty.

So the `94` on the roster is `buildRosterRow` reading a seeded day row; the `41` on the morning
Home is `day.js` scoring two logged meals; the `99%` on Accountability is `commitments.js`
weighting ack/arrive/complete and dropping an unverified morning from the denominator. **Nothing
in these images is drawn by the screenshot script.**

A frozen clock per shot (`at: [h, m]`) keeps greetings, countdowns and the "now" ladder internally
consistent and the set reproducible.

---

## The athlete's daily loop — `index.html` "How it works", `athletes.html` "A day on the standard"

| Image | Step it illustrates | What's real in it |
|---|---|---|
| `loop-1-home-morning.webp` | **1. Open the app.** One thing to do next. | Score 41, "1 of 4 done", breakfast logged 8:25, Recovery Check-In as the NOW card with a live countdown |
| `loop-2-camera.webp` | **2. Point the camera at the plate.** | The real capture screen + the camera-permission rationale copy |
| `loop-3-meal-read.webp` | **3. The AI reads it.** | The logged lunch: foods, macros, meal quality 84/100, "on time" |
| `loop-4-home-midday.webp` | **4. The score moves.** | Score recomputed with two meals in, dinner still open |
| `loop-5-checkin.webp` | **5. The nightly check-in.** | The real 1–5 scales — energy, recovery, sleep, confidence |
| `loop-6-commitment.webp` | **6. Close the day honestly.** | The three answers with their true point values, derived from the athlete's own profile |
| `loop-7-home-complete.webp` | **7. The day lands.** | Complete day, all four slots on time, streak, "locks at midnight" |
| `loop-8-breakdown.webp` | **8. Why the score is that number.** | Component-by-component breakdown |

## Honest states — the skeptic questions the brief requires answering

| Image | Question it answers | Section |
|---|---|---|
| `state-late-dinner.webp` | *"What if I'm late?"* — score 67, "1 requirement remaining", late still logged | index + athletes |
| `state-first-day.webp` | *"What happens on day one?"* — **"Not scored yet"**, closed windows read "Not required" | index + athletes |
| `state-progress.webp` | *"What do I actually get out of it?"* — weekly average, streak, trend | athletes |
| `state-plan.webp` | *"What am I held to?"* — "Targets set by your coach" | athletes, trainers |
| `state-privacy.webp` | *"Who sees what?"* — the in-app privacy ledger | athletes, parents ⚠ see note |
| `state-connect.webp` | *"What happens when I join?"* — the confirm step naming what the coach will see | athletes, coaches |
| `state-trust-pass.webp` | *"Can I ever stop photographing?"* — "Earn it with 7 on-standard days" | athletes, coaches |
| `state-training-log.webp` | Training log — **tracked, not scored** | athletes, trainers |

⚠ **`state-privacy.webp` contains the "Teammates · Score only" row**, which describes a leaderboard
that has no backend (`state.js:3141`). Do **not** crop the site's privacy claims around it. Use
`state-connect.webp` as the primary privacy proof instead. Flagged for the founder as an in-app
copy bug, alongside the parent screen's "Scores & streaks" header.

## Plan styles — `dietitians.html` (primary), `athletes.html`, `trainers.html`

Same complete day, same athlete, three assignments. The difference is real and visible:

| Image | What the screen says |
|---|---|
| `style-structured.webp` | "Exact calorie, protein, meal-timing and hydration targets. Your score leans on completing them." |
| `style-guided.webp` | "Flexible ranges instead of exact numbers, plus meal quality and light hunger and energy awareness." |
| `style-intuitive.webp` | "No calorie or macro targets. Your score measures awareness of hunger, fullness and energy, fueling enough, hydration and consistency — never restriction." |

Each also shows "Set by your James Brooks" — the disclosure of *who* chose it.

## Verified Commitments — `coaches.html` (primary), `athletes.html`

| Image | What it shows |
|---|---|
| `vc-1-rollcall.webp` | The athlete's Home at 5:05 AM: **"MORNING ROLL CALL · RESPOND BY 5:15 AM"**, the coach's own title **"5 AM Club"**, one button: **"I'm Up"**. The athlete never sees the word "commitment". |
| `vc-2-accountability.webp` | Morning Readiness: **99%**, the three signals broken out, and the weighting explained. One unverified morning sits outside the denominator. |
| `vc-3-record.webp` | Verified Discipline — the record an athlete can choose to show |

## Coach — `coaches.html`

| Image | Step |
|---|---|
| `coach-1-home.webp` | Open the app: group score 81, "3 on standard · 1 need attention · 2 overdue", ranked priorities |
| `coach-2-roster.webp` | The roster: 94/88/86 on standard, 71 below standard, 64 overdue, and **"—" for the athlete with no logs** |
| `coach-3-inbox.webp` | The daily briefing, computed: *"1 not logged yet — Tommy. 2 below the bar today. Marcus Reed leads the day at 94."* |
| `coach-4-insights.webp` | Insights, with the silence-over-noise rule visible |
| `coach-5-create.webp` | Assign / announce / message / set standards / schedule |
| `coach-6-announce.webp` | One broadcast → every active athlete, fanned out server-side |

## Trainer — `trainers.html`

| Image | Step |
|---|---|
| `trainer-1-book.webp` | The whole book before the first session — client names, not a football roster |
| `trainer-2-home.webp` | Who executed, who slipped, who needs a word today |
| `trainer-3-grow.webp` | Public page, offers, applications — the OnStandard Pay surface |

## Parent — `parents.html`

| Image | Step |
|---|---|
| `parent-1-dashboard.webp` | Marcus Reed · latest day · **94 · A** — and the explicit "what you can see" scope box |
| `parent-2-fund.webp` | Fund a plan — the parent-funded package path |

---

## Not captured, and why

- **`coach-commitments` (the coach's roll-call board).** The screen hangs under the harness: it
  guards its fetch on `Date.now()` freshness, and the deterministic frozen clock makes that guard
  read as permanently fresh. Fixing it means unfreezing the clock for that one shot, which breaks
  the internal consistency the rest of the set depends on. **Coaches.html therefore explains the
  coach side of Verified Commitments in copy, using `vc-1`/`vc-2` (the athlete side) and
  `coach-5-create` (where a coach schedules one) — it does not claim a board screenshot.**
- **`monthly-report` / Deep Dive.** Both call live edge functions; the fixture returns an honest
  error. Premium reports are described in copy without a screenshot.
- **A live camera viewfinder.** Headless Chromium has no camera; `loop-2-camera.webp` is the real
  capture screen in its permission state.

## Still present but no longer referenced

`v3-*.webp` (6) and `shot-*.webp` (8) are the previous set. They predate plan styles, Verified
Commitments, OB2, the training log and the operator unification. **Phase 4 stops referencing
them; they are left on disk pending founder sign-off to delete** (deleting existing assets is a
stop condition).
