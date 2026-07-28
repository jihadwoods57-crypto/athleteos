# Training log (#2) — design + decisions (2026-07-22)

Founder-approved via brainstorming. Three forks decided:
- **Scoring:** tracked-not-scored (like lifts today; the parity-locked score core is untouched).
- **Authoring:** both — coach programs sessions; solo (Individual-plan) users self-log.
- **Depth:** lightweight — session + "how'd it go" + notes. NO exercise DB / per-set reps·weight / PRs.

## Ground truth (from exploration)
- Lifts today = one `kind:'lift'` check item in `requirement_sets.items` jsonb (0055), completed into
  `days.checked_tasks` (0112, tracked-not-scored). The score core (`day.js` computeComponents/scoreFor,
  parity-locked) reads meals/recovery/commitment/checkin only — never checked_tasks.
- `validate_requirement_items` (0055) requires only `id/title/kind/proof` and **ignores extra keys**;
  `title` ≤ 80 chars is customizable. → coach session name + description need **no DB/RPC change**.
- No workout/exercise/program tables exist. Next migration = **0135**.

## Data — one new table, migration 0135
`training_logs`:
- `id uuid pk`, `athlete_id uuid → profiles`, `log_date date default today`, `title text`,
  `note text`, `feel smallint` (1–5, optional), `source text check ('coach','self')`,
  `requirement_id text` (optional link to the programmed lift item), `created_at timestamptz`.
- RLS: read `athlete_id = auth.uid() OR can_view(athlete_id)`; insert/update/delete owner-only.
  Explicit `grant insert,update,delete ... to authenticated` (0013/0036 gotcha). Coach-visible via can_view.
- This is where notes/feel/history live — `days.checked_tasks` has no room for them.

**Scoring stays untouched:** completion still rides `days.checked_tasks` (tracked-not-scored). The new
table is pure history + coach visibility. No change to computeComponents/scoreFor/evidence-ceiling/parity.

## Coach programming (no DB change)
In the standards editor (`coach.js` coachPlanSet), the "Lift sessions ×N/week" knob gains:
- an optional **session name** → the lift item's `title` (≤80; defaults to "Lift session"),
- an optional **description** → a new `desc` key on the lift item (free-text exercise list, e.g.
  "Squat 3×5, RDL 3×8, lunges, core"). Stored in `requirement_sets.items`; validator passes.
- Wired through `itemsFromKnobs` (write) + `knobsFromItems` (read) + the preview.
The named session shows on the athlete's today list exactly where the lift check does now.

## Athlete logging (lightweight)
Tapping the training/lift requirement opens `#log-training` (or the requirement detail extends to it):
- title (prefilled from the coach session name), a **1–5 "how'd it go"** chip row, optional **notes**;
- Save → `roles.saveTrainingLog(...)` writes a `training_logs` row AND marks `days.checked_tasks[id]=true`
  (so it reads done + tracked-not-scored) + pushDay.
- **Solo self-log:** any athlete (esp. no-coach Individual users) gets a "Log a workout" button (blank
  title, `source:'self'`) so nobody is left out. Coach-programmed sessions still appear on the today list.

## History + coach view
- Athlete: a "Training" card on Progress → `#training-history` timeline (date · title · feel · notes),
  reusing the progress-photo timeline/section pattern. Includes the "Log a workout" self-log entry.
- Coach: recent training logs (title · feel · notes) surfaced on the coach athlete-profile activity tab
  (`coach.js` coachAthlete + a `coach-data`/roles fetch), never invented.

## Scope guardrails
No exercise database, no per-set reps/weight, no PRs, no volume charts (that's the un-chosen "full
strength logging" path). Free-text `desc` is the exercise list. The table extends cleanly to structured
sets later if the founder wants.

## Build order & verification
0135 migration → roles.js fns → coach-editor extension → #log-training → #training-history + Progress
card → coach activity surface → register/CSS. Verify: lint:xss + typecheck + jest + bundle green, RLS
suite + new adversarial probes for training_logs, browser-render every new/changed screen. Commit like A–D.
