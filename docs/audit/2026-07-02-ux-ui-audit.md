# OnStandard UX/UI Audit — 2026-07-02

> **STATUS 2026-07-03: fully remediated.** All P0s and the entire "what still needs fixing"
> roadmap (Phases 2–5) are implemented, tested (1383 green), and verified live. Commits:
> `99f164b` (P0 truth), `377bf6a` (Phase 2 first-day), `cd3c244` (Phase 3 coach zero-state),
> `af98f0d` (Phase 4 accessibility), `d776022` (Phase 5 polish). Per-issue status is marked
> inline below with ✅. Remaining known gaps: real guardian-age verification (backend/Resend
> pending), the `ALLOWED_ORIGINS` function secret for web builds (config, see supabase/README),
> and Parent/Trainer role views (not walked this pass).

**Method:** Live end-to-end walkthrough of the Expo web build (`:8082`) via Playwright at 390×844 (mobile) and 1440×900 (desktop). Fresh-athlete onboarding (Lose Fat path, age 17), meal logging (all 3 modes), commitment tap, weekly check-in, all 4 athlete tabs + Profile + Notifications + Performance, fresh-coach onboarding (High School Coach) and all 5 coach tabs, sign-in error path, dark mode, programmatic contrast + touch-target + keyboard checks. 50+ screenshots (`ux-01` … `ux-54`, in playsmithai2026 working dir). Parent/Trainer role views were **not** walked this pass (they share the coach chrome; spot-check later).

**Quality bar:** Oura / Linear / Whoop / Stripe, per founder instruction.

---

## 1. Executive summary

**The visual layer is genuinely good. The data-truth layer is broken, and data truth is the entire product promise.**

OnStandard looks premium: a committed design system (Plus Jakarta Sans, Athlete Blue, tinted-slate neutrals, soft layered shadows) applied consistently across ~25 screens, complete dark mode, real empty states, honest score-weight disclosure, and a meal-capture flow that is better-designed than most shipped consumer apps. Nobody would look at a screenshot and say "AI made this." That puts the *cosmetics* at roughly a 7/10 against the Whoop/Oura bar.

But the product's one-sentence promise is *"Is this athlete actually doing what they're supposed to be doing?"* — and on a fresh account the app repeatedly tells the user things that are not true:

- A 17-year-old who chose **Lose Fat** is told to **"Gain 1.0 lb by Sunday — add ~1000 cal/day"**, labeled **"Coach-set"** when no coach exists.
- Onboarding reveals "your starting score is **49**" → Home shows **0, GRADE F** → Profile says "Averaged **49**" → Squad shows a third number. One score, three stories, inside the first five minutes.
- A brand-new coach is handed team code **EAGLES24** with a "Share team code" CTA; the Roster tab later admits it's a **sample** code (and `create_team` 400'd in the background). A coach could text a dead code to 40 kids on day one.
- A day-one account has a shaped score-trend line, notifications timestamped "1h/6h ago" that predate the account, a fabricated "Linebacker · Eastside HS" identity for an athlete who skipped the sport question, and an "83% of days on plan" stat derived from nothing.

For an accountability product whose brand principles literally say *"honest accountability over vanity"* and *"never decorate a bad week,"* these aren't cosmetic bugs — they're brand violations. Fix the truth layer first; the paint is already good.

**Audit health score (impeccable rubric):** Accessibility **2/4** · Performance **3/4** · Responsive **2/4** · Theming **4/4** · Anti-patterns **3/4** → **14/20 (Good — address weak dimensions)**.

**Nielsen heuristics: 24/40.** Weakest: error prevention (1), match with the real world (1 — the gain/lose inversion), consistency (2 — score disagreement). Strongest: aesthetic/minimalist design (4), recognition over recall (3), visibility of status (3).

**Issue counts:** 4 × P0 · 8 × P1 · 16 × P2 · 4 × P3.

---

## 2. Top 10 highest-impact issues

