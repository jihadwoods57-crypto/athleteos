# Council Ruling: Reward consistency with a separate, honest streak surface (Option B + one grace day)

**Date:** 2026-07-02
**Decision type(s):** Accountability science (primary) + Product & features
**Council seats:** Athlete end-user, Product strategist / moat-keeper, Behavior / habit-science expert, Coach / trainer end-user — judged by head of product

## The question
OnStandard's daily Accountability Score (`0.5·nutrition + 0.25·recovery + 0.15·tasks + 0.1·checkin`) is a fresh single-day snapshot — "what you did TODAY" — with no memory of yesterday. Nothing rewards stringing good days together. **How should OnStandard reward consistency over time?**

- **A — Daily-only (status quo):** score stays purely today's; consistency lives only in the trend chart + "this week" delta.
- **B — Separate streak surface:** a distinct "N days on standard" indicator shown alongside the score, never folded in.
- **C — Consistency multiplier:** recent consistency nudges the daily number up/down.

## Evidence gathered
Parent agent read the real OnStandard repo (`src/core/scoring.ts` in full; head of `src/core/adherence.ts`; grepped `src`), and **bounded coverage was stated honestly** — which mattered: the initial briefing wrongly asserted "no streak mechanic exists." During the debate the personas read the repo themselves and **corrected the record**, verified afterward by the controller:

- `currentStreak()` and `COMPLIANCE_THRESHOLD = 80` **already exist** in `src/core/history.ts` (with tests in `history.test.ts`), including `seedPad` and `HISTORY_CAP = 14`.
- The streak flame is **already rendered** in `src/screens/athlete/Home.tsx` (≈lines 150–158), with `seedPad = !isReal` so a real account should show earned days only.
- So the streak surface is ~80% shipped; the genuinely-open questions are the **miss/grace policy**, the **honest day‑0 label**, and **coach telemetry** — not whether to build it.

Coverage note: no live-app walkthrough and no competitor teardown were run; streak-app patterns (Duolingo streak-freeze, etc.) were reasoned from model knowledge, flagged as unverified.

Process note: 4 opening positions; cross-examination returned 3 of 4 (the athlete R2 agent hit a structured-output retry cap and was dropped); the judge still resolved decisively. The vote was **4–0 for B**, C unanimously killed.

## Vision
OnStandard rewards consistency with a **separate, honest** streak surface — "N days on standard" — that lives beside the daily Accountability Score and is never folded into it. The daily number keeps meaning exactly "what you did today" (a zero-effort day still reads near 0); consistency gets its own dopamine loop as a pure function over already-persisted `DayScore` history. Forgiveness is **one earned, visible grace day per rolling 7** — not a hard reset, not an infinite freeze. This ships mostly as a finish-and-harden job on code that already exists (`currentStreak()` in `history.ts`), not a scoring redesign.

## The decision
**Option B (separate streak surface), synthesized with one earned grace day.** Option C (consistency multiplier) is **permanently cut** on constitution grounds — it makes today's number lie about today to reward yesterday, the exact "feel-good 57 / this is fake" trust-kill the founder's D‑B ruling and prior persona reviews already flagged as the #1 problem. All four voices independently chose B and killed C.

The three live questions, resolved:

1. **Qualifying bar:** a day is "on standard" at score **≥ 80** (the existing `COMPLIANCE_THRESHOLD`), reused unchanged — the same bar the coach alert fires on. One number across streak / coach-alert / weekly-on-plan = one system. The coach's protein‑AND‑80 gate is right in spirit but not cleanly buildable in v1: `scoreHistory` is `DayScore[] = {date, score}` only, with **no persisted per-day protein flag**, so gating on protein forces a new capture field and destroys the "pure read over existing history" property. Deferred, not designed-in.
2. **Miss policy:** **one grace day per rolling 7**, then an honest reset to 0 on a second miss. Strategists opened wanting a hard reset and conceded under the behavior-science argument: zeroing a 40‑day chain on one sick day asserts something factually false about the athlete's trajectory and is the precise trigger of the what‑the‑hell effect (abandonment). Grace never touches `athleteScore`, so the daily-score honesty firewall is untouched. Decay‑to‑half was cut (the habit-scientist withdrew it on cross-exam).
3. **Today stays live and honest:** below 80 right now ⇒ "at risk / breaks today," never a false green. `currentStreak()` already enforces this (`liveScore < threshold` returns 0).

**Migration from today's daily-only score:** essentially none at the scoring layer — `computeDerived()` is never touched. This is additive UI plus one pure branch on `currentStreak()`.

