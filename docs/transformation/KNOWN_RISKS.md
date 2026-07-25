# Known Risks

Ranked. Each entry states what is wrong, the evidence, and what it would take to close.
Nothing here is hidden behind optimistic language.

---

## P0 — blocks a general launch

### 1. The streak algorithm exists twice and has already drifted

`src/core/history.ts:341` and `proto/redesign-2026-07/js/day.js:469` implement `streakInfo()` with
**contradictory semantics**, and each side's tests assert the opposite of the other:

| | `history.ts` | `day.js` (shipped) |
|---|---|---|
| Incomplete today | **zeroes the streak** (`:350`) | never zeroes it (`:482`) — comment: *"the old behavior punished the exact moment retention is decided"* |
| Grace | one forgiven day in a fixed trailing 7 | one miss per **rolling** 7, repeatable |
| Activation day | not modelled | excluded |
| Return shape | `{days, graceUsed, atRisk}` | `{days, todayCounted, graceDate}` |

`history.test.ts:536` asserts a streak of 0 where `protoStreakGrace.test.mjs` asserts a non-zero
run. **The suite is green while certifying two different answers to "what is my streak?"** — in a
product whose promise is that the score never lies.

*To close:* founder decision on which semantics win (the proto's reasoning is better and it is
what athletes actually see), delete the loser, add a third entry to the parity-test family.
Deleting the dead `src/` tree removes `history.ts` from the build but not the ambiguity.

---

## P1 — documented and justified, not shipped

### 2. Unbounded anonymous AI spend

`analyze-meal/index.ts:79` sets `GLOBAL_ANALYSIS_CAP = 5000` and `ANON_IP_ANALYSIS_CAP = 60`. The
anon key ships in the app bundle and satisfies `verify_jwt`, so ~84 rotating IPs exhaust the daily
anon budget — real Anthropic spend, every day, and a 429 for every genuine not-yet-signed-in user
for the rest of the UTC day. There is **no Anthropic-side spend cap anywhere in the repo**; the
tier-budget helper documents itself as *"a SIGNAL, not a gate — it never denies the call"*
(`_shared/ai-tier-budget.ts:14`).

*To close:* a hard dollar ceiling with a kill-switch flag, plus attestation or a signed
first-launch token before an unauthenticated analysis is allowed.

### 3. Light mode is stubbed, not shipped

The three measured contrast failures are fixed and verified. What remains: **249 hardcoded colour
literals** outside the token file against **8** light-theme override rules; 101 brand-hue washes
frozen at dark values (30 distinct green alphas alone); 15 gradients that invert direction because
`--green-bright` is *darker* than its hardcoded partner on light; 9 "premium" highlight rules that
are white-on-white and simply evaporate.

*To close:* either finish the migration to `-surface`/`-border` tokens, or ship dark-only and
remove the theme toggle. Shipping a half-migrated light mode is the worst of the three.

### 4. ~19,400 LOC of dead code is compiled into the binary

`src/screens/**` (17,896 LOC across 49 files) is provably unreachable — its only importer is
`src/Root.tsx`, which nothing imports. It is still pulled into the bundle through the
`src/core/index.ts` barrel. ~47 further core modules are exercised by nothing but their own unit
tests.

*To close:* delete `src/screens/**`, `src/Root.tsx`, `src/core/reminders.ts` (its successor
declares it retired), then kill the barrel and convert four `src/lib` imports to deep type-only
imports. Caveat: eight dead screens import proto JS, so deleting proto files first would break a
typecheck of code that can never run.

### 5. 59 touch targets below the 44px floor

Measured across 61 screens. Worst: `.chip` at **20px tall** ("Last 7 days"), `.ai-full-toggle` at
**19px** ("View full analysis"), `.si-forgot` 24px, `.si-link` 26px, `.btn.ghost` at 30–38px, the
coach filter chips at 40px, and Back at 33–41px wide. Not fixed in this pass — it needs a shared
tap-floor utility rather than 59 individual patches, and that is a design-system change best made
alongside the type-scale migration.

### 6. `monthly-report` has no timeout on its loading state

Renders "Building your report…" indefinitely when the fetch never resolves. Caught by the QC
sweep as a THIN screen. Needs a timeout, an error state and a retry.

---

## P2 — noted

- **Non-constant-time secret comparison** — `admin-alert:24`, `admin-auth-monitor:46`,
  `admin-brief:16`. Three sibling cron functions already use `safeEqual`; these are the odd ones
  out. Remote timing attacks over edge jitter are impractical, but the fix is one function call.
- **`commitment_audience(uuid)`** (`0138:360`) has no internal authz and is not revoked from
  PUBLIC — a signed-in user with a commitment UUID gets its athlete-UUID roster. Every sibling
  function has a `commitment_owner_is_staff` gate.
- **`progress-photos` bucket** lacks the `file_size_limit` / `allowed_mime_types` that `0029` set
  on `meal-photos`.
- **`plan-generate:287`** checks its global cap before the signed-in branch, so anon abuse can
  429 paying coaches.
- **`roll-call-ack`** is not pinned `verify_jwt = false` in `config.toml` — a deploy that forgets
  the flag silently breaks it.
- **Sync-by-comment across boundaries** — grades, tiers, evidence ceiling, pricing (4 copies,
  money) and `styleShowsNumbers` are kept in step by comments. Each is a future incident. The
  cheap fix is to extend the existing `planStyleParity.test.ts` pattern; each is <30 lines.
- **107 routes** with three hard orphans (`safety`, `states`, `copilot`) and two dead entries
  (`legacy-role`, `meal-confirm`).
- **No staging environment.** The proto's fallback config points directly at the production
  Supabase project. All database work in this pass ran against a local instance; no UI work
  authenticated against production.

---

## Process risk

**The RLS suite was red 81% of the day and this was normalised.** It is fixed, but the lesson
generalises: this codebase's recurring failure mode is not carelessness, it is *defects with no
automated guard* — table grants (three recurrences), role chrome (three instances in one fix),
time-dependent tests. Every fix in this pass ships with a guard for that reason.