| # | Issue | Screen | Impact | Effort | Priority |
|---|-------|--------|--------|--------|----------|
| 1 | **Lose-Fat athlete told to gain** — "Gain 1.0 lb · ≈500 cal/day surplus · add ~1000 cal/day," chip says "Coach-set" with no coach | Nutrition | Critical — harmful advice to a minor; destroys trust instantly | M | **P0** |
| 2 | **Fake team code presented as real** — EAGLES24 + "Share team code" CTA in onboarding; Roster later admits "SAMPLE… your real one is created when your team goes live" | Coach onboarding / Roster | Critical — coach's first act fails publicly in front of their team | M | **P0** |
| 3 | **One score, three stories** — reveal 49 → Home 0 → Profile "averaged 49" → Squad 35; Marcus demo shows "↓43 this week" with empty history | Everywhere | Critical — the score IS the product; if it can't agree with itself it can't hold anyone accountable | M–L | **P0** |
| 4 | **Error states lie** — food-search network/CORS failure rendered as "No matches — try a simpler name"; edge functions (`food-lookup`, `assist`) lack CORS headers for web origin | Meal Search | High — user retries forever against a dead endpoint; also blocks the entire web channel | S | **P0** |
| 5 | **Fabricated fresh-account data** — shaped trend line day one, pre-account notification timestamps, invented "Linebacker · Eastside HS," "83% of days on plan" | Home, Notifications, Squad, Profile | High — brand promise is honesty; fake data teaches users the numbers are decorative | M | **P1** |
| 6 | **Grade F as first impression** — mid-range honest answers → "49 GRADE F" in red at reveal; Home then opens with 0/F + "You're behind today" + red "Work to do this week" before the user has done anything | Score reveal, Home | High — peak-negative moment at the exact point of activation; churn risk for 13–17s | S–M | **P1** |
| 7 | **Zero-athlete coach logic** — "0% COMPLIANCE" in green, "0 ALERTS" in red, "Everyone is above the line" with 0 athletes, AI summary "trending up: 0 of 0" | Coach dashboard/Attention/Reports | High — coach's first session reads as nonsense; colors bound to category not meaning | S | **P1** |
| 8 | **Consent gate contradiction** — CTA "Start — my data stays on this device" is disabled until you check "A parent or guardian and I agree to share this data"; label never updates after consent; consent is self-attested by the minor | Consent step | High — legal/trust surface with contradictory copy | S (copy) / M (real verification) | **P1** |
| 9 | **Onboarding weight-goal validation** — Lose Fat default target 184 > current 178, accepted silently, then silently replaced with 164 downstream | About You | Medium-high — user input discarded without a word | S | **P1** |
| 10 | **WCAG contrast failures** — `#94A3B8` at 10–12px = 2.45–2.56:1 (needs 4.5:1) incl. inactive tab-bar labels, section eyebrows, meta text | Systemic | Medium — legibility outdoors/on cheap phones; AA fail | S | **P1** |

---

## 3. Screen-by-screen findings

### Welcome (`ux-02`)
- **Good:** clean, fast, name-first personalization, sign-in escape hatch.
- **P3:** zero value proposition — one line ("The accountability score your coach actually checks") would orient organic installs. Large dead zone below the fields; layout feels unfinished on tall screens.

### Role picker (`ux-03/04`)
- **P2:** 7 roles at decision point #2; five are coach-flavored (Personal Trainer / Sports Performance Coach / Nutritionist / HS Coach / College Coach) with near-identical clipboard icons. Collapse to **Athlete / Coach or Trainer / Parent** + a specialty follow-up.
- **P2:** last option clipped under the floating Continue — scroll container needs bottom padding (~96px). Same defect on the habits step.

### Goal picker (`ux-05`)
- Good grouping (Performance / Body Comp / Athletic Development), but 12 chips is heavy; consider 6 primary + "More."

### Sport (optional) (`ux-06`)
- The old "forced sport after Lose Fat" bug is **fixed** — skip works. Good.

