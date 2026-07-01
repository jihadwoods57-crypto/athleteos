# OnStandard — Night Shift Report (2026-06-21 → 2026-06-22)

## 2-minute summary

The crew shipped **8 feature/fix commits + 3 docs commits to `master`** overnight. Every commit ends with the full gate green, and the gate is still green right now:

- `npx tsc --noEmit` — **0 errors**
- `npx jest` — **165 tests pass** across 8 suites
- `npx expo export -p ios` — **bundles successfully** (2.9MB iOS bundle)

**What shipped (plain English):** Two themes, both pointed straight at the product thesis — *"is this athlete actually doing what they're supposed to be doing?"* — plus a handoff-driven UX polish pass.

- **The headline score now tells the truth across sessions and screens.** The most-seen surface in the app, the Home score-hero, used to hard-code "on pace to hit every weekly goal" and "Top 12%" for *every* athlete no matter the reality; now its status line and standing badge react to real state, and it stops nagging a fully-compliant athlete (all four meals logged, protein cleared) that they still have something "to go" on a sub-90 day. The Home AI insight no longer falsely claims "Day complete — every meal logged" when only dinner is in. The meal-analysis quality badge label now tracks its own score (an 89 no longer reads "EXCELLENT" against its own color).
- **Yesterday's score is now computed honestly.** A real cross-session bug: the coach's enabled check-in questions (`ciConfig`) weren't being persisted, so the archived prior-day recovery score was recomputed from *defaults* — feeding a wrong historical score into the headline trend and delta. `ciConfig` is now in the persisted whitelist, restoring the documented day-rollover invariant.
- **A reload no longer logs you out.** Previously every refresh discarded the session and forced re-onboarding (the single most session-destroying bug in the app). Session identity — flow, role, onboarding identity — is now persisted with a legacy-blob merge guard, so a reload lands the user back where they were.
- **The "Log dinner" task can't drift.** Task id 3's done-state is now derived from `meals.dinner` in the scoring engine (mirroring the already-shipped task-2 fix), so a manual toggle, a legacy blob, or the archived snapshot can't desync the visible Tasks row from reality.
- **Polish:** overlays now animate in with the handoff's `aos-up` slide-up + fade, reduce-motion aware, landed in the single shared `Overlay` primitive so all four overlays inherit it at once.

**What was reverted + why:** Nothing was reverted. All 8 candidate jobs shipped; no resets, no force-pushes, no installs. `src/core` stayed pure TS — every score-engine change is unit-tested with no RN imports.

**What needs the founder:** Nothing blocking. Three notes for awareness:
1. **Visual sign-off on the overlay animation + hero copy.** The motion and the reactive hero status are type-safe and export clean, but this crew can't visually QC on device — a real eyes-on click-through of the slide-up overlays and the hero status line is worth a minute.
2. **A phase-2 backend spec was added** (`docs/specs/phase2-multitenant-backend.md`) describing a multi-tenant data model + RLS for coach/trainer/parent links. It is a spec only — no backend code shipped — and is the natural next-session anchor if you want the role views wired to real linked athletes.
3. **This report file is not committed** (left for you to review first), and the throwaway `.aos-export` dir was cleaned up.

---

<details>
<summary><b>Full play-by-play</b></summary>

### Run window
First night-shift commit `0ecf08f` at 2026-06-22 17:32 → HEAD `042436f` at 2026-06-22 19:10. Branch: `master`. Branch is ahead of `origin/master` by 5 commits (not pushed, per the rules).

### Verification at report time
| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no errors |
| `npx jest` | 8 suites / 165 tests pass |
| `npx expo export -p ios` | success, 2.9MB hbc bundle + metadata |

### The 8 shipped jobs (in commit order)

**1. `b9d28bf` — Persist `ciConfig` so the archived prior-day recovery score reflects coach-enabled questions**
`dayRollover.ts` documents that `DAY_DEFAULT_KEYS` must stay in sync with `partialize`, yet `ciConfig` — which drives the recovery branch of the score — was absent from the persisted whitelist. The result was a wrong historical `athleteScore` feeding the headline trend and `scoreDelta`, the heart of the thesis. Fix: one whitelist line plus a focused pure test. Fully revertible, verifiable via jest/tsc/export with no render. Also a strict prerequisite-protector for the recovery-polarity work.
Verified: `src/store/useStore.ts:303` `ciConfig: s.ciConfig` now inside `partialize`; `src/core/dayRollover.test.ts` adds 84 lines of coverage.

**2. `2320d0d` — Gate Home `aiInsight` "Day complete" on all meals logged + protein target**
The insight falsely claimed "Day complete — every meal logged and protein over target" when only dinner was logged — a user-visible correctness lie against the accountability thesis.
Verified: `src/core/content.ts` + 29 added test lines in `content.test.ts`.

