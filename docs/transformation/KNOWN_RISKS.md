# Known Risks

Ranked. Each entry states what is wrong, the evidence, and what it would take to close.
Nothing here is hidden behind optimistic language.

**Update 2026-07-26** — the four items previously listed as P0/P1 blockers are now CLOSED. See
§ "Closed" at the bottom for what was done and how it was verified.

---

## P1 — open, documented, justified

### 1. `monthly-report` has no timeout on its loading state

Renders "Building your report…" indefinitely when the fetch never resolves. Caught by the QC
sweep as a THIN screen on every run. Needs a timeout, an error state and a retry — the same
treatment the meal-analysis failure path already has.

### 2. `coach-commitments` fails to render in the QC harness

Times out at 45s on every sweep. Not yet diagnosed: it may be a harness fixture gap (the screen
waits on data the Supabase stub does not serve) rather than a product bug. It must be resolved
either way, because a screen the harness cannot render is a screen nothing verifies.

### 3. The edge functions do not typecheck

`deno check` reports 6 pre-existing errors across the paid functions (readonly tool schemas vs the
Anthropic SDK's mutable `string[]`). `npm run verify` does not typecheck `supabase/functions` at
all, so this is invisible in CI. Confirmed pre-existing — the counts are identical before and
after this pass's edits — but it means an edge function can ship with a type error today.

### 4. Component duplication remains

11 stat-tile implementations, 15 progress-bar primitives, 21 pill classes, 6 empty-state systems,
4 button systems, 3 skeleton systems, 46 card class names. The type scale that makes consolidating
them possible now exists but is barely adopted; the box-heavy look persists until it is.

### 5. 92 hardcoded colour literals remain (down from 249)

The remainder are deliberate: the desktop preview bezel (`.device`, not shipped inside the
WebView), pure-black shadow alphas, and `#fff` on fixed-dark surfaces. These are cosmetic
inconsistencies rather than legibility failures — no measured contrast failure remains in either
theme.

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
- **`roll-call-ack`** is not pinned `verify_jwt = false` in `config.toml` — a deploy that forgets
  the flag silently breaks it.
- **Sync-by-comment across boundaries** — grades (3 copies incl. plpgsql), tier bands (3 copies),
  pricing (**4 copies, money**) and `styleShowsNumbers` are kept in step by comments. Each is a
  future incident. The cheap fix is to extend the existing `planStyleParity.test.ts` pattern; each
  is under 30 lines.
- **107 routes** with three hard orphans (`safety`, `states`, `copilot`) and two dead entries
  (`legacy-role`, `meal-confirm`).
- **No staging environment.** The proto's fallback config points at the production Supabase
  project. All database work ran against a local instance; no UI work authenticated against
  production.
- **Screen-by-screen design work has not started.** Athlete Home still states the same fact three
  ways above the fold, and the daily score — the product's signature — is visually outranked by
  the CTA beneath it. See DESIGN_DIRECTION.md.
- **Performance was never measured.** See PERFORMANCE_RESULTS.md.

---

## Closed in this pass

### ✅ Streak drift (was P0)

Two implementations disagreed on whether an incomplete today zeroes the run, on grace, and on
activation day — and both were green-tested against contradictory expectations.

**Resolved:** the proto's semantics are canonical (an incomplete today does not zero a run at 9am,
which is when retention is decided). The TS copy is deleted along with `src/screens/**`, its only
caller — 17,949 lines of unreachable code that was still compiled into the binary.
`disciplineRecord` now *receives* the streak instead of recomputing it, so a recruiting record
cannot print a different number from the athlete's own screen.
**Guarded by** `streakSingleSource.test.ts`, which fails the build if a second implementation
appears and pins the three rules that define the surviving semantics.

### ✅ Uncapped AI spend (was P1)

**Resolved:** migration 0152 adds an enforced dollar ceiling and a kill switch, over the cost data
0105 already computes. Wired into the four highest-volume paid functions, fail-closed. Unlike the
call-count caps it applies to signed-in callers too, because if the bill is at the wall,
continuing to spend helps no one.

Also: `plan-generate`'s global cap is now anon-only (it previously let anon abuse 429 every paying
coach), and anon global ceilings dropped 5000 → 750. `ANON_IP_CAP` deliberately stays at 60 — a
team of 60 onboarding on one school wifi shares one NAT'd IP, and cutting it would break the core
sales motion while barely inconveniencing an attacker who rotates IPs.

**Verified** against a local database: default allows, kill switch and exhausted cap both refuse
with the right reason, and `anon`/`authenticated` cannot execute either function.

### ✅ Light mode (was P1)

**Resolved, not hidden.** 249 hardcoded literals → 92. Brand hues became RGB triples so any alpha
flips with the theme (102 washes); gradient fills now pair `--hue` with a new `--hue-deep` so they
stop inverting on light (15 gradients); `--ink-on-accent` and `--teal-deep` retired the seven ad-hoc
inks and an undefined brand colour.

**Verified:** 0 contrast failures across all 61 screens in both themes, and inspected visually.

### ✅ Touch targets (was P1)

**Resolved:** 59 → **0** across 122 captures in both themes. Form fields grow; everything else
keeps its visual size and expands only its hit area via a centred pseudo-element.

The measuring instrument was fixed too — it measured the painted box, so it could never have shown
this green. A metric that cannot go green gets ignored, which is the same normalisation that let a
red security suite sit unnoticed for months.

---

## Process risk (unchanged, and the most important entry here)

**The RLS suite was red 81% of the day and this had been normalised.** It is fixed, but the lesson
generalises: this codebase's recurring failure mode is not carelessness, it is *defects with no
automated guard* — table grants (three recurrences), role chrome (three instances found in one
fix), time-dependent tests, and a streak that drifted in plain sight while both suites stayed
green. Every fix in this pass ships with a guard for that reason.