### About You (`ux-07`)
- **P1 (#9):** direction-blind target default (184 on a 178-lb Lose Fat user); no warning on Continue.
- **P2:** steppers are the only input — 33-lb change = 33 taps. Allow tap-to-type on the number.

### Habits baseline (`ux-08`)
- 6 inputs on one screen; sleep stepper hidden behind CTA (**P2**, same padding fix). Pre-filled 6/10 sliders bias answers slightly; acceptable tradeoff.

### Score reveal (`ux-09`)
- **P1 (#6):** honest-average answers → **49 GRADE F** in red. The framing copy ("rises as OnStandard learns") is good, but an F at minute two is a peak-negative beat. Either calibrate the starting band (49 should read as "C-range starting point" or show no letter until day 3) or restyle the reveal as a *baseline*, not a verdict.

### Account creation (`ux-10`)
- Well-placed (after value tease). **P2:** no show-password toggle, no password-rules hint, confirm-password field adds friction. **P3:** eyebrow "CREATE YOUR ACCOUNT" + heading "Create your account" duplicate (coach flow, `ux-43`).

### Email confirmation (`ux-11`)
- **Excellent:** non-blocking, "your data stays on this device until you confirm." Keep.

### Guardian consent (`ux-12/13`)
- Age re-confirmation works (recent fix verified live).
- **P1 (#8):** the no-share CTA is gated behind the consent-to-share checkbox, and its label ("my data stays on this device") never changes after consent. Two states, one label, both wrong in one direction or the other. Split into two actions: "Share with my guardian's OK" (primary once checked) and "Keep it on this device for now" (always enabled).
- Known: self-attested minor consent (needs real guardian verification; Resend flow pending).

### First-meal challenge (`ux-14`)
- Great activation design (+3 to your score), **but** "Start now" drops to Home instead of opening meal capture (**P2** — broken promise at the single most important activation moment; deep-link it).

### Athlete Home (`ux-15/16/17`)
- **P0 (#3):** 0 GRADE F after the app just said 49.
- **P1 (#6):** negative-first framing everywhere on day one.
- **P1 (#5):** score-trend chart draws a shaped green line while its own label says "Your first day · this fills in as you log." Render a flat/empty track until ≥2 real points.
- **P2:** mission says "Log breakfast … overdue" at 9 PM while meal capture correctly infers Dinner and the notification says "Time to log dinner" — three engines, two opinions. Drive the mission off the same time+meal logic as capture.
- **P2:** medical disclaimer sits inside the mission card, repeated on every mission; move to first-meal-log + Profile.
- **Good:** FINISH TODAY "35 → 86 (+51)" projection is a strong, honest mechanic; commitment one-tap moves the score instantly; check-in banner flips to Completed state.

### Meal capture (`ux-18/19/21`)
- **Strong screen overall:** Photo/Search/Label modes, meal-type chips pre-inferred, offline note, "exact, not a photo estimate" honesty framing, gallery + describe-it + mic affordances.
- **P0 (#4):** Search failure mode lies (network error → "No matches"). Distinguish `no results` from `request failed`, and add CORS headers to `food-lookup`/`assist` edge functions (web origin currently 100% broken).

### Weekly check-in (`ux-23/24/25`)
- **Good:** teen-safe weight copy ("If food or your body feels stressful, talk to someone you trust or a doctor").
- **P2:** completion screen contradicts itself — "Energy, sleep, and confidence are strong" directly above "Train with caution — you're a little under-recovered" (74) from a 7/10 recovery. Reconcile thresholds or merge into one verdict.
- **P2:** "AI Weekly Summary" is an echo of the inputs; either say something non-obvious (trend vs last week) or drop the AI label.

### Nutrition tab (`ux-26/27`)
- **P0 (#1):** the goal-inversion card (full detail in §2).
- **P2:** same-screen number conflicts: Macros "0 / 2,150 cal · 160g" vs Win-the-day "2,348 cal, 178g protein." One targets engine, one render.
- **Good:** quick-add protein chips (+25g shake etc.) are exactly the right friction-cutter; "Today's Meals 0 of 4" schedule is clear (though all four "Log now" buttons carry equal urgency at 9 PM — dim the past, highlight the next).

### Plan tab (`ux-28`)
- **P2:** effectively empty — a duplicate commitment card + three numbers + void. Either give it content (today's meal slots, coach instructions, training reminders) or fold it into Home/Nutrition and free the tab slot. An empty core tab reads as an unfinished app.

### Squad tab (`ux-29`)
- **P1 (#5):** "Linebacker · Eastside HS" — user never entered either. Show nothing until known.
- **P2:** empty state has good copy but **no CTA** — dead end. Add "Enter team code" / "Find your school" right there.

### Profile (`ux-30/31/32`)
- **P1 (#5):** "Averaged 49 across 1 day (Needs intervention)" + "83% of days on plan" — wrong number, coach-jargon leaking to the athlete, unexplained stat. "Tough week" chip on day one.
- **P2:** Trust Pass card for a fresh unconnected athlete is noise, and "Pilot: your coach grants this at launch" is internal language. Hide until eligible or coach-connected; reconcile "0 of 7 days" vs "10-day pass."
- **Good:** "Who can see your data — Just you, for now" is exactly the right privacy surface; settings block (notifications/units/appearance) is clean; v1.0 footer.

### Notifications (`ux-35`)
- **P1 (#5):** fabricated timestamps and a stale "Weekly check-in due" after submission.
- **P2:** side-stripe left borders on cards — banned by the project's own design law; use full hairline + tinted icon square (already present).

### Performance (`ux-37`)
- **Good:** clean logger + teaching empty state. **P3:** raw ISO date "2026-07-02"; humanize ("Today").

### Score explainer (`ux-36`)
- **Keep as-is:** inline expansion, honest weights (50/25/15/10), self-reported caveat. This is the single most trust-building element in the app.

### Coach onboarding (`ux-38–45`)
- Tight, well-scoped questions (school w/ add-new, sport, roster size, position groups). **P0 (#2):** the fake team code moment. **P2:** "when your team goes live" is backend jargon.

### Coach dashboard / Attention / Reports (`ux-46–50`)
- **P1 (#7):** all the zero-athlete logic failures (green 0%, red 0 alerts, "everyone is above the line," AI "trending up: 0 of 0"). With 0 athletes every module should collapse into one state: **"No athletes yet → share your code"** — which is also the missing re-surface of the invite CTA after onboarding skip.
- **Good:** copilot fell back to local computation when the AI endpoint died — resilience done right (just add a quiet "computed locally" note); stat chips + Full report link architecture is sound and will scan well once real data exists.

### Sign-in (`ux-52/53`)
- Works; inline error placement correct. **P2:** raw Supabase string "Invalid login credentials" — rewrite in product voice ("That email or password doesn't match. Try again or reset it."). No loading state on the button during the auth roundtrip.

---

## 4. Mobile-specific issues
- Sticky-CTA clipping on scrollable onboarding steps (role picker, habits) — add bottom padding equal to CTA height + 16.
- Touch targets: copilot chips 31–32px, tab-bar items 39px, several icon buttons ~36px — below the 44px floor.
- Stepper-only numeric entry (About You, check-in weight) is tap-punishing.
- Otherwise: layout holds at 390×844 with no horizontal scroll anywhere tested — good.

## 5. Desktop-specific issues
- App renders as a fixed ~440px mobile column with a bottom tab bar at 1440×900. Fine for athletes (phone-first), **wrong for coaches** — the roster/reports persona works on a school laptop. Even a cheap win (sidebar nav + 2-column dashboard ≥1024px) would make the coach product feel native on desktop. P2 now, P1 the moment web is a sold channel.

## 6. Accessibility
- **Contrast (P1):** `#94A3B8` on white at 10–12px = 2.45–2.56:1. Needs a darker "tertiary-accessible" token (`#64748B` passes at 4.76:1) for anything under 14px, including inactive tab labels.
- **Focus (P2):** keyboard focus relies on the browser default ring (`outline: auto`); design a visible brand focus style.
- **Headings/landmarks (P2):** everything is a `generic` div — no `role="heading"`/level semantics anywhere (React Native Web supports `accessibilityRole="header"`). Screen-reader users get soup.
- **Good:** interactive elements consistently carry real labels ("Hit your plan today: Yes", "Weekly check-in due: 6 questions, about 2 minutes") — better than most RN apps.

## 7. Navigation
- Athlete IA (Home / Nutrition / camera FAB / Plan / Squad) is right-shaped, but Plan doesn't earn its slot yet (§3).
- Activation deep-link break: "Start now" → Home instead of capture.
- Dead ends: Squad empty state (no CTA), coach dashboard (no invite re-surface).
- Back behavior inside overlays (Notifications, Performance) worked correctly everywhere tested.

## 8. Copy/content
- Voice is mostly on-brand (short, coach-room, no hype) — the skeleton is good.
- Fix: robotic constructions ("Averaged 49 across 1 day (Needs intervention)"), internal jargon ("Pilot", "goes live", "Coach-set" with no coach), raw backend strings ("Invalid login credentials"), duplicated eyebrow/heading, repeated inline disclaimer, time-blind "breakfast is overdue" at night.
- The three-different-protein-targets problem is a copy symptom of a data problem — one derivation, one render.

## 9. Visual design
- **Verdict: passes the slop test.** Committed system, real brand color discipline (blue carries, color is earned), consistent radii/shadows/type. Dark mode is complete and clean.
- Deviations from its own law: side-stripe notification borders; green/red bound to metric category instead of value on coach stats; shaped chart lines for empty data.
- Score ring + grade pill is a strong signature element — protect it by making the number it shows trustworthy.

## 10. Conversion & onboarding
- Funnel order is right (value tease → account → consent → activation challenge) and email confirm is non-blocking. The leaks are: 7-role picker (decision fatigue at step 2), F-grade reveal (emotional cliff), broken activation deep-link, contradictory consent gate, and the coach's fake-code moment (kills the highest-leverage viral loop: coach → 40 athletes).

## 11. Design-system improvements
1. `text.tertiaryAccessible` token (≥4.5:1) + lint rule: no `#94A3B8` under 14px.
2. Semantic status colors bound to *meaning* (good/warn/bad/neutral), not metric identity — fixes green-0% and red-0-alerts class of bugs.
3. `EmptyChart` primitive (flat track + label) so no chart ever invents a line.
4. Min-target enforcement in `Btn`/`Chip` (44px hit-slop even when visually smaller).
5. Shared `ScrollWithCTA` wrapper that pads content past the floating button.
6. Focus-visible style in the `Btn`/`Pressable` primitives.
7. One `targets.ts` selector consumed by Home, Nutrition, Plan, Profile — no local recomputation.

## 12. Prioritized roadmap

**Phase 1 — Truth (P0, ~2–4 days):** goal-direction fix (lose/gain/maintain drives weekly goal, kill false "Coach-set"); single score selector consumed everywhere (reveal → Home → Profile → Squad); real team code at creation or an unmistakable demo-gate before the Share CTA; error-state honesty in food search + CORS headers on `food-lookup`/`assist`.

**Phase 2 — First-day experience (P1, ~2–3 days):** no fabricated data anywhere on fresh accounts (trend, notifications, identity, stats); reveal reframed as baseline (calibrate F band); target-weight validation with direction-aware defaults and a visible correction, never a silent override; consent gate two-action redesign; activation deep-link to capture.

**Phase 3 — Coach zero-state (P1, ~1–2 days):** single "no athletes yet" collapse across dashboard/attention/reports; value-bound status colors; invite CTA re-surface.

**Phase 4 — A11y & ergonomics (P1/P2, ~1–2 days):** contrast token swap, touch targets, focus styles, heading roles, scroll-past-CTA padding, tap-to-type numbers.

**Phase 5 — Surface polish (P2, ongoing):** Plan tab content-or-cut decision, Squad CTA, time-aware missions, check-in verdict reconciliation, copy sweep (jargon/raw errors/dupes), desktop coach layout, notification side-stripes, password toggle.

---

## Positives to protect
Non-blocking email confirm · score-explainer transparency · meal capture (modes, inference, honesty framing) · one-tap commitment with live score feedback · teen-safe check-in copy · "Just you, for now" privacy surface · copilot local fallback · complete dark mode · consistent a11y labels · the design system itself.
