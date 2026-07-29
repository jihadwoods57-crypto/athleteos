# Decision Log

Each entry: the problem, the evidence, options considered, what was chosen and why, how it was
verified, and what risk remains.

---

## D1 — Work on a branch, not a worktree

**Problem.** The brief asks for an isolated branch *or* worktree.
**Decision.** Branch `feat/production-transformation` in the existing tree.
**Why.** A worktree needs its own `node_modules` (multi-GB, several minutes) for no isolation
benefit with a single agent working. The brief's requirement is satisfied by either.
**Risk.** A concurrent committer on the shared tree could sweep uncommitted work. Mitigated by
committing in small stages with explicit `git add <path>` — never `-A`.

---

## D2 — Correct the brief's stated architecture rather than build against it

**Problem.** The brief describes Next.js + Tailwind. The repo is Expo 57 / React Native, and the
shipped UI is a vanilla-JS WebView app.
**Evidence.** `app/index.tsx` renders only `ProtoApp`, a WebView over
`proto/redesign-2026-07/index.html`. `src/screens/**` has one importer (`src/Root.tsx`) which
nothing imports.
**Decision.** Treat `proto/redesign-2026-07/` as the product. Flag the discrepancy immediately.
**Why.** Every hour spent redesigning `src/screens` would have changed nothing a user sees.

---

## D3 — Build a measuring instrument before changing anything visual

**Problem.** 107 routes across 8 roles and 2 themes cannot be reviewed by eye, and the brief
forbids declaring a screen complete from reading source.
**Decision.** Build `scripts/qc-capture.mjs` on the repo's existing CDP driver and Supabase stub.
**Why.** It converts "the app feels inconsistent" into counts a reviewer can re-derive, and it
became the verification for every later change. Reusing the existing harness meant no new
dependency and no production network calls.
**Verified.** Found, on the first run: 1 JS error, 2 stuck screens, 59 undersized touch targets,
5 real light-mode contrast failures.
**Correction made.** The first version reported every gradient-filled button as a 1.06:1 contrast
failure, because it measured `backgroundColor` on an element painted with `background-image`. It
now refuses to guess and skips unmeasurable elements. **A tool that cries wolf is worse than no
tool**; that fix mattered more than any finding it produced.

---

## D4 — Fix the design system at the token layer, not per component

**Problem.** Three measured light-mode contrast failures, including the coach's "Critical" label
at **2.02:1**.
**Evidence.** Red and cyan were the only semantic families without a `-bright` variant, so six
files invented `#FF9B9B` and `#f87171` — dark-theme colours with no light value.
**Options.** (a) patch the failing rules; (b) add the missing tokens and migrate every literal;
(c) drop light mode.
**Chosen: (b).** The token file already encodes the correct pattern — 400-level in dark,
700-level in light. The failures were not design errors, they were *bypasses* of a good system.
Patching rules would have left the next component free to invent a tenth red.
**Verified.** Light-mode failures 5 → 0, dark 0 → 0, measured on the same screens.
**Remaining risk.** 249 hardcoded literals remain. See KNOWN_RISKS #3.

---

## D5 — Add the type scale, but do not mass-migrate it

**Problem.** 45 font sizes, 618 declarations in a 7px band at 0.5px steps. This is why hierarchy
is built from 130 card rules and 165 hairlines instead of from type.
**Options.** (a) add tokens and mechanically snap all 618; (b) add tokens, migrate per screen;
(c) leave it.
**Chosen: (b).** A 618-declaration sweep is unreviewable — every screen shifts at once and no
single change can be judged. Migrating per screen keeps each step visible in the contact sheet.
**Cost, stated plainly.** The tokens are currently near-unused. They are foundation, not delivery,
and the box-heavy feel persists until the migration is done.

---

## D6 — Load the focus layer last rather than use `!important`

**Problem.** 9 rules set `outline: none`, several at a specificity a new layer would lose to.
**Evidence.** `:where()` has zero specificity, so `.composer input { outline: none }` (0,1,1)
would have defeated the intended ring — the first attempt was wrong for exactly this reason.
**Options.** (a) `!important`; (b) remove the 9 `outline:none` declarations; (c) a dedicated
stylesheet loaded last with explicit overrides.
**Chosen: (c).** `!important` poisons every future override. Removing `outline:none` would change
base rendering for pointer users. A last-loaded layer wins ties naturally and stays overridable.
**Verified.** All 9 previously-suppressed fields now match `:focus-visible` and compute a 2px ring
in a real browser.

---

## D7 — Fix role chrome at the router, not screen by screen

**Problem.** A parent got the athlete tab bar on shared screens; a coach could not delete their
account.
**Evidence.** Both trace to `navFor()` defaulting a nav-less screen to `'athlete'`, and to neither
router guard covering parents.
**Options.** (a) add `nav` to the three known screens; (b) fix the default.
**Chosen: (b).** (a) fixes the instances found and leaves the next nav-less screen to reintroduce
it. `tabbar()` now renders *nothing* for a role it has no tabs for — **failing to nothing is
correct, failing to another role's chrome is not.**
**Verified.** The regression test immediately surfaced a third case the audit had missed (parents
were also blocked from account deletion). Confirmed visually: the athlete tab bar no longer paints
on the parent's Fund-a-plan screen.

---

## D8 — Verify the recurring grant bug against a real database

**Problem.** An audit claimed four tables were missing write grants.
**Decision.** Verify each against the client's actual write path, then against a local database
with all 151 migrations applied.
**Outcome.** Two of the four claims were **rejected** — `athlete_exceptions` and
`coach_interventions` have policies wider than the client's writes, which breaks nothing. Two
were confirmed, and the regression test then found **two more** the audit had missed
(`device_tokens`, `commitment_locations`).
**Why it matters.** Shipping the audit's list verbatim would have included two unnecessary grants
and missed a live push-token privacy leak.

---

## D9 — Treat the RLS suite's 2 failures as a process defect, not a security hole

**Problem.** The suite reported 417/419.
**Evidence.** `my_armable_geofences()` returns exactly the nine keys its assertion allows; the
fixture's window predicate evaluates false at 20:33; removing both new migrations reproduced
417/419 identically.
**Decision.** Anchor the fixture to `now()`.
**Why it matters most.** The failures were harmless, but "417/419" had become the expected result
for a suite that is red 81% of the day — which is exactly how a real hole reaches production
unnoticed. The dangerous thing was not the two checks; it was the normalisation.

---

## D10 — Do not fix the streak drift in this pass

**Problem.** Two live implementations with contradictory semantics, both green-tested.
**Decision.** Document as P0; do not choose unilaterally.
**Why.** Which semantics win is a **product** judgement about how retention is measured, not a
refactor. The proto's version (an incomplete today never zeroes the run) has better reasoning and
is what athletes see — but silently deleting the other would change a number that the product
promises never lies. This is the one finding that needs the founder.
