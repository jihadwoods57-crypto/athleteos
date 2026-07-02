# Council Ruling: The Trust Pass — earned camera-free days, credited at your own proven baseline

**Date:** 2026-07-02
**Decision type(s):** Product & features + Accountability science + Architecture & eng
**Council seats:** Athlete end-user, Product strategist / moat-keeper, Behavior / habit-science expert, Coach / trainer end-user, Expo/RN + Supabase architect — judged by head of product
**Status:** Founder-directed design. **Supersedes the *framing* of** `2026-07-02-primary-daily-signal.md` (keeps its concrete calls: retire the fake checklist, move its 0.15 weight to the commitment, two-streak model, un-passed one-tap can't reach 80). All code claims controller-verified.

## The question
The founder (a head coach) **decided to build** an earned "Trust Pass": prove yourself and the coach lets you go camera-free for a stretch, during which your daily one-tap "yes" counts as a real day. The council's job was **not** whether to build it, but to design the honest mechanics and guardrails — above all: *how can a pass-day one-tap credit a real ≥80 day when the honesty firewall for everyone else is "no photo → nutrition scores 0"?*

## Evidence gathered
Three parallel repo audits (HEAD `5c04ec1`) + the two prior rulings. **Controller-verified** the three load-bearing facts: (1) the recovery leak — `scoring.ts:293` blends `recoveryScore` unconditionally while `recoveryScoreIsReal` is computed at 242, and `checkinScore=100` on bare submit (285) → every no-check-in day leaks 0.25×86 = **21.5 unearned points today**; (2) `dayRollover.ts:71-73` already persists the per-day **earned** nutrition sub-score into `nutritionHistory` (the trailing baseline is a real read, not a rebuild); (3) no median helper exists. 5 opening positions, 5 cross-exam, judge resolved.

## Vision
The Trust Pass is a coach-granted **status object — a varsity jacket, not a shortcut**. When a proven athlete goes camera-free, his one-tap "yes" credits a real on-standard day worth **exactly what his own camera already proved he does** — never a gift number, never a reweight, never more than his tape. The pass frees the camera; it never frees the honesty. Every green stays legible: a parent can always tell a photo-verified green from a trust-credited green. Honesty is always the mathematically safe move — an honest "no" can never cost more than a dishonest "yes."

## The mechanic (the decision)
On an active, coach-granted pass day, the one-tap answer **replaces the missing photo-derived nutrition sub-score**:

```
base = median( last N=10 REAL photo-earned nutrition sub-scores from nutritionHistory )
nutritionScore = f(answer) * base      where  f(yes)=1.0, f(partial)=0.6, f(no)=0.0
```

That value flows through the **unchanged** `0.5·nutrition + 0.25·recovery + 0.15·tasks + 0.1·checkin` blend. **No reweight** — the parent view still reads a real nutrition number, tagged "on trust pass."

**Median, not mean** (equal build cost — neither helper exists): median is "worth what you do on a normal day," not "worth your best day." `[55,58,60,62,97]` → mean ~66 vs **median 60**; a hero-plate can't inflate a coaster's credit. This is the entire honesty claim and makes the spot-check tolerance fair.

### Four structural locks (by construction, not rules that can drift)
1. **No pass → no substitute.** Un-passed kids still get `nutrition = 0` without a photo (`scoringProfiles.ts:108-109` unchanged). The substitute lives only inside the server-authoritative pass branch. Firewall intact.
2. **No baseline → no pass.** Ungrantable until **≥7 real on-standard photo days** exist, counted **server-side** from `nutritionHistory` rows the athlete can't write. You can't pass a baseline into existence you never built.
3. **Honesty invariant is mathematical.** yes/partial/no all derive from the same base with f = 1.0 / 0.6 / **0.0** → `scorePassDay('no') ≤ ('partial') ≤ ('yes')` always. "no" = 0.0, **not** 0.25×base (that's the banned participation floor sneaking back through the pass branch). Unit-tested to lock against drift.
4. **Recovery leak fixed first, globally, pre-beta.** Gate `recoveryScore` on `recoveryScoreIsReal` in the base blend for **everyone** (unsubmitted → recovery contributes 0); bare-submit check-in must not float a day. Without this a pass "yes" reaches ≥80 on ~31 borrowed points; with it, a pass "yes" clears 80 on the strength of the real nutrition median **alone or not at all**.

### Spot-check + "claim doesn't match"
Server-scheduled (Supabase, RLS coach-write/athlete-read), **platform-owned randomness** (coach picks a band Light/Standard/Strict ≈ 1-in-7 to 1-in-5 pass days; never day 1; cooldown against back-to-back; seeded so no two kids fire the same day). **Pre-consented at grant** ("some days I'll ask you to prove it — that's the deal"). Fires as a same-day push "Prove it — snap today's meals." On a check day the one-tap is **replaced by the camera** and the day scores by the normal photo path (a real logger loses nothing). Camera is the only referee — no fuzzy logged-vs-claimed guessing. **Two failure modes, different consequences:**
- **Ghost** (no photo by deadline) = **hard fail, pass ends first time.** You can't build trust by refusing the one day it's verified.
- **Contradicted claim** (photo present but real nutrition lands **>20 pts under** his crediting median) = **one soft-fail warning + pause pending coach; second contradiction ends it.** One bad plate isn't a lie; a pattern is.
- An honest partial/no on a normal day never triggers or fails a check.

### Staleness decay (closes the coast-forever hole; forward-only)
The baseline is **frozen against upward gaming** (only real logged days refresh it), but the **credit decays ~2 pts/day after ~10 camera-free days**, pushing toward needing a real log and triggering the next spot-check. Touches zero past days — bleeds only today's credit forward, so it's not a retroactive rewrite. **No truly-open (no-decay) pass exists.**

### Revocation
Coach one-tap "End trust pass" anytime (neutral "pass ended," optional reason — pulling it for team reasons is not branding a kid a cheater) + auto-end on hard fail / second soft fail. **No clawback ever** — a burn ends crediting **going forward only**; every already-earned pass green stands. Retroactively deleting a green a parent already saw is the single most trust-destroying thing the number can do. From the burn forward the kid is photo-required-for-80.

### Streak interaction (two streaks kept)
A pass "yes" extends the **on-standard (≥80)** streak *only if* the credited median actually clears 80 (the pass frees the camera, not the bar), and that day is **tagged "trust-credited"** so a later failed check can break the tagged run without maliciously zeroing prior days. The **showed-up** streak ticks on any answered day. An honest sub-80 pass day breaks the on-standard streak normally but never burns the pass.

### Render + state
Every trust-credited green carries a distinct chip — **"On standard — Trust Pass"** vs **"On standard — photo verified"** — including the very first one (parents are the #1 fake-detector). Ships **with** the pass, never deferred. Pass grant, eligibility count, spot-check schedule, and verdict are **Supabase DB-truth, RLS coach-write / athlete-read**, client-cached for engines-OFF/offline. A client-flippable flag or client-authored eligibility count is a cheat vector. (Constitution #13: the platform owns *how* a pass-day credits.)

## Gaming edges & defenses
1. **Cold-start free green** → eligibility gate (≥7 real on-standard days, server-counted). 2. **Hero-plate inflation** → median not mean. 3. **Borrowed-points green** (recovery 86 + checkin 100) → the global recovery-leak fix. 4. **Coast forever on one good week** → staleness decay + triggered spot-check. 5. **Ghost the spot-check** → missed snap = hard fail first time. 6. **Lie "yes" because honesty is punished** → hard invariant: honest no/partial never below a dishonest yes, never burns the pass. 7. **Client-flip the pass / spoof eligibility** → server-authoritative state. 8. **Game an auto-earn trigger** → hand-grant only for v1. 9. **Pattern the spot-check** → platform-owned seeded randomness.

## Phase plan
1. **PRE-BETA (blocking floor — small, engines-OFF, client-computable).** (1) Global recovery-leak fix (`scoring.ts:293`). (2) Universal one-tap floor (yes/partial/no); un-passed kids advance showed-up only, never reach 80. (3) Retire the fake static checklist + move its 0.15 weight to the commitment. (4) Rolling-median helper over `nutritionHistory` (the per-day earned sub-score is already persisted). (5) Unit-test the honesty invariant `no ≤ partial ≤ yes`.
2. **FAST-FOLLOW (the pass — Supabase schema + coach UI + scheduler).** Pass row + RLS as DB-truth; the trailing-median substitute in the pass branch; the ≥7-day eligibility gate; staleness decay; the randomized spot-check engine with the two-tier verdict; revocation (no clawback); the "Trust Pass" render chip; coach config = team default off + per-kid override, **hand-grant only** at launch. Ship to a hand-picked coach pilot.
3. **NEXT CYCLE (after watching real coaches).** Streak-of-X and score-bar-Y auto-earn modes wired against observed behavior; grace-day-per-7 × pass interaction; possible bulk grant if pilot coaches demand it.

## Cut list
Fixed on-standard value **and** reweight (both manufacture/hide a number a coach can't defend to a parent); **auto-earn** for v1 (the trigger is itself gameable — hand-grant first); **clawback** / retroactive rewrites; CV meal-photo authenticity ("is this really chicken" — the check compares computed nutrition vs claim, not image authenticity); fuzzy logged-vs-claimed matching; grace-day×pass tangling (ship passes first); multi-athlete bulk / "team trust level"; leaderboards (turn honesty into competition); `no = 0.25×base` floor; any no-decay pass.

## Open questions for the founder
1. **Spot-check miss polarity (the one genuine council split).** This ruling makes a **ghost (no photo) a hard fail first time**, and a **contradicted low plate one soft warning**. **Recorded dissent:** the habit-scientist would soften the ghost case too ("a dead phone isn't a lie"). As a head coach: is refusing the one verification day a hard fail, or does a kid get one "my phone died" pass?
2. **Baseline window + eligibility floor.** Locked N=10 median, ≥7 real on-standard days to be eligible (habit-scientist wanted N=7 for faster grantability; coach/athlete wanted 10). Confirm the floor — lower = passes grantable sooner in beta on thinner proof; higher = more proven but the pilot waits longer.
3. **Pass length + decay onset.** Set to coach-chosen 7/14/30 days, decay starting ~10 camera-free days at ~2 pts/day. Sanity-check against how long you'd actually trust a vet camera-free before re-verifying.
4. **Contradiction tolerance.** Set to ">20 pts under his own median = contradicted." Confirm the band — too tight punishes a normal off-day, too loose lets real coasting slide.

## Next step
**Ship the global recovery-leak fix first, as its own small PR, before anything else.** Gate `recoveryScore` on `recoveryScoreIsReal` in the base blend at `scoring.ts:293` (unsubmitted → recovery contributes 0) and stop bare-submit check-in floating a day. It's a **live fake-green bug today** (every no-check-in day leaks 21.5 unearned points), a hard prerequisite for every honest pass-day number, one gated line + a unit test, and it works engines-OFF. Then the one-tap floor + checklist retirement + median helper complete the pre-beta floor; the full coach-configurable pass is the deliberate fast-follow once real baselines have accrued. **No pass ships until the leak-fix + trailing-median + eligibility gate are in — a pass without them is the banned participation floor wearing a varsity chip.**

---

## Implementation status (2026-07-02)

**Built (client-side, behind `isTrustPassEnabled`, default OFF), all TDD + green:**
- Recovery-leak fix (the hard prerequisite) — shipped as its own PR (`c0cbf21`).
- Pre-beta floor: one-tap plan-commitment replaced the fake task checklist (`fe2a065`).
- Pure Trust Pass math + logic in `src/core/trustPass.ts`: `trailingEarnedNutritionMedian`
  (median-not-mean baseline), `passDayNutritionScore` (f(answer)·base, honesty invariant),
  `passEligibility` (≥7 on-standard days), `passStatus` (active/expired, spot-check, forward-only
  decay), `passDayCredit`.
- State + actions: `trustPass` field (cross-day, persisted) + `grantTrustPass`/`endTrustPass`.
- Engine: `computeDerived` credits a camera-free "yes" at the proven median — **data-gated**
  (no pass ⇒ no-op; the non-pass firewall `nutrition=0 without a photo` is untouched), applied as
  a floor so logging still earns higher and an honest "no" is never masked. New `Derived.nutritionIsTrustCredited` drives the honest render.
- UI: athlete Profile pilot grant/end + eligibility readout (self-grant still gated on real
  on-standard days); Home commitment banner distinguishing "On standard · Trust Pass" from
  photo-verified, and surfacing spot-check days.

**Deliberately deferred to go-live (founder-gated; NOT built here):**
- **Server-authoritative pass state** (Supabase pass row + RLS, coach-write/athlete-read) so a
  pass can't be self-granted by a spoofed client. The pilot uses client state.
- **Seeded-random spot-checks** owned by the server (the pilot uses a deterministic every-5th-day
  check so it's testable and un-patternable-by-code, but not yet random).
- **Coach-grant-to-athlete** across accounts (inherently needs the backend), plus the coach
  telemetry view and revocation UX.
- Requires a live Supabase migration, which is a founder-gated action here.
