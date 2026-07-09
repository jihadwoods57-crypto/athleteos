# OnStandard Autonomous Improvement Crew — Design

- **Date:** 2026-07-09
- **Status:** Design (awaiting founder approval → implementation plan)
- **Target repo:** `c:\Users\Administrator\Downloads\athleteos` (OnStandard, Expo/RN + Supabase)
- **Author:** Fable (with Bo Woods)

---

## 1. Mission (founder's words)

> Continuously transform OnStandard into a world-class production application through autonomous
> inspection, verification, improvement, and validation. The crew identifies the highest-impact
> opportunities across security, architecture, scalability, performance, UX, reliability,
> accessibility, and business value; implements improvements; verifies them through adversarial
> testing; measures impact; and repeats until the application exceeds production launch standards —
> proactively discovering bugs, vulnerabilities, technical debt, design inconsistencies, and launch
> blockers **without waiting for human direction, while preserving stability and avoiding regressions.**

The crew prompts itself. It does **not** trust itself — trust comes from a deterministic oracle and a
founder gate, not from an LLM grading an LLM.

---

## 2. Why this shape (the reasoning)

### 2.1 An assembly line is the wrong shape
The original sketch was a 13-step relay: Product → Security → Architecture → Planner → Engineers →
QA → Perf → UX → Launch, each waiting on the one before. That pays for 13 sequential handoffs and
gets one opinion per step. A crew's real value is two things the relay barely uses:

- **Independent perspectives in parallel** — many agents reviewing the *same code* through *different
  lenses at the same time*, then a synthesis. Not a relay race.
- **Adversarial verification** — every finding and every fix is challenged by a second agent whose
  job is to *refute* it before it survives. This is what kills "plausible but wrong" output.

So the shape is **discovery fan-out → scored funnel → oracle-gated implementation → founder gate.**

### 2.2 The five reasons autonomous loops fail — and the fix for each
This is the fix-list, and the fix-list *is* the design. (OnStandard's prior `onstandard-ai-forge`
crew failed twice and was parked; each failure maps to one of these.)

| # | Failure mode | Fix in this design |
|---|---|---|
| 1 | **No ground truth** — LLM judge rubber-stamps LLM builder | The oracle (`npm run verify`) decides survival, not any agent. See §3. |
| 2 | **Regression drift** — later cycles break earlier work | Git checkpoint + tag every surviving cycle; auto-revert to last-good tag on regress. Forward-only from green. See §5.3. |
| 3 | **Gold-plating trivia** while real holes sit open | Every opportunity scored `impact×confidence÷risk`; strict highest-first; hard **value floor**. See §4.3. |
| 4 | **Token runaway** — "loop until perfect" never ends | Budget ceiling **and** loop-until-dry (K empty rounds → stop and report). See §5.4. |
| 5 | **Sanitizing the product's soul** — generic agents "fix" the honest score into feel-good mush | A **constitution** every agent reads first; violating a non-negotiable is an auto-reject, same as a red test. See §7. |

---

## 3. The oracle (the keystone)

OnStandard already ships a deterministic lie-detector. The crew treats these as ground truth:

```
npm run typecheck   →  tsc --noEmit
npm run test        →  jest            (the full suite; ~1547 tests as of 2026-07)
npm run bundle      →  expo export -p ios --output-dir .aos-export   (proves it actually builds)
npm run verify      →  typecheck && test && bundle          ← FULL GATE
npm run test:rls    →  bash supabase/tests/run.sh           ← SECURITY GATE (RLS enforced)
npm run preflight   →  node scripts/preflight.mjs           (launch checks; informational)
```

- **Cheap gate** (run after every change, fast): `tsc --noEmit && jest`.
- **Full gate** (run once per cycle on the integrated branch): `npm run verify`.
- **Security gate** (added when a change touches `supabase/`, auth, or RLS): `npm run test:rls`.
- **Design gate** (built by the crew — see §6.1): `npm run test:design` (automated a11y + contrast on the web build). Applies to *objective* design fixes only; design **taste** has no oracle and is founder-gated, never auto-shipped.

A change is only allowed to survive if the relevant gate is **green** and no constitution rule is
violated. No agent opinion overrides a red gate; no agent opinion is required when the gate is green.

---

## 4. The cycle (one Workflow run)

### 4.1 Phase 0 — Bootstrap & guard
- Read `.crew/constitution.md` and `.crew/oracle.json` from the target repo.
- Confirm the working tree is clean and HEAD is on the crew branch `crew/YYYY-MM-DD`.
- Record the **last-good tag** (baseline). Run the full gate once to confirm baseline is green; if the
  repo is already red on arrival, stop and report — the crew never builds on a broken baseline.