## Feature priorities
| Priority | Feature | Why | Motivated by |
|---|---|---|---|
| 1 | Harden the `seedPad` honesty guard (real athlete = earned days only) | A faked multi-day flame on a 1-day real account is the "this is fake" trust-kill at first impression | Board-review item 8 (2026-06-27, "Not addressed"); verified `Home.tsx:85`, `history.ts` seedPad param |
| 2 | Plain-English "N days on standard" label + honest day‑0 state | Flame shows a bare `{streak}`; a non-technical parent/coach must read it as accountability, and day 1 must say "Day 1 — this builds as you log" | Verified `Home.tsx:151,156` render bare `{streak}`; isDay0 discipline already proven on the trend delta |
| 3 | Unified qualifying bar at `COMPLIANCE_THRESHOLD = 80` | Streak bar = coach-alert bar = weekly-on-plan bar; three thresholds would be three products | `history.ts:129-131`; convergence after habit-scientist withdrew his 70 proposal |
| 4 | One grace day per rolling 7 with a visible "grace used" pip | Prevents what-the-hell abandonment from a hard reset while staying honest — the athlete SEES the forgiveness spent | Both end-users and both strategists converged post-cross-exam; `currentStreak()` is a clean consecutive-count today |
| 5 | Coach telemetry: display-only, non-sortable streak + broken-streak line | Streak-as-telemetry is the moat over teen-dopamine streak apps, but must never be the roster sort key or an alert | Coach must-have #4; unanimous that no streak alert avoids surveillance vibe |

## Phase plan
1. **Phase 0 — Harden the honest core** (this sprint, blocking, zero new math). Audit `seedPad = !isReal` (`Home.tsx:85`) on every render path; add the plain-English "N days on standard" label; add the honest day‑0/empty state; confirm today-live honesty; fix the stray backslash comment near `Home.tsx:84`. No changes to `computeDerived()` or `scoreHistory` shape.
2. **Phase 1 — Grace day** (fast-follow, flag-gated, one pure branch). Extend `currentStreak()` with a single branch: skip one sub-threshold day if no grace used in the trailing 7; a second miss ends the streak at 0. Add the "grace used" pip. Unit-test against `history.ts` fixtures. No decay, no half-credit, no purchasable freeze.
3. **Phase 2 — Coach telemetry** (defer, display-only). PersonDetail shows current streak + a broken-streak intervention line ("was 9, reset Tuesday"); optional muted roster flame. Explicitly non-sortable, never an alert trigger; red-today always outranks a long chain.
4. **Phase 3 — Post-launch, data-armed** (defer, placeholder). Longest-streak/personal-best memory line; any re-litigation of the miss policy with real retention data; revisit protein-gating only if a per-day `proteinMet` flag gets persisted.

## Cut list
Permanently cut (constitution grounds, unanimous): (1) Option C consistency multiplier; (2) decay-to-half / partial-credit on a break; (3) streak-freeze economies / buy-a-freeze / repair tokens; (4) social/squad streak leaderboards; (5) weight folded into the streak; (6) push-notification streak-loss guilt-bombs; (7) streak-driven coach alerts or roster re-sorting. Deferred (not cut): longest-streak memory line; protein-AND-80 gate (blocked until a per-day `proteinMet` flag is persisted); milestone badges beyond a quiet 7/30/100 marker; sharpening the "this week" delta (the streak chip now carries the consistency story).

## Open questions for the founder
1. **Grace cadence:** confirm "one grace day per rolling 7" as the launch value (vs 1/10 or 2/14) — a design judgment, not tested against real miss-rate data; tunable post-launch.
2. **Qualifying bar — 80 vs protein-AND-80:** ship 80-only now, or invest in persisting `proteinMet` first? **Recorded dissent:** the coach holds that a check-in-plus-one-meal-survivable streak is "a lie I'll have to explain to a parent"; 80-only mitigates but doesn't fully satisfy him.
3. **Grace flag-dark vs live at launch:** strategists want it validated dark; end-users want it live so a first missed day doesn't churn a new user.
4. **Coach-view scope for v1:** is the broken-streak intervention line in scope for launch, or strictly post-launch? It's the moat differentiation but also the most surveillance-adjacent surface.

## Next step
Do **Phase 0 now**: audit the `seedPad = !isReal` guard (`Home.tsx:85`) across every render path to prove a real account can never show a padded flame, then add the plain-English "N days on standard" label and the honest day‑0 state to the existing flame chip (`Home.tsx:150-158`). This closes the one logged honesty debt (Board-review item 8), makes the already‑80%‑built surface legible, touches no scoring math, and ships this sprint.
