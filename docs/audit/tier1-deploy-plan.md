# Deploy Plan — analyze-meal + analytics-ingest (Tier 1 cutover, 2026-07-21)

Founder-run deploy for the two edge functions changed in `c1df580`. No migrations, no
schema, no client ship required (the new proto.zip rides the normal app release train and
is safe against BOTH server versions — see compat matrix).

## What each deploy does
- **analytics-ingest**: adds two event names to the server whitelist
  (`meal_score_delta`, `meal_text_conflict`). Purely additive — nothing existing changes.
- **analyze-meal**: the tool schema now requires per-food macro estimates on every
  detected food, and the prompt demands they sum to the meal totals. Meal-level totals,
  quality, and all prose fields are unchanged in shape.

## Order (safe, but this order is best)
1. `supabase functions deploy analytics-ingest` — so the delta analytic is accepted the
   moment the first new-scoring client reports it (deploying it late only drops those
   events silently; nothing breaks).
2. `supabase functions deploy analyze-meal`.

## Compatibility matrix (tested, not asserted)
`src/core/protoGroundResult.test.ts` feeds the real wire shapes through the actual
`groundResult` function:

| Server | Client | Behavior |
|---|---|---|
| old analyze-meal | new client | Fallback: meal-level DB grounding (`groundMealTotals`); score still computed by the app; `recomputed=false` honesty on edits. Tested (old-shape + pre-0062 string-shape payloads). |
| new analyze-meal | new client | Per-food attribution; totals = Σ foods; deletion subtracts exactly. Tested. |
| new analyze-meal | old client (pre-update installs) | Old `normalizeDetected` drops the unknown per-food fields; meal-level totals still present in the payload → identical to today. |

## Rollback
Both functions roll back with a single redeploy of the previous version — no client
action needed in either direction:
```
git checkout c1df580~1 -- supabase/functions/analyze-meal
supabase functions deploy analyze-meal
git checkout compliance-fixes -- supabase/functions/analyze-meal   # restore the tree after
```
(Same pattern for analytics-ingest; rolling it back only means the two new events get
dropped server-side — harmless, the client treats an accepted batch as sent either way.)
Note the client keeps its deterministic scoring regardless of server version — rollback
restores the old payload shape, not the old LLM-owned score. That behavior is in the
shipped proto.zip and would need an app release to revert (there is no reason to: it's
the brief's invariant).

## meal_score_delta — window and what "wrong" looks like
Each analyzed meal emits `{ai, det, delta}` (delta = app score − AI score). Read it on
live with (founder is platform_admin; `supabase db query --linked`):
```sql
select count(*)                                          as n,
       percentile_cont(0.5) within group (order by (props->>'delta')::int)      as median_delta,
       percentile_cont(0.5) within group (order by abs((props->>'delta')::int)) as median_abs_delta,
       min((props->>'delta')::int) as min_d, max((props->>'delta')::int) as max_d
from analytics_events
where name = 'meal_score_delta' and created_at > now() - interval '7 days';

select count(*) from analytics_events
where name = 'meal_text_conflict' and created_at > now() - interval '7 days';
```
**Window:** first 7 days after deploy, or the first ~200 delta events, whichever comes
first; one check midway and one at the end is enough.

**Normal:** median |delta| up to ~15 with individual outliers to ±30. The deterministic
score and the AI's estimate weigh timing/fiber differently, so scatter is expected —
individual disagreement is the point of the cross-check, not a defect.

**Actually wrong (act, don't wait):**
- median |delta| > 25 after 50+ events → the point weights diverge badly from how plates
  actually read; bring to the founder as part of the OPEN scoring-bands decision — do not
  silently retune `QUALITY_POINTS`.
- one-sided bias: median delta ≤ −15 (app consistently scores well below the AI) →
  athletes who logged before the cutover will feel a score drop; same founder decision
  path, plus consider whether the protein/fiber thresholds are too strict for real plates.
- `meal_text_conflict` on > 10% of analyses → the tone validator is over-firing or the
  prompt needs the computed band passed in so the model writes to it; investigate before
  more prose gets replaced by the (dryer) deterministic line.

## RLS suite trigger
`npm run test:rls` did not run for this change (no `psql` in the build environment) and
that is acceptable ONLY because `git diff c1df580~1..c1df580 -- supabase/migrations/` is
empty — nothing touched schema or policies. Hard trigger: **before the next migration
file ships (anything new under `supabase/migrations/`), the RLS suite must run green
against the local stack** — no exceptions, per the table-grants gotcha that already bit
once (0098).
