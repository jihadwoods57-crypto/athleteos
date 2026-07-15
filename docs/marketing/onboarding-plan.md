# OnStandard — Onboarding & Activation Plan

*Owner: activation/CRO · Last updated 2026-07-15 · Source of truth: `.agents/product-marketing.md`, framework: `.claude/skills/onboarding/SKILL.md`*

Scope: the shipped WebView prototype at `proto/redesign-2026-07/`. All paths below are repo-relative and real. This plan maps the actual first-run flow, defines activation per persona, ranks friction, and prescribes fixes tied to specific screens, with final microcopy in brand voice.

---

## 1. Current-State Map

Entry for everyone is the welcome screen `proto/redesign-2026-07/js/screens/auth.js` → **Get Started** → role picker `role` in `proto/redesign-2026-07/js/screens/roles.js` (four cards: Athlete, Client, Coach, Trainer; parents excluded by design). Routing is hash-based via `js/router.js`; onboarding state is captured step-by-step into `RT.ob` and only written to an account at the final account step (`act.persistOnboarding` / `persistCoachOnboarding` in `js/state.js`).

### (a) Athlete — `js/screens/onboarding.js` (7 steps)
1. **Welcome** (`auth.js`) → Get Started.
2. **Role picker** (`roles.js` → `role`) → Athlete.
3. **Step 1 — Identity.** First/last name + DOB. Hard COPPA gate: under-13 routes to `onboarding/blocked` and their identity is never persisted (`onboarding.js` lines 251-268).
4. **Step 2 — Belonging.** School search → coach → **coach code** (the "handshake"), via `js/ob-directory.js`. Has a **Skip for now** link.
5. **Step 3 — Sport / position / level** (chips).
6. **Step 4 — Goal** (gain / lose / maintain / perform) — drives nutrition scoring.
7. **Step 5 — Baseline.** Current/target weight + allergies. Contradiction warning if target fights goal (`onboarding.js` lines 383-398).
8. **Step 6 — The Standard + the contract.** Shows the derived standard, meals/day + reminder-pressure knobs, and a **hold-to-commit** button (`js/ob-commit.js`) that stamps `committedAt`. Next is disabled until committed.
9. **Step 7 — Create account** (`js/screens/ob-account.js`: email + password, or Apple at go-live).
10. **Post-signup branch** (`onboarding.js` `onSession`): if a live session returns → `act.startDay0()` then `bio-optin` (`js/screens/bio-optin.js`) or straight to `home`. **If no session (email confirmation required) → dead-end message: "Account created — confirm your email, then sign in to start."**
11. **Home, Day 0 empty state** (`js/screens/home.js` lines 156-173): a single gold "**Log First Meal**" card + "No logs yet" activity empty state.
12. **Log First Meal → aha.** Camera permission priming (`js/screens/camera.js` lines 41-52, "Camera, for proof.") → Allow → live viewfinder → shutter → `camera-confirm` ("Use this photo?") → **Analyze** → meal result → the OnStandard Score ("Living Number") moves off zero. Gallery/search/label fallbacks exist; each photo can only be logged once (`js/photo-hash.js`, 0062).

Client flow (`roles.js` → `clientOb`, 6 steps) is the same shape minus team; connects a **trainer** instead of a coach.