**3. `fb938f2` — Persist session (flow + role + onboarding identity) across reloads**
`partialize` omitted flow/role/identity, `createInitialState` seeds `flow:'onboarding'`, and `Root.tsx` switches solely on `flow` — so every reload discarded the session and forced re-onboarding (the explicit "Refresh logs you out" open item). Fix: additive `partialize` change plus one merge guard; the new fields are deliberately excluded from `DAY_DEFAULT_KEYS` so the rollover invariant stays green.
Verified: `src/store/useStore.ts:267-269` persist flow/role/identity; the legacy-blob guard at `:323` (`if (p.flow == null) merged.flow = 'onboarding'`) keeps new installs clean; `useStore.test.ts` adds 109 lines.

**4. `66c0f66` — Reactive Home score-hero status line + standing badge (pure-core `heroStatus`)**
The hero is the most-seen surface and lied to every athlete ("on pace to hit every weekly goal", "Top 12%"). New pure-core `heroStatus` helper drives the status line + standing badge from real state; near one-line UI swap in `Home.tsx`. Mirrors the founder-blessed `aiInsight` pattern.
Verified: `src/core/content.ts` +50 lines, `Home.tsx:` updated, `content.test.ts` +78 lines.

**5. `ad4b2e4` — Animate overlays in with `aos-up` slide-up + fade (reduce-motion aware)**
Closes a named handoff animation gap. Landed in the single shared `Overlay.tsx` primitive (used by Notifications, Account, MealDetail, PersonDetail), so one change propagates to every overlay. Reduce-motion gate advances the a11y lane for free. Zero core/store coupling.
Verified: `src/screens/overlays/Overlay.tsx` — 39 insertions.

**6. `d21049b` — Stop `heroStatus` nagging a finished athlete "to go" on a sub-90 complete day**
Telling a fully-compliant athlete (all four meals logged, protein cleared) they still have something "to go" punished the exact behavior the app exists to reward. Same false-claim class as #2/#4. Pure-core, sub-ten-line diff.
Verified: `src/core/content.ts` +14, `content.test.ts` +24.

**7. `d4ee9ce` — Drift-proof the "Log dinner" task (id 3) from `meals.dinner` in `computeDerived`**
The store set task 3 done only inside `addMeal`, but `computeDerived` trusted the raw stored flag for id 3 while only id 2 was drift-proofed. A manual `toggleTask(3)`, a legacy blob, or the archived prior-day snapshot via `recordDayScore` could desync `meals.dinner` from the task-3 flag, so the Tasks row, `tasksDone`, and the `tasksScore` sub-score could lie. Serves the row-cannot-lie invariant. Exactly parallel to the shipped task-2 fix.
Verified: `src/core/scoring.ts` now derives id 3 alongside id 2; `scoring.test.ts` +102 lines.

**8. `042436f` — Make the meal-analysis quality badge label track its score**
An active on-screen fidelity bug: 89 labeled "EXCELLENT", contradicting its own color branch. The handoff shows the badge tracking the score. Durable fix lands in pure testable core plus one screen line, permanently coupling text to color.
Verified: `src/core/content.ts` +19, `MealCapture.tsx` updated, `content.test.ts` +37.

### Supporting docs commits (this run)
- `0ecf08f` (17:32) — `docs(priorities)`: next-session focus = UX/UI design polish, handoff-grounded.
- `dfacfb6` (17:47) — `docs(design)`: PRODUCT.md + DESIGN.md impeccable context; UX jobs driven through the impeccable command suite.
- `7fa18cb` (in run) — `docs(spec)`: phase-2 multi-tenant backend data model + RLS (coach/trainer/parent links), 156 lines, spec only.

### Notes
- No reverts. No reset/force operations. No installs. No external sends, no pushes.
- `src/core` stayed pure TS; all score-engine changes are unit-tested with no RN imports.
- The pre-existing report content (prior run `106252f`…`71b05c3`) was superseded by this run's report; those commits remain in history and appear at the bottom of the extended log.

### `git log --oneline -11`
```
042436f fix(nutrition): make meal-quality badge label track its score
d4ee9ce fix(scoring): drift-proof "Log dinner" task (id 3) from meals.dinner
d21049b fix(hero): stop nagging a finished athlete on a sub-90 complete day
ad4b2e4 feat(overlays): animate overlays in with aos-up slide-up + fade
66c0f66 feat(home): react score-hero status line + standing badge to real state
7fa18cb docs(spec): phase-2 multi-tenant backend — data model + RLS (coach/trainer/parent links)
fb938f2 feat(store): persist session (flow + role + onboarding identity) across reloads
2320d0d fix(home): gate aiInsight 'Day complete' on all meals logged + protein target
b9d28bf Persist ciConfig so the archived prior-day recovery score reflects the coach-enabled questions, not defaults
dfacfb6 docs(design): add impeccable context (PRODUCT.md + DESIGN.md); brief drives every UX job through the impeccable command suite
0ecf08f docs(priorities): next session focus = UX/UI design polish (handoff-grounded)
```

</details>