### 4.2 Phase 1 — DISCOVER (parallel lenses; barrier)
Six agents run concurrently on the same codebase, each carrying the constitution plus one lens
(§6). Each returns **scored findings**:

```json
{ "title": "...", "area": "security|scoring|arch|ux|perf|business",
  "severity": "blocker|high|medium|low",
  "impact": 1-5, "confidence": 1-5, "risk": 1-5,
  "file": "path", "line": 123, "evidence": "why this is real",
  "proposed_fix": "one-paragraph approach" }
```
Barrier here (not pipeline) because the next phase must dedup across **all** lenses at once.

### 4.3 Phase 2 — PRIORITIZE (one synthesizer)
- Dedup findings across lenses (same file+area collapse).
- Compute `priority = (impact × confidence) / risk` (range 0.2–25).
- Drop everything below the **value floor** (default: `priority ≥ 4.0` AND `severity ≥ medium`).
- Select up to **N** opportunities for this cycle (default N = 3), highest-first.
- If nothing clears the floor → increment the **dry-round** counter and skip to Phase 5.

### 4.4 Phase 3 — IMPLEMENT → VERIFY (serial; oracle-gated)
For each selected opportunity, **one at a time** (per founder ruling — parallel discovery, serial
implementation for clean regression attribution and no worktree/`node_modules` trap on Windows+Expo):

1. **Implement** the change, following existing repo patterns.
2. **Adversarially verify** — 2 verifiers with distinct lenses (correctness, constitution+regression),
   each prompted to *refute*; default to "rejected" if uncertain. Majority-refute kills the change.
3. **Cheap gate** — `tsc --noEmit && jest`. Red → discard this change (revert), log why, move on.
   Green + survived refutation → keep staged.

### 4.5 Phase 4 — INTEGRATE & CHECKPOINT
- With all surviving changes staged on the crew branch, run the **full gate** (`npm run verify`, plus
  `npm run test:rls` if any change touched security/RLS).
- Green **and not regressed** vs. baseline → `git commit` + `git tag crew/YYYY-MM-DD-iN`; update
  `.crew/best.ref` to the new tag; advance baseline.
- Red or regressed → **revert to the last-good tag** (regression guard). Log the casualty.

### 4.6 Phase 5 — JUDGE & LOG
- Append to the run report (`.crew/reports/YYYY-MM-DD.md`): what shipped, priority scores, oracle
  deltas (tests before/after, bundle ok), what was rejected and *why*.
- **Outer loop:** `while (budget remaining AND dry-rounds < K) → next cycle`. Otherwise write the
  morning report and stop. **Master is never touched.**

---

## 5. Reliability rails

1. **Constitution gate** (§7) — a change that violates a non-negotiable is auto-rejected.
2. **Oracle gate** (§3) — cheap gate per change, full gate per cycle.
3. **Regression guard** — integrated branch must not regress vs. last-good tag or it auto-reverts.
4. **Value floor + loop-until-dry** — no trivia; honest stop when the well runs dry (K = 2 default).
5. **Budget ceiling** — hard token cap per run (configurable; see §9).
6. **Branch + tag + report, never auto-merge** — founder merges in the morning after reading the report.

### 5.7 Hard guardrails — actions the crew must NEVER take autonomously
- Never apply live database migrations. It may *author* a migration file and flag it; the founder
  applies it per the go-live runbook.
- Never deploy edge functions to live, never run `eas build`/`eas submit`/`npm run ship`.
- Never touch Stripe, EAS, or App Store secrets.
- Never merge to `master`.
- Never delete or weaken a test, and never relax a constitution rule, to make the oracle green.
- Never weaken RLS or a security check to pass.

---

## 6. The crew roster (specialized, not generic)

Every agent boots by reading the constitution first.

| Role | Lens / job | OnStandard knowledge it carries |
|---|---|---|
| **Security & RLS Auditor** | auth, RLS, XSS, PII, minor consent, AI cost caps | team-scoped RLS on every table; `test:rls`; guardian XSS; minor-consent gate; spend caps; `notify()` forgery |
| **Scoring-Truth Auditor** | the honest-score engine | N50/R25/C15/K10 weighting; weight-never-scored; trust-pass median firewall; goal-aware targets (never tell lose-fat to gain); photo-only path to ≥80 |
| **Architecture & Scale Reviewer** | data model, edge fns, realtime, tech debt | Supabase edge functions, migrations, role hydration on fresh sign-in, memory flywheel |
| **Design, UX-honesty & A11y Reviewer** | visual design + surfaces that don't lie + accessibility; **screenshots the running web build** (§6.1) | :8124 master proto as reference, green-forward brand, honest error states, 4-role surfaces, live roster shows silent athletes, no demo-as-default, no AI-slop aesthetics |
| **Performance Reviewer** | AI latency/cost, query perf, bundle | prompt caching on AI fns, daily AI cap, N+1s |
| **Business-Value Reviewer** | retention/revenue leaks | billing rail, referral, churn A/B, add-ons |
| **Synthesizer / Prioritizer** | dedup + score + value-floor | owns the cycle's work list and the stop decision |
| **Implementer** | makes one change, follows patterns | — |
| **Adversarial Verifiers (×2)** | *refute* the change | default to "rejected" when uncertain |

