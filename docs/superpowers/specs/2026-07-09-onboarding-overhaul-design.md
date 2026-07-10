# Onboarding Overhaul — Design

**Date:** 2026-07-09
**Status:** Implemented 2026-07-09 (this plan); migrations 0048 + org-directory function await go-live apply/deploy.
**Surface:** `proto/redesign-2026-07/` (the live WebView app) + authored Supabase migrations + minimal native bridge additions
**Sub-project 1 of the 2026-07-09 product feedback dump.** Later sub-projects (separate specs): Execution loop (Home + Action Hub + state-driven notifications), AI meal logging experience, Plan page.

## 1. Goals

Replace the current forward-only, coach-agnostic athlete onboarding with an adaptive linear wizard that:

1. Collects real identity (first + last name, DOB) with an under-13 gate.
2. Lets an athlete find their school by name + location, see its coaches, and connect with a coach code — and gives clients the same pattern for gyms/trainers.
3. Turns the "Your Standard" page from a hardcoded "Coach Mark" info dump into an adaptive contract with a commitment moment.
4. Hardens account creation: password confirm + strength, Sign in with Apple, terms/privacy acceptance, post-signup Face ID opt-in.
5. Adds back navigation and a progress indicator to every step.
6. Makes coach/trainer onboarding real enough to supply the directory (real org + team + join code, persisted).

## 2. Decisions (locked with founder, 2026-07-09)

