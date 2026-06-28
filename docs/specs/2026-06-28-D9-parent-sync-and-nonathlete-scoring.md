# D9 spec — Parent "last synced" + non-athlete (trainer-client) scoring

**Status:** DRAFT for founder/board review. Authored 2026-06-28 per the D9 ratification
("start speccing now"). Neither item ships before the backend is live; this is the design
so the build is a known quantity when the flag flips. No code in this doc.

Two unrelated items were bundled under D9 because both surfaced from the persona play-test
and both need either the live backend or a product decision before building. They are
specced separately below.

---

## Part A — A real "last synced" time on the Parent view

### Problem
The Parent dashboard implies live data but shows no honest freshness signal. A parent can't
tell if they're looking at today's numbers or a three-day-old snapshot. The play-test parent
persona flagged this as a trust gap ("is this even current?").

### Goal
Show a truthful "Last synced: <relative time>" on the Parent view, derived from real sync
activity, never a fabricated value. If data is stale (e.g. > 36h), say so plainly.

### Data model
- The athlete's `days` row already carries `updated_at` (0001_schema.sql) and the client
  stamps `computed_at` on push. The parent read path (`fetchLinkedDays`) should return the
  most recent `updated_at` across the child's synced days.
- Add `lastSyncedAt: string | null` to the parent-facing linked-athlete view model (null =
  never synced / not yet linked).

### Pure core (testable without a backend)
- `lastSyncedLabel(iso: string | null, now: Date): string` -> "Synced just now" / "Synced
  2h ago" / "Synced yesterday" / "Last synced Jun 24" / "Not synced yet". Reuse the relative
  -time conventions already in the codebase; no em dash; no guilt copy.
- `syncFreshness(iso, now): 'fresh' | 'stale' | 'none'` with a stale threshold (proposed
  36h) so the UI can show a quiet amber note when a child hasn't synced in a while WITHOUT
  alarming the parent (factual, e.g. "No new data since Tuesday").

### UI
- A small line under the child's name on ParentView: the label + a dot whose color follows
  `syncFreshness` (neutral when fresh, amber when stale, gray when none).
- Replace any current static/sample freshness text; gate behind `isBackendLive` so the
  demo build shows an honest "Demo data" state instead of a fake timestamp.

### Dependencies / open questions
- Needs the backend live + the parent read path returning `updated_at` (P1 go-live work).
- Q: stale threshold — 36h proposed; confirm against real athlete logging cadence.
- Q: do we want a "nudge your athlete" affordance when stale, or is that overstepping for a
  parent? (Default: no nudge button for parents; observation only.)

### Phasing
1. Pure `lastSyncedLabel` + `syncFreshness` + tests (can land now, behind the flag).
2. Thread `lastSyncedAt` through `fetchLinkedDays` -> ParentView (needs backend).
3. UI line + freshness dot (needs 2).

---

## Part B — Scoring for a trainer's non-athlete (general-fitness) clients

### Problem
The Development Score is built for athletes (protein-first, performance framing). A personal
trainer's book includes general-fitness / weight-loss clients for whom "athlete development"
is the wrong lens. The trainer persona said the app clearly understands trainers but scores
their clients as if they were all athletes. Today every client is scored on the athlete model.

### Goal
A second, opt-in scoring profile — "general fitness" — that reuses the SAME deterministic
engine shape (sub-scores -> weighted headline) but with weights + targets tuned for a
non-athlete goal, so a weight-loss client's number reflects adherence to THEIR plan, not an
athlete standard. One engine, two profiles; never a second formula bolted on.

### Approach (deterministic, pure core)
- Introduce a `ScoringProfile = 'athlete' | 'general'` carried on the client/account.
- `athlete` (today): nutrition 0.5 / recovery 0.25 / tasks 0.15 / check-in 0.1, protein-led
  nutrition sub-score (unchanged — do not disturb the validated model).
- `general` (new): re-weight toward the levers a general client controls. Proposed starting
  point (NEEDS founder/nutrition sign-off, not a final number):
  - nutrition sub-score driven by calorie-target adherence + meal consistency rather than a
    raw protein floor (protein still counts, weighted lower);
  - recovery + check-in retained; tasks retained;
  - a goal-aware target set (calorie deficit/surplus by goal) instead of the athlete protein
    target.
- The score stays 0..100 with the same band language so a trainer reads one consistent scale
  across their whole book.

### Data model
- `scoringProfile` on the athlete/client profile (defaults to 'athlete' so nothing changes
  for existing data). A trainer sets a client's profile at link time or in client settings.

### UI
- Trainer client detail: a profile selector ("Athlete" / "General fitness").
- The client's own app: copy adapts (no "scholarship"/performance framing for a general
  client) — reuse the existing role-aware copy seams.

### Dependencies / open questions
- The re-weighting is a PRODUCT + nutrition-science decision, not an engineering one. The
  numbers above are a strawman; they need founder + (ideally) an RD sign-off before build,
  same bar we hold the athlete model to.
- Per-client profile assignment needs the backend (trainer writes a client's profile) for
  the real path; the pure engine + a local toggle can be built and tested first.
- Q: do general clients see the same "Development Score" name, or a neutral "Progress Score"?
  (Naming matters for the non-athlete framing; recommend a profile-aware label.)

### Phasing
1. Pure: `ScoringProfile` + a `general` weight/target set + `computeDerived` honoring the
   profile, with tests proving the athlete path is byte-for-byte unchanged (default profile).
2. Trainer client-detail profile selector (local first, then backend-persisted).
3. Profile-aware copy + score label.

---

## Recommendation
Both are real, both are post-backend. Part A is small and low-risk (mostly pure label logic +
one read-path field). Part B is a model-design decision that should NOT be built until the
re-weighting is signed off to the same standard as the athlete score. Suggest landing Part A's
pure helpers opportunistically and holding Part B's weights for an explicit founder/RD review.
