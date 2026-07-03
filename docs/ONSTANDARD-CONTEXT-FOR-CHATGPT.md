# OnStandard — Full Context Breakdown (for handing to another AI)

*Snapshot date: 2026-07-03. This is a complete, self-contained briefing on the product, the
business, the tech, and current build state.*

---

## 1. One-line summary
**OnStandard is a mobile-first athlete accountability platform.** Athletes log meals (with AI
photo analysis), do daily tasks and a weekly check-in, and earn a daily 0–100 **Accountability
/ Development Score**. Coaches, parents, and trainers get real-time visibility into whether the
athlete is actually doing what they're supposed to do. The product answers one question:
**"Is this athlete actually executing the plan?"**

The tagline for the name: *"OnStandard"* = the top scoring tier — you hit your bar today.

---

## 2. What it is, in plain English
Everyone an athlete trusts — coach, parent, nutritionist, trainer — makes plans. Almost nobody
ensures those plans get *done*. OnStandard is the layer between intention and execution. It:
- Makes the right next action obvious ("what do I do now?").
- Makes doing it rewarding (a single honest score that moves when you execute).
- Makes execution **visible** to the people invested in the athlete (the accountability that
  actually changes behavior — your number is watched by your coach/parent).

Nutrition is the first domain because it's daily, measurable, and emotional — the proving
ground for a system meant to eventually govern training, recovery, and beyond. Positioned as an
**AI-powered execution platform**, not "another macro tracker."

---

## 3. Who it's for
- **Primary users:** serious high-school & college athletes, ~13–22. On their phone daily,
  often tired/post-practice, low patience. They want a fast, motivating, honest read on whether
  they're on track — and they know the people who matter can see it.
- **Secondary users (oversight roles):** coaches, parents, personal trainers, nutritionists.
  They want quick "who needs attention" scans, roster standings, weekly trends. Glanceable,
  trustworthy, no fluff.

Four core role experiences exist in the app: **Athlete, Coach, Parent, Trainer.** Onboarding
maps 7 role selections (athlete / parent / personal_trainer / sports_perf_coach / nutritionist /
hs_coach / college_coach) onto those flows.

---

## 4. Origin & history
- Built starting **2026-06-21** from a Claude Design handoff (a mobile-app prototype), recreated
  faithfully as a real Expo/React Native/TypeScript app.
