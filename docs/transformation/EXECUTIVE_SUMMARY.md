# OnStandard — Production Transformation, Executive Summary

Branch: `feat/production-transformation` (off `feat/founder-command-center`)
Date: 2026-07-25

---

## 1. Blunt assessment of the product as found

**The brief's premise was wrong in two ways, and both matter.**

*The stated stack was wrong.* The brief describes "Next.js, Tailwind and Supabase". The
repository is **Expo 57 / React Native 0.86**, and the shipped UI is not React at all: it is a
**vanilla-JS single-page app** (`proto/redesign-2026-07/`, 112 modules, ~14k LOC JS + ~2.6k LOC
CSS) rendered inside a WebView by a thin Expo shell (`src/proto/ProtoApp.tsx`). Any plan written
against the stated stack would have been unexecutable. Supabase is correct.

*The implied maturity was wrong.* This is not an unfinished prototype. It arrived with **2,571
passing tests across 211 suites**, a **419-check adversarial RLS suite**, 149 migrations, 38 edge
functions, a dependency-free screenshot harness, and unusually disciplined code comments that
explain *why* rather than *what*. Several things the brief lists as work to do — honest empty
states, AI cost telemetry, feature flags, audit logging, guardian consent — are already built.

The real problems are not the ones the brief anticipated. They are:

| # | Finding | Why it matters |
|---|---|---|
| 1 | **The design system's promise is broken by its consumers.** The token file is the best artifact in the repo — 36 colour tokens with deliberate, contrast-reasoned light/dark pairs. But 249 hardcoded colour literals live outside it, patched by exactly 8 light-theme overrides. Light mode is stubbed, not shipped. | The coach's **"Critical" status label measured 2.02:1** in light mode — illegible. |
| 2 | **There is no type scale.** 45 distinct font sizes across 809 declarations, 618 of them packed into the 10–17px band at 0.5px steps. | Typography cannot signal hierarchy, so hierarchy is built from boxes instead: **130 card-like rules, 165 hairlines, 46 card class names** for one idea. This is the direct cause of the "collection of disconnected cards" feel. |
| 3 | **Keyboard accessibility was absent.** 4 `:focus-visible` rules against 82 interactive affordances; 9 rules setting `outline: none`; one input with no focus indication at all. | Unusable by keyboard and switch-control users. |
| 4 | **Three coach features were silently broken in production** by missing table grants. | Position rooms, week patterns, and push-token cleanup on sign-out all fail with 42501 before RLS is even evaluated. Every call site swallows the error. |
| 5 | **The security suite was red 81% of the day** and nobody knew. | Two checks depended on wall-clock time. "417/419" had become the expected result — which is exactly how a real hole gets missed. |
| 6 | **107 registered routes** across ~8 roles, including hard orphans and dead aliases. | Surface area far beyond what a mobile product this age should carry. |
| 7 | **~19,400 LOC of provably dead code** (`src/screens/**` and friends), still shipped inside the IPA. | Nothing reachable from the app entry point imports it. |
| 8 | **The streak algorithm exists twice, already drifted**, with each side's tests asserting contradictory semantics. | The green suite is certifying two different answers to "what is my streak?". Not yet fixed — see KNOWN_RISKS. |

**Bottom line:** the engineering discipline here is well above average. The gap is not care — it
is that the design system was authored once and then bypassed 249 times, and that whole classes
of defect (table grants, role chrome, time-dependent tests) had no automated guard, so they
recurred silently. The work below closes the guards, not just the instances.

---

## 2. What changed

Eight commits, each independently verified. Nothing was merged to `master`; nothing was deployed.