### (b) Coach — `js/screens/roles.js` → `coachOb` (5 steps + code screen)
1. Welcome → Get Started → Role picker → Coach.
2. **coach-ob/1 — You, coach.** Name, staff role, "what the room calls you" handle.
3. **coach-ob/2 — Your school** (search or "add it").
4. **coach-ob/3 — Build the team** (name, sport, level, listed-in-search toggle) — or paste a **staff code** to join an existing staff.
5. **coach-ob/4 — Set the team standard** (toggle rows; the four-component score model is fixed).
6. **coach-ob/5 — Create account** → "Create account & Get my code."
7. **Post-signup** (`coachOb.onSession`): live session → `persistCoachOnboarding` → `coach-ob/6`. **No session → "confirm your email, then sign in. Your team and code mint automatically" — dead-end.**
8. **coach-ob/6 — Team code screen.** Shows the real minted code, Copy button, "Open Coach Dashboard." (If code couldn't mint: "Code pending.")
9. **Coach Dashboard / Inbox** (`js/screens/coach.js`): roster is **empty** — "No athletes yet. Share your team code…" (lines 135-141, 797, 884-885). Daily briefing reads "No athletes yet. Share your team code and this becomes your morning read."

Trainer flow (`roles.js` → `trainerOb`, 4 steps + client-code screen) mirrors coach.

---

## 2. The Aha Moment & Time-to-Value

| Persona | Activation event (aha) | Steps to reach it today | In-session? |
|---|---|---|---|
| **Athlete** | First **photo-verified meal logged → OnStandard Score moves off zero** (the Living Number starts). Correlates with the daily loop: log→number→coach→streak. | ~9 onboarding screens + account + camera-priming + capture + confirm + analyze ≈ **12-15 taps across 2 permission gates** (account, then camera). | Yes — reachable in first session **if** email is auto-confirmed. |
| **Coach (buyer)** | True aha = **first athlete's live score lands on the roster.** In-session proxy aha = **team created + code minted + shared.** | Code minted at ~7 screens. But the real payoff (a populated roster) **cannot happen in the first session** — it depends on athletes joining and logging asynchronously. | **No** — structurally deferred. First session ends on an empty roster. |
| **Client** | Same as athlete (first meal → score). | ~8 screens + account + camera. | Yes (if auto-confirmed). |
| **Trainer** | Same as coach (code minted/shared; real aha = first client score). | ~6 screens. | No — deferred. |

**Key structural truth:** the athlete's aha is a real in-session event; the coach's (the paying buyer's) is not. The coach's first session must be engineered to *feel* like activation (code shared, expectation set) rather than ending on a blank roster.

---

## 3. Friction Audit (ranked by impact)

1. **Email-confirmation dead-end kills the aha for both personas (highest).** After 7 full steps and a hold-to-commit ritual, an unconfirmed athlete is told to leave the app, find an email, and sign back in — the first meal log (the entire point) never happens in that session. Same for the coach's code. This is the single biggest activation leak: maximum invested effort meets a hard stop right before value. (`onboarding.js` `onSession` false-branch; `coachOb`/`trainerOb` same.) Whether it fires depends on the Supabase "confirm email" setting on live prod — **verify this first; if on, it's the #1 fix.**

2. **Coach first session ends empty; no in-session value and no expectation-setting.** The buyer finishes onboarding and lands on "No athletes yet" (`coach.js` lines 138-139, 797). There's no sample/preview of what a live roster looks like, no strong "invite your first athlete now" moment, and nothing that tells them *when* scores will appear. High drop risk for the persona that pays.

3. **Athlete config is fully front-loaded before any value.** Weight, target, allergies, meals/day, reminder pressure are all collected (steps 5-6) *before* the athlete has seen a single score. This is guided-setup friction ahead of value — against the skill's "Time-to-Value is everything" and "one goal per session" principles.

4. **Camera is a second permission gate at the exact aha moment.** Even after a clean account, the athlete hits camera priming (`camera.js`) before the first log. Priming copy is good and a "Log without a camera" fallback exists, but it's a second yes/no right where value should land.

5. **"Skip for now" on coach connection (step 2) lets athletes log into a void.** The witness (coach/trainer) is the product's whole premise ("accountability needs a witness"). An athlete who skips has no one seeing their proof; the coach never sees them. Skipping is too frictionless for the highest-leverage step.

6. **No push-notification opt-in anywhere in the athlete flow.** The daily loop (streak-before-midnight, coach nudges, meal reminders) depends on push, but the only post-signup opt-in is Face ID (`bio-optin.js`). Notifications are surfaced only later inside `notifications.js` settings. A core retention driver is never requested at the one moment intent is highest.

7. **Hold-to-commit gates progress (step 6).** A nice ritual and on-brand, but a novel interaction that blocks Next; if the gesture isn't obvious it can stall the athlete one screen from the account.

---

## 4. Recommendations

### Quick Wins
- **Fix the email dead-end (screen: `ob-account.js` / `onboarding.js` `onSession`).** If confirmation must stay on, don't dump the user out — keep them in-app and let them **log their first meal locally now** (the app already supports local-first logging; see `home.js syncBanner` "Saved on your phone, counts locally"). Show a slim "confirm your email to sync to your coach" banner instead of a blocking terminal state. Best case: turn confirmation off for launch so `r.session` returns and `startDay0()` runs immediately.
- **Reframe the coach code screen as the activation moment (screen: `coach-ob/6` in `roles.js`).** Add a one-tap **native Share** next to Copy, plus a "what happens next" line so the empty dashboard is expected, not a surprise. (Copy below.)
- **Add a real empty-state CTA hierarchy on the coach dashboard (screen: `coach.js` lines 135-141).** Keep "No athletes yet" but make **Share code** the primary button (it currently sits secondary to the raw code), and add a single "See a sample roster" preview toggle so the buyer sees the payoff before anyone joins.
- **Make athlete step 2 skip cost something honest (screen: `onboarding.js` step 2).** Replace bare "Skip for now" with a confirming line that states the tradeoff (copy below) — friction proportional to the decision's importance.

### High-Impact
- **Insert a push opt-in after first log, not before (new micro-screen after `camera-confirm` → meal result, sibling of `bio-optin.js`).** Prime it in the daily-loop language: reminders before midnight + when your coach responds. Ask *after* the athlete has felt the score move, when intent is peak.
- **Add a 3-item onboarding checklist to Home Day 0 (screen: `home.js` Day-0 block, lines 156-173).** Per the skill's checklist pattern (3-7 items, value-ordered, dismissible, progress %): (1) Log your first meal, (2) Connect your coach [if skipped], (3) Set your first recovery check-in. Celebrate completion → this becomes the athlete's guided first-session outcome.
- **Shorten the athlete pre-value path.** Move weight/allergies/meals-per-day (steps 5-6 detail) to a **post-first-log "finish your standard" step**. Get the athlete to name → goal → commit → account → **log** faster; collect the rest once they've seen the number. (Test-gated — see below.)
- **Coach: seed a pending-invite/expectation card.** After code share, show "You'll see [X]'s score the moment they log" so the deferred aha has a visible placeholder rather than emptiness.

### Test Ideas (A/B)
- **Email confirmation ON vs. OFF** at signup → measure % reaching first meal log in session (expected the largest single lift).
- **Config-before-value (7 steps) vs. lean path** (name→goal→commit→account→log, rest deferred) → time-to-first-log and Day-1 retention.
- **Coach code screen: Copy-only vs. Copy+Share+expectation-line** → % of coaches who share the code in session (leading indicator of the whole B2B2C loop).
- **Push opt-in before first log vs. after** → opt-in rate and Day-7 return.
- **Onboarding checklist on Home vs. single "Log First Meal" card** → first-session completion of ≥2 actions.

### Empty-state & first-session guidance
- Athlete Day-0 (`home.js`) and coach roster (`coach.js`) empty states are already honest and on-brand (never fabricate numbers) — keep that. Upgrade them from *dead ends* to *onboarding surfaces*: each needs one obvious primary action and a "what it'll look like with data" preview (skill: "Empty states are onboarding opportunities").

---

## 5. Copy (top 3 highest-impact screens, brand voice)

Voice check: direct, earned, plain-spoken coach voice; short declaratives; words to use — *prove, proof, receipts, standard, on standard, the other 167*; words to avoid — *feed, badges, gamification, surveillance*.

### A. Email-confirmation state — turn a dead-end into a soft gate (`onboarding.js` athlete `onSession`, no-session branch)
- **Current:** "Account created — confirm your email, then sign in to start."
- **New (headline):** Your Standard is saved. Log your first meal now.
- **New (body):** Confirm your email to sync your proof to your coach — but don't wait. Log now; everything you do counts on this phone and syncs the moment you confirm.
- **Button:** Log First Meal
- **Secondary link:** Resend confirmation email

### B. Coach code screen — the activation moment (`roles.js` `coachSteps[6]`)
- **Headline:** Your code is live. Send it.
- **Body:** This code is the handshake. Drop it in the group chat — the moment an athlete joins and logs, their score lands on your board. Nothing's invented until they do.
- **Primary button:** Share code
- **Secondary:** Copy code
- **Expectation line (below buttons):** Your roster's empty until they join. That's honest — no fake numbers. Share the code and check back.
- **CTA to dashboard:** Open my board

### C. Athlete Day-0 Home — first-log card + skipped-coach nudge (`home.js` Day-0 block)
- **Card eyebrow:** START HERE
- **Card title:** Log your first meal
- **Card body:** Your score starts at zero and moves the second you log. Photo proof — Nutrition is 50% of the number. **(keep existing)**
- **Button:** Log First Meal **(keep)**
- **If coach was skipped (new one-line row):** No coach connected yet. Your proof only counts to someone if they're watching. → Connect a coach

### D. Athlete step-2 skip — make the tradeoff honest (`onboarding.js` step 2 skip link)
- **Replace "Skip for now" with:** I'll connect my coach later
- **Confirm line on tap:** You can log without a coach, but no one sees your proof until you connect one. That's the whole point. Add the code now?  [Add code] · [Later]

---

*All recommendations map to existing screens; none require new score-model surface (the four-component fixed formula stays untouched). Sequence: (1) resolve email confirmation, (2) coach code-share + expectation, (3) push opt-in after first log, (4) test the lean athlete path.*