- Originally named **AthleteOS**; **renamed to OnStandard on 2026-06-30** (AthleteOS was taken).
  Brand swept across the whole repo and verified. Domain to buy: **onstandard.app**. Bundle id:
  **com.onstandard.app**. (The local repo folder is still `Downloads/athleteos`, and the live
  Supabase project's dashboard display name is still "AthleteOS" — cosmetic only.)
- Much of the build was done by autonomous overnight "crew" runs (scheduled cloud Claude Code
  agents) plus supervised in-session work, all committed to git with a large test suite.

---

## 5. The scoring model (the heart of the product)
The daily score is called the **Accountability Score** (a.k.a. the **Development Score** in
product/strategy language — the intended category-owning term, the way Whoop owns "Recovery").
It is deliberately **honest**: an empty/low-effort day scores near 0, never a feel-good number.

**Daily formula (the "athlete" profile, the default):**
```
score = 0.50 * nutrition
      + 0.25 * recovery      (self-reported, from the weekly check-in)
      + 0.15 * commitment    (daily one-tap: "did you hit your plan today?" yes/partial/no)
      + 0.10 * checkin       (did you complete the weekly check-in at all)
```
Weights sum to 100. Letter grades: **A ≥90, B ≥80, C ≥70, D ≥60, F <60.** "On standard" = the
top band.

Key honesty rules baked into the engine (`src/core/scoring.ts`):
- **Nutrition is 0 without a logged (photo-backed) meal** — you cannot reach "on standard"
  (≥80) without actually logging, because nutrition is half the score. This is the "honesty
  firewall."
- **Recovery only counts once a real check-in backs it** — the neutral 86 placeholder is a
  display value only; it contributes 0 to the score until earned (this fixed a bug that inflated
  every no-check-in day).
- **Weight is a separate long-arc goal**, not folded into the daily score (a flawless day
  shouldn't lose an A because season weight progress is slow). It replaced a fake hardcoded
  "95" every athlete used to share.
- **Day 0 shows no fake trend** ("starting today" instead of inventing a week of slippage).
- NaN/corrupt-blob guards throughout so a bad persisted value can never poison the score.

**The Scoring Contract (critical architectural rule):**
- **The coach/trainer/nutritionist owns the PLAN** — targets (protein, calories, meals,
  windows, restrictions), the scoring **profile** (Athlete / General / Performance), and which
  check-in components are relevant (on/off toggles).
- **The platform owns the FORMULA** — the weights within a profile, the 0–100 scale, the band
  language. A coach may NOT re-weight or invent metrics. An "84" always means "84% execution of
  YOUR plan" — comparable across a roster and un-gameable.
- **The AI recommends, never dictates** — it proposes evidence-based targets/profile; the coach
  accepts or overrides. Target *math* stays deterministic (never let a model hallucinate a
  minor's calorie target); the LLM layer explains/refines, it doesn't invent the number.

There's also a **Trust Pass** mechanic: a proven athlete can be granted coach-approved,
camera-free days where a one-tap "yes" credits the trailing median of their own photo-earned
nutrition scores — worth exactly what their camera has historically measured, never more.

---

## 6. The core product loop
**Plan → Execute → Reflect → Connect → Prove**, every day:
1. **Morning (Game Plan):** one number, one focus, the checklist to move it.
2. **Execute:** log a meal, the AI sees it, the number moves.
3. **Reflect:** the coach voice says what's next.
4. **Connect:** the coach sees it; falling behind escalates app → coach.
5. **Evening:** the "finish today" projection resolves — did you finish?
6. **Weekly:** the report adjusts tomorrow's plan and proves the trend.

**Signature experience:** the **Daily Game Plan** built around the Development Score — forward-
looking ("how to win today," not "how you recovered") and **watched** (your number is seen by
the person invested in you).

**Intended navigation (target):** collapse fragmented tabs into **TODAY** (game plan) · **+ LOG**
(center capture) · **PROGRESS** (trend/weight/results) · **COACH** (your coach, plan, messages,
standing). Every tab names a strategic pillar.

---

## 7. Strategic pillars (the 10-year north star)
From the Product Constitution. When pillars conflict, the higher one wins:
1. **Accountability — the spine.** The mission *is* execution. Wins ties.
2. **Decision Engine & Intelligence — the engine.** "What do I do now?" Serves accountability.
3. **Human Connection — the moat & distribution.** A coach brings a whole roster. AI amplifies
   the human, never replaces them.
4. **Proof — the endgame.** Weakest today (little outcome data), deepest long-term
   defensibility. Earned by running the loop with real people, not built in a sprint.

**Founder rules (permanent, abbreviated):** Never build a feature that strengthens no pillar ·
The plan isn't the product, execution is · Never replace the coach, amplify them · Reward
executing the plan, not perfection · Reduce decisions, never add choices · Always explain why ·
Every screen answers "what next?" · **Never call it AI until a model actually does the work
(honesty is positioning)** · One number — protect the Development Score from dilution · Demo
data never touches a real user · Validate the loop before widening it · The coach owns the plan,
the platform owns the formula, the AI recommends.

**Long-term moats:** (1) behavioral data flywheel — every meal + outcome makes recommendations
smarter; (2) the coach↔athlete graph — huge switching cost + built-in distribution; (3) the
Proof/outcomes dataset — sellable to colleges/programs, nobody in nutrition has it; (4) the
Development Score as the category standard.

---

## 8. Feature inventory (what's actually built)
The app is a real, running Expo app with a large pure-TypeScript domain layer. Feature areas:

**Athlete-facing screens** (`src/screens/athlete`): Home (score hero + rings + "what's in this
score" breakdown + trend), Nutrition, Performance (PRs/lifts/sprints), Plan, Profile, CheckIn
(weekly recovery), Reminders, Squad (leaderboard), MemoryConfirm.

**Overlays** (`src/screens/overlays`): MealCapture (photo → analysis), MealDetail, MealHistory,
FoodCoach, NutritionMemory, Messages, Notifications, Connect (linking), Account, Plans (pricing/
checkout), CoachGoalsEditor, CoachPlanEditor, OverseerProfile, PersonDetail.

**Role views** (`src/screens/roles`): CoachView, ParentView, TrainerView, CoachCopilot (AI coach
assistant), AthleteProfileView, plus live-roster / pending-request hooks.

**Onboarding** (`src/screens/onboarding`): activation-first, one-question-per-screen step engine
that personalizes by role; computes a "Starting Point Score" with an animated score reveal, then
a first-meal challenge.

**Domain logic** (`src/core`, ~110 pure-TS modules, each with tests) includes: scoring, scoring
profiles, commitment, recovery, adherence, nutrition memory, meal editing/matching/history, food
DB, macro grounding, coaching voice, restaurant coach, coach plans & goals, roster & roster sync,
attention/overseer alerts, nudges, weekly report, performance profiles, projection, readiness,
trust pass, streak (with grace day), leaderboard, reminders, consent/guardian-consent,
subscription/pricing/membership, data export, account/identity, and history.

Feature areas gated behind flags (`src/lib/features.ts`): `isBackendLive`, `isEnginesEnabled`
(meal-punctuality engine), `isMealPlansEnabled`, `isStreakGraceEnabled`, `isTrustPassEnabled`.

**AI features:** meal photo → analysis, AI nutrition coach voice, nutrition memory flywheel
(learns from past meals), CoachCopilot, plan generation. The deterministic contract wraps the
LLM — the app falls back to deterministic logic when AI isn't configured, so it never fakes AI.

**Other systems:** dark mode (Light/Dark/System), notifications (reminders + in-app feed + coach
→ athlete push), athlete↔coach and client↔trainer linking (join-by-code / join requests /
schools), guardian consent for minors, Stripe billing seam, Apple Sign-In seam, data export &
account deletion (App Store requirement).

---

## 9. Tech stack & architecture
- **Frontend:** Expo ~56 · React Native 0.85 · React 19 · TypeScript · expo-router · Zustand +
  AsyncStorage (persistence key `aos_day`) · react-native-svg (animated score/macro rings) ·
  react-native-web (web preview). Runs via `npx expo start`; web preview because the project's
  SDK is ahead of store Expo Go.
- **Design system** (`src/ui/tokens.ts`, `DESIGN.md`): Plus Jakarta Sans, **Athlete Blue
  `#2563EB`** as the single carrying accent on tinted-slate neutrals, soft layered shadows,
  generous radii (18–24 cards). Grade chips A green / B blue / C amber / D orange / F red.
  Named motion animations (ring draw, scan line, slide-up). Inline SVG icons, no emoji.
- **Core engine discipline:** `src/core` is pure TypeScript with NO React Native imports, so it
  can lift to a shared `packages/core` for future desktop dashboards.
- **Backend:** **Supabase** (Postgres + Auth + Storage + RLS + Realtime). Live project ref
  `ftwrvylzoyznhbzhgism`. **~39 SQL migrations** (`supabase/migrations/0001`→`0039`) cover
  schema, RLS, storage, team join-codes, messaging minor-gate, account deletion, guardian
  consent, subscriptions, org memberships, an access-check cutover, security hardening, AI usage
  metering + spend guard, athlete memory facts, performance profiles, food cache, schools,
  linking/join-requests, notifications + device tokens, score-integrity upload guard, meal plans,
  trust passes, analytics, and linking consent.
- **Edge Functions** (`supabase/functions`, Deno): `analyze-meal` (Claude vision, forced
  structured output, macro grounding — holds the ANTHROPIC_API_KEY server-side), `assist`,
  `food-lookup`, `guardian-verify`, `plan-generate`, `send-push`, `stripe-webhook`.
- **AI model:** app runtime coaching runs on Claude (Sonnet-class) behind a nutritionist system
  prompt + structured athlete context + macro DB — it's a prompted model with a deterministic
  contract, NOT a fine-tuned model.
- **Verification:** `npm run verify` = tsc typecheck + Jest + full iOS Metro bundle export.
  Roughly **1,300 tests** across ~110 test files, green.

**The master switch:** `EXPO_PUBLIC_BACKEND_LIVE` turns the entire backend on/off in one flag —
it's the instant kill-switch. As of ~2026-07-02 it's been flipped **on** and migrations through
~0028 applied to live; earlier docs saying "nothing is connected" are stale.

---

## 10. Business model
Priced by **active participants** (graduated/inactive seats free up automatically). Opening
catalog (data, not code — changeable without an app release):

**Consumer:** Individual **$14.99/mo** ($149/yr, 7-day trial) · Individual Plus **$24.99/mo**
($249/yr) — adds portable multi-org history + a shareable recruiting card.

**Professional (trainers/nutritionists):** Solo **$69/mo** (up to 25 clients, 14-day trial) ·
Professional **$124.99/mo** (up to 50 clients; +$3/active client beyond).

**Organization & Gym (a gym = an org):** Starter **$249/mo** (30) · Growth **$499/mo** (75) ·
Performance **$799/mo** (150) · Enterprise custom (150+, multi-location, SSO/API). Per-head cost
drops as the org grows — a built-in reason to expand.

Annual ≈ pay for 10 months, get 12 (~17% off). **Go-to-market wedge:** gyms / performance
facilities as the beachhead — recruit a few plus their clients, validate retention, then widen.

---

## 11. Current status & what's left
**Built and verified:** the full mobile app (all 4 roles, onboarding, reactive scoring engine,
every overlay), real Claude vision meal analysis deployed to live, dark mode, linking,
notifications, AI copilot/memory/profile, meal plans (behind a flag), security-audit fixes, ~1,300
green tests. The 2026-07-02 UX audit's 4 P0 truth bugs were fixed (goal-direction, one score
story, honest team code, honest search errors).

**What's left is mostly NOT code — it's people/accounts (from `START-HERE.md`):**
1. **Human chain (start first, takes weeks):** hire a lawyer (privacy/terms + COPPA/FERPA
   sign-off for minors' data), pick a **parent-verification vendor** (until it exists, every
   minor stays local-only), pick an **email service** (confirmation + parent-approval links).
2. **Pricing + Stripe:** bless the numbers, set up Stripe products + a billing/cancellation
   portal link; the compliant checkout screen is already built.
3. **Turn the backend on:** apply remaining migrations in order, flip email confirmation on, set
   Supabase URL/key + `EXPO_PUBLIC_BACKEND_LIVE=true`, wire the "parent clicked approve"
   endpoint.
4. **Phone + App Store:** test notifications/camera/meal photos on a real device, add Sign in
   with Apple (Apple requires it since email login is offered), submit (in-app account deletion
   already built).
5. **Real users:** recruit gyms/facilities + clients and watch whether people keep using it.

**Known gaps / risks called out in audits:** meal-photo analysis is the headline feature and the
biggest quality gap to prove at scale; coach dashboards are inert until backend is fully on;
push delivery needs a real device build (EAS); the Proof/outcomes pillar has near-zero real data
until the loop runs with real athletes.

---

## 12. Key repo landmarks (if the AI gets repo access)
- `docs/PRODUCT-CONSTITUTION.md` — canonical "what we build and why" (10-year north star).
- `PRODUCT.md` / `DESIGN.md` / `README.md` — product context, design system, run instructions.
- `START-HERE.md` — the plain-English go-live checklist (note: partly superseded 2026-07-02).
- `docs/audit/2026-07-02-*` — latest full audit + UX/UI audit + Phase-0 go-live source of truth.
- `docs/founding/` — strategy, pricing/GTM, competitive analysis, gym strategy, roadmap.
- `src/core/scoring.ts` — the scoring engine (the honesty rules live here).
- `supabase/migrations/` + `supabase/functions/` — backend schema/RLS + edge functions.