---

### 6.1 The Design & UX role — a seeing role with a human oracle

Design quality has **no machine oracle** — no test proves a screen is well-designed; that's *taste*,
and taste is a founder call. So this role is wired differently from the bug-fixers (founder ruling
2026-07-09 — option B):

- **It sees.** It boots the web build (`npm run web`, react-native-web) and drives it with Playwright to
  **screenshot every key screen** — Welcome, the tabs, breakdown, onboarding, all four role surfaces.
  (The OnStandard analogue of the `coach-eye` skill: screenshot → subagent critique → findings.)
- **It judges against a design constitution** (`.crew/design.md`): the **:8124 master proto** as
  reference truth, green-forward brand, the honest-surface rules (from §7), a11y thresholds, and "no
  generic AI-slop aesthetics." Findings are scored like any lens, tagged `design`.
- **Findings split by whether they're provable:**
  - **Objective** (a11y violation, contrast below threshold, genuinely broken layout) → gated by a
    **design oracle the crew builds first**: `npm run test:design` (automated a11y + contrast on the web
    build). Once it exists, these auto-ship through `test:design` + the code oracle, like any fix.
  - **Taste** (hierarchy, spacing, rhythm, "feels off") → **not shipped.** They become before/after
    screenshot **proposals in the morning report**; the founder is the gate.
- **The crew's first design act is to build `test:design`** — converting the objective slice of design
  from unprovable to provable. Until it exists, *all* design findings are advisory (report-only).