| Question | Decision |
|---|---|
| School directory source | **Hybrid**: coach/trainer-registered orgs power discovery; coach code remains the private handshake. Full public-school import (NCES/IPEDS) stays a separate data-ops step (per 0022 note); "add your school" + direct code entry are the escape hatches. |
| Code redemption | **Instant connect** — a valid code links immediately (the code is the coach's consent). Coach can remove athletes from the roster afterwards. |
| Your Standard page | **Adaptive + commitment moment** — coach's named standard when connected, goal-generated personal standard with knobs when solo; both end in hold-to-commit. |
| Age policy | **Block under-13** (COPPA, matches existing copy). 13–17 proceed with no guardian dependency; parent invite stays post-signup. Under-13 guardian-consent flow is out of scope (future spec). |
| Spec scope | **Athlete flow fully redesigned + coach/trainer onboarding made real** (org + location + working code). Client flow is a light adaptation of the same discovery pattern, not a from-scratch redesign. |
| Flow shape | **Adaptive linear wizard** — one ordered flow; steps insert/adapt based on answers; optional extras (Face ID) defer to post-signup. |

## 3. Athlete flow

Eight moments. Back arrow + segmented progress bar on every step. Every answer persists to `RT.ob` on interaction (existing pattern — DOM is wiped between hash routes), so back/forward and app-kill never lose data.

| # | Step | Route | Collects / does |
|---|---|---|---|
| 1 | Who are you | `#onboarding/1` | **First name** + **last name** (two required fields), **DOB** (date wheel). Under-13 → block screen. |
| 2 | Your school | `#onboarding/2` | School search → coach pick → code entry (§4). Skippable ("Skip for now"). |
| 3 | Your sport | `#onboarding/3` | Sport / position / level chips (today's step-1 content minus name). |
| 4 | Goal | `#onboarding/4` | gain / lose / maintain / perform (unchanged). |
| 5 | Where you are now | `#onboarding/5` | Current + target weight, allergies (unchanged). |
| 6 | Your Standard | `#onboarding/6` | Adaptive standard + hold-to-commit (§5). |
| 7 | Create account | `#onboarding/7` | Email, password + confirm + strength meter, Sign in with Apple, terms line (§6). |
| 8 | Post-signup | sheet over `#home` | Face ID opt-in sheet → Day-0 home. |

**Order rationale:** identity → belonging (school/coach) → intent (goal) → baseline → contract (standard) → account last, so the account ask lands after investment. Coach connection at step 2 is what lets step 6 render the coach's real standard.

**Navigation rules:**
- Back arrow top-left on steps 2–7 (step 1 backs to the role picker). Going back never clears captured answers.
- No back from Day-0 home into onboarding (onboarding is done once the account exists).
- OS back-swipe stays disabled (`allowsBackForwardNavigationGestures={false}`); navigation is explicit in-UI.
- Progress: thin segmented bar (7 segments) replacing the current dots; screen-reader label "Step N of 7".

**DOB details:** three-field segmented input (MM / DD / YYYY) styled to the token system (no native `<input type=date>` — inconsistent inside WKWebView). Validated client-side; age computed at submit. Under-13 → full-screen friendly block: why (13+ policy), pointer to the privacy policy, no dead-end tone. DOB stored on `athlete_profiles` (new column, §8).

## 4. School / coach discovery & connection

### Supply side — coach & trainer onboarding become real

Coach onboarding (today UI-simulated in `roles.js`) becomes a real 5-step flow:

1. Name (first + last). No DOB for staff.
2. **School**: same search component as athletes, with "Add your school" fallback → `find_org` dedup pre-check → create org with name + **city + state** (0022 pattern).
3. Team: name, sport, level, **discoverable toggle** (default ON in the UI with clear copy "Athletes at &lt;school&gt; can find this team" — the column default stays false; the UI opt-in is explicit).
4. Standard toggles (existing).
5. **Create account** (reuses the step-7 component) → on session, org creation (if new) + `create_team(name, sport, org_id, discoverable)` (RPC exists, 0022) run with a loading state → **real join code** displayed with copy/share actions.

Trainer flow: identical shape with `type='gym'|'training'` org nouns ("Your gym or practice"), producing a real team + code the client flow can redeem.

The account must exist before org/team creation because `search_orgs`/`find_org`/`create_team` require `auth.uid()`; steps 2–3 therefore search via the anon `org-directory` function (same as athletes) and defer all writes to step 5. If email confirmation is required, org/team creation backfills on first sign-in from `RT.ob` (same backfill pattern as athletes).

### Athlete side — step 2 in detail

1. **Search**: type-ahead (≥2 chars) against the org directory; result rows render `Name — City, ST` plus `N teams` when any discoverable team exists. Same-named schools are disambiguated by the city/state line (0022 index supports the dedup).
2. **Pick school → coach list**: discoverable teams at that org, each row showing team name, sport, and head coach display name.
3. **Pick coach/team → code entry**: "Ask Coach &lt;LastName&gt; for the team code." 6-char code input (matches `gen_join_code()` format). Valid → confirmation state "You're on Coach &lt;LastName&gt;'s roster" and step 6 switches to the coach's standard.
4. **Fallbacks**, always visible:
   - "My school isn't listed" → direct code entry (code implies team + school).
   - "I have a code" → same direct entry.
   - "Skip for now" → solo path; connect later from Profile (existing later-join surface).

### Mechanics — validate now, connect after signup

The athlete has no account until step 7, but 0031's `search_orgs`/`find_org` and any join RPC require `auth.uid()`. Resolution:

- **New edge function `org-directory`** (anon-callable, service-role inside) exposing two operations:
  - `search` → same safe columns as `search_orgs` (id, name, type, city, state) + discoverable-team display info (team id, team name, sport, coach display name). Never `created_by`, never join codes.
  - `preview_code` → given a join code, returns team + coach + org display info only. Knowing the code is the capability; nothing enumerable leaks.
  - Guards: per-IP rate limit + ≥2-char query + result caps, following the existing `claim_ai_usage_key` anon-guard pattern in `analyze-meal`.
- Step 2 uses `org-directory` for search + code validation. The validated code + chosen team id are held in `RT.ob.join` (replacing today's inert `RT.ob.coachCode`).
- **After signup**, `act.persistOnboarding()` additionally redeems the code server-side (existing join RPC if present; otherwise a `join_team(code)` SECURITY DEFINER RPC that re-validates the code and inserts the roster row — never trust the client's cached team id alone). Runs on both the immediate-session path and the email-confirmation backfill path.
- Coach display in the directory: head coach's display name from `team_staff`. Listing is implied by the coach's explicit discoverable opt-in; a per-coach "hide my name" opt-out is future work (noted, not built now).

## 5. Your Standard page (step 6)

One page, two faces, both ending in the same commitment moment.

**Connected (code validated at step 2):** headed "**Coach &lt;LastName&gt;'s Standard**". Renders the actual requirement set from the team's standard config (the coach-onboarding toggles; falls back to the default athlete standard for any unset piece), with the score weights shown as today (meals 50% / recovery 25% / commitment 15% / weekly 10%). No hardcoded "Coach Mark" anywhere.

**Solo:** headed "**Your Standard**". Generated from the step-4 goal:
- *gain*: 3 meals + protein emphasis copy
- *lose*: 3 meals + hydration emphasis copy
- *maintain*: 3 meals, balanced copy
- *perform*: 3 meals + recovery emphasis copy

Two adjustable knobs: **meals/day (2–4)** and **reminder pressure** (gentle / accountable / max — existing selector relocates here). Footer copy: "When you connect a coach, their standard takes over."

**Commitment moment (both faces):** a **hold-to-commit** button ("Hold to commit") — press-and-hold ~1.2s with a fill animation and haptic buildup (bridge haptics), releasing into a confirmation state. Commitment timestamp stored in `RT.ob` and persisted to the profile at signup (§8). The step's CTA is the commitment itself; "Next" appears only after commit. Reduced-motion users get a plain confirm tap (respect `prefers-reduced-motion`).

**Scoring note:** meals/day knob feeds the requirements catalog (which slots run), not the scoring weights — the formula stays untouched (consistent with DECISION-MEMO D3: nothing edits the scoring formula).

## 6. Account creation & security (step 7)

- **Email** field (existing) with inline duplicate-email error → "Sign in instead" link.
- **Password**: minimum raised 6 → 8 chars; **confirm-password** field with match indicator; **strength meter** (3-band heuristic: length + character variety — no external lib); show/hide toggle on both fields.
- **Sign in with Apple**: button above the email form ("Continue with Apple"). Native module exists (`src/lib/auth/apple.ts`); add a bridge method (`bridge.appleSignIn()`) that runs the native flow and returns the identity token to the WebView, which calls `supabase.auth.signInWithIdToken({ provider:'apple', token })`. Apple-auth users skip email/password and jump to the post-signup moment; onboarding answers persist via the same `persistOnboarding()`.
- **Policy gate**: "By creating an account you agree to the **Terms of Service** and **Privacy Policy**" line above the CTA; links push the existing `terms`/`privacy` screens (back returns to step 7 with state intact). Acceptance recorded at signup: `profiles.tos_accepted_at` + `profiles.tos_version` (§8). Implicit-agree (no checkbox) per App Store convention.
- **Face ID (step 8)**: post-signup bottom sheet "Unlock OnStandard with Face ID". Opt-in enables **biometric app-unlock**: on cold start with a stored Keychain session, native gates the WebView behind `expo-local-authentication` (new dependency) before revealing the app. Not a password replacement; toggle lives in Settings; skip is one tap. Devices without biometrics never see the sheet.

## 7. Client flow adaptation

Same discovery pattern, different nouns, light touch:

- Client step "Your gym or trainer": search orgs of type gym/training, pick trainer, enter client code → instant connect; same fallbacks (direct code / skip).
- Client "Your Standard" gets the same two-faced treatment using the general (non-athlete) profile weights and habit-oriented copy; same hold-to-commit.
- Client account step reuses the step-7 component wholesale.
- No other client-flow redesign in this spec.

## 8. Data model & backend changes (authored only — founder applies at go-live, per 0022 guardrail)

New migration(s):

1. `athlete_profiles.dob date` (athletes only; staff don't provide DOB).
2. `profiles.tos_accepted_at timestamptz`, `profiles.tos_version text`.
3. `profiles.committed_at timestamptz` (the standard commitment) + `athlete_profiles.standard jsonb` (solo knobs: meals/day, reminder pressure) — coach-connected athletes inherit the team standard, nothing stored per-athlete.
4. `join_team(code text)` SECURITY DEFINER RPC (re-validates code, inserts roster membership, idempotent) — only if no equivalent join RPC already exists (implementation task: audit existing join path first).
5. Edge function `org-directory` (anon search + code preview, rate-limited) — Deno function, not a migration.

Existing infrastructure reused, not rebuilt: `orgs` city/state + dedup index + seed (0022), `teams.join_code` + `discoverable` (0001/0022), `create_team` RPC (0022), `search_orgs`/`find_org` (0031, used by authenticated staff flows), `gen_join_code()`, signup-role persistence (0047), RT.ob backfill on delayed email confirmation.

## 9. Edge cases & error handling

- **Invalid/expired code**: inline shake + "That code didn't match. Check with your coach." Never reveals whether a code exists vs. is wrong.
- **Duplicate email**: inline error + sign-in link; answers retained.
- **Network failure at signup**: answers retained in `RT.ob`; retry CTA; no partial server state (org/roster writes happen only after a session exists).
- **Email confirmation required**: existing flow retained — after confirming and signing in, `persistOnboarding()` backfills profile AND redeems the held code.
- **Under-13**: hard block, friendly copy, link to privacy policy. No data persisted beyond the local session.
- **Directory returns nothing** (early-days reality): search empty-state leads with the fallbacks ("My school isn't listed? Enter your coach's code or skip — you can connect anytime.") so it never feels broken.
- **Apple sign-in cancel/failed**: return to step 7 untouched.
- **Reduced motion**: hold-to-commit degrades to tap-to-commit; progress/step transitions degrade to fades.

## 10. Out of scope (explicit)

- NCES/IPEDS bulk school import (separate data-ops step, per 0022).
- Under-13 guardian-consent signup; changes to the existing post-signup parent invite.
- Coach roster management UI (remove athlete etc.) beyond what exists.
- Per-coach directory-listing opt-out ("hide my name") — noted for later.
- Notification system, Home, Action Hub, Plan, meal logging (later specs).
- Applying migrations to the live database (authored only).

## 11. Testing

- **Parity/unit**: strength-meter heuristic, DOB/age validation (boundary: 13th birthday today), adaptive standard generation per goal — plain JS units alongside the proto (pattern: existing `day.js` parity tests in `src/core`).
- **RPC/RLS**: `join_team` idempotency + wrong-code behavior; `org-directory` never returns `created_by` or join codes; rate-limit behavior. SQL tests colocated with migrations as today.
- **Flow QA script**: back/forward data retention across all 7 steps; skip paths (school, coach); code path vs. solo path rendering of step 6; email-confirmation backfill including code redemption; Apple path; Face ID opt-in/skip/settings-toggle.