| Commit | Change |
|---|---|
| `afe8977` | **QC harness** — captures every screen across roles/themes/widths and machine-audits each for overflow, sub-44px touch targets, clipped text, contrast, JS errors and empty screens. |
| `e9cf5e3` | **Four confirmed UI defects** — AI meal-analysis labels rendering as infinite loading skeletons; "account?Sign in" missing space on the first screen; `#meal-questions` crash on stale entry; roll-call rows opening Home instead of the commitment. |
| `fe6a607` | **Migration 0150 + regression test** — table grants for four direct-write paths, three of them live-broken on production. |
| `7e542e7` | **Migration 0151** — revoked `TRUNCATE`/`TRIGGER`/`REFERENCES` from `anon` and `authenticated` across 62 tables. |
| `47069ac` | **RLS suite time-anchoring** — 417/419 → **419/419** at any hour. |
| `b8d9f18` | **Design system foundation** — `--red-bright`, `--cyan-bright`, `--ink-on-accent`, `--cyan-border`, a 10-step type scale, and a dedicated focus layer. Light-mode contrast failures **5 → 0**. |
| `(nav)` | **Role-chrome leaks** — parents no longer inherit the athlete tab bar; every role can now reach account deletion. |

Detail in `PRODUCT_DECISIONS.md`, `SECURITY_CHANGES.md`, `UX_CHANGES.md`.

---

## 3. Verification

| Gate | On arrival | Now |
|---|---|---|
| TypeScript | clean | clean |
| Jest | 2,571 / 211 suites | **2,558 / 212 suites** (16 tests removed with the deleted streak copy, 5 guards added) |
| Proto module tests | 41 | 41 |
| RLS authz suite | **417 / 419** (time-dependent) | **419 / 419** (any hour, 152 migrations) |
| XSS lint | clean | clean |
| Light-mode contrast failures | 5 | **0** |
| Dark-mode contrast failures | 0 | 0 |
| Touch targets under 44px | 59 | **0** (122 captures, both themes) |
| Focus rings on suppressed fields | 0 / 9 | **9 / 9** |
| Hardcoded colour literals outside tokens | 249 | **92** (all cosmetic; no legibility failure) |
| Dead code compiled into the binary | ~19,400 LOC | **17,949 LOC deleted** |
| Streak implementations | **2, contradictory** | **1, guarded** |
| Enforced AI spend ceiling | none | **$/day cap + kill switch** |

Migrations 0150–0152 were applied to a **local Supabase instance with all 152 migrations** and the
resulting privileges and function behaviour queried directly, not assumed. Production was never
touched.

---

## 4. Go / no-go

**GO for a beta / pilot launch on this branch. NOT YET a general launch.**

The four blockers from the first pass are closed:

1. ~~Streak drift~~ — one implementation, guarded by a test that fails if a second appears.
2. ~~Uncapped AI spend~~ — enforced dollar ceiling plus a kill switch, verified against a real
   database.
3. ~~Light mode~~ — finished rather than hidden; zero measured contrast failures in either theme.
4. ~~Touch targets~~ — zero under the 44px floor across 122 captures.

**Ship migration 0150 to production on its own, soon.** Three coach features are broken there right
now, silently. It is a pure grant addition with a documented rollback.

What still stands between here and a *general* launch is no longer correctness — it is polish and
proof:

- **No screen has been redesigned.** The foundation is in place (type scale, colour, focus, tap
  floor) but Athlete Home still states the same fact three ways and the daily score is visually
  outranked by the button beneath it. This is the largest remaining gap against the brief.
- **Performance has never been measured.**
- **Two screens fail their own QC sweep** — `monthly-report` hangs on a loading state that has no
  timeout, and `coach-commitments` will not render in the harness at all.
- **Device QA is outstanding** — geofence, lock-screen roll call, live camera and push have never
  been exercised on real hardware.
- The edge functions do not typecheck, and CI does not check them.

Nothing found across either pass is a data-exposure P0. The security posture is genuinely strong:
85/85 tables have RLS, no service-role function derives identity from a request body, both storage
buckets are private and per-user scoped, and 419/419 adversarial authorization checks pass.