- **Model/effort:** the design lens and any design-judge run on Opus 4.8 at high (vision + rubric, not
  Fable's long-horizon specialty).

---

## 7. The constitution (`.crew/constitution.md`, committed in athleteos)

Non-negotiables. A change that violates any of these is auto-rejected, regardless of test status.

**Scoring truth**
- Score weighting is N50 / R25 / C15 / K10. Do not re-weight.
- **Weight is tracked, never scored.**
- Trust-pass day credit = `f(answer) × trailing median of last 10 photo-earned days`; the median
  firewall stays; grace is 1 per 7. Never let a pass day exceed the photo-earned median.
- Targets are **goal-aware**: a lose-fat athlete is never told to gain.
- Photo logging is the only path to a score ≥ 80.

**Security & privacy**
- RLS is team-scoped on every table. Never weaken it.
- Minor/parent consent gate stays enforced; guardian input is sanitized (no XSS).
- Notifications are server-authoritative; `notify()` cannot be forged by a client.
- AI spend caps and the daily cap stay in force.

**Honesty**
- Error and empty states tell the truth; no feel-good mush that hides a real state.
- The coach's live roster shows silent athletes; demo data is never the default state.
- AI never fabricates meal metadata; only real analysis is persisted.

**Roles** — athlete, coach, trainer, parent surfaces all stay coherent; a change to one must not
silently break another's hydration.

---

## 8. Packaging & how it runs

- **Generic machinery, per-repo config.** The crew is a saved `Workflow` script plus a thin skill in
  `~/.claude` (sibling to `card-forge` and `nightshift`). It reads `.crew/constitution.md` and
  `.crew/oracle.json` from whatever repo it's invoked in — so the *same crew* can point at PlaySmith
  later just by dropping a different `.crew/` folder.
- **OnStandard ships its own `.crew/`**: `constitution.md` (§7) + `oracle.json` (the gate commands,
  value floor, N, K, budget defaults) + `reports/` + `memory.md` (cross-cycle learnings) + `design.md` (design constitution) + `best.ref`. Committed into athleteos.
- **You invoke it from inside the athleteos repo** so git checkpoint/tag/revert and the oracle all run
  in the right place. Not from the PlaySmith session.
- **Cadence:** on-demand for the first 2–3 supervised shakedown runs; graduate to an overnight run
  (nightshift-style, larger budget, runs till dry or morning) once it has earned trust.

---

## 9. Model & effort assignment (the cost/trust engine)

**Founder ruling 2026-07-09: hybrid — a Fable 5 brain over an Opus 4.8 fleet, differentiated by effort.**
This evolves the standing "all Opus 4.8, no per-task model switching" rule *for the autonomous-crew
case only*; interactive work stays all-Opus-4.8.

**Why hybrid, not all-Fable:** Fable 5 ($10 / $50 per 1M tokens in/out) is Anthropic's most capable
model, trained for long-horizon autonomous runs that finish without human correction — but it is 2×
Opus 4.8's price ($5 / $25). The premium earns its keep in one seat, the **orchestrator**, whose own
token spend is small next to the fleet it commands. Running the fleet of well-scoped grunt work on
Fable would leak money for no quality gain. Mixing models is cache-safe: each crew agent is its own
subagent context, so there is no shared-cache thrash.

| Role | Model | Effort | Why |
|---|---|---|---|
| Orchestrator | **Fable 5** | high | Built for overnight autonomous runs; start at high — at `max` it can overthink/overplan |
| Security & RLS lens | **Opus 4.8** | high | Deliberately not Fable — see guardrail 3 below |
| Other discovery lenses | Opus 4.8 | high | Intelligence-sensitive bug-finding |
| Design & UX lens | Opus 4.8 | high | Vision + rubric; taste findings are founder-gated (§6.1) |
| Implementer | Opus 4.8 | **xhigh** | "Best for most coding"; the change must be correct |
| Adversarial verifiers | Opus 4.8 | **high** (→ max) | The brakes — the textbook "correctness over cost" case; `max` is the paranoid lever |
| Synthesizer / prioritizer | Opus 4.8 | high | Judgment call |
| Logging / oracle runs | — | — | Deterministic; no model |

Effort scale: `low → medium → high → xhigh → max`. Default `high`. `xhigh` is Claude Code's coding
default. `max` = correctness over cost. Fable at low/medium often exceeds prior models at xhigh/max, so
the orchestrator stays at `high`.

**Prompt guardrails that ride on the model choice** — each closes a real failure mode:

1. **Grounded progress claims (mandatory).** Every claim in the log / morning report must be audited
   against a tool result — a passing test, a real diff. Fable can fabricate status on long runs; for an
   unattended report this is non-negotiable.
2. **No unrequested tidying.** The implementer changes only what the opportunity requires — no refactors,
   no new abstractions. Closes the gold-plating failure mode (§2.2 #3) at the source.
3. **Security lens on Opus 4.8 by design.** Fable's safety classifiers target most cybersecurity content,
   and benign security tooling can false-positive and refuse mid-run. The RLS/auth/XSS lens is the one
   most likely to trip that wire and stall a 3am cycle. Opus 4.8 has no such gate.
4. **Crew memory (`.crew/memory.md`).** The orchestrator records what was tried and what the
   oracle/verifier rejected and why, so later cycles don't re-propose killed ideas (the convergence fix:
   dedup vs. *seen*, not just *shipped*). Fable performs materially better with a memory surface.
5. **Self-tuning effort.** Log tokens-per-role-per-cycle in the report; the first shakedown runs `high`
   everywhere, then dial from real numbers. The oracle + confirmed value per cycle is the crew's built-in
   eval — don't guess effort, measure it.

---

## 10. Tunable defaults (`.crew/oracle.json`)

| Knob | Default | Notes |
|---|---|---|
| Discovery lenses | 6 (§6) | parallel |
| Opportunities per cycle (N) | 3 | implemented serially |
| Cheap gate | `tsc --noEmit && jest` | per change |
| Full gate | `npm run verify` | per cycle |
| Security gate | `npm run test:rls` | when change touches security/RLS |
| Value floor | `priority ≥ 4.0` AND `severity ≥ medium` | |
| Dry-rounds to stop (K) | 2 | consecutive empty rounds |
| Adversarial verifiers per change | 2 | majority-refute kills |
| Budget ceiling | founder `+Nk` directive, else run-arg | hard cap |
| Branch | `crew/YYYY-MM-DD` | |
| Cycle tag | `crew/YYYY-MM-DD-iN` | best pointer in `.crew/best.ref` |

---

## 11. Success criteria

- A supervised run completes ≥ 3 cycles, each ending on a green full gate, with a readable morning
  report and zero regressions vs. the starting baseline.
- Every shipped change is attributable to a tagged cycle and reversible in one `git reset --hard <tag>`.
- At least one confirmed real defect (severity ≥ high) is found, fixed, and verified — and at least
  one proposed change is correctly *rejected* by the adversarial/oracle gate (proving the brakes work).
- No constitution rule is ever violated by a surviving change.
- `master` is untouched; integration is a founder action.
- The design role screenshots the key screens and files ≥ 1 before/after taste proposal in the report; `test:design` exists and gates ≥ 1 objective design fix.

---

## 12. Open questions / future

- Budget ceiling default value for unattended overnight runs (needs one real run to calibrate cost).
- Whether to add a 7th "domain/football-analogue" lens later (N/A for OnStandard; relevant when the
  same crew points at PlaySmith).
- Optional: wire an overnight schedule once shakedown runs earn trust.
