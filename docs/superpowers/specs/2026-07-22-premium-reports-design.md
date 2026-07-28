# Premium Reports — Design Spec

**Date:** 2026-07-22
**Status:** Approved (brainstorm) — pending spec review before implementation planning
**Feature area:** Phase 3, feature 2 of 3 (parent-funded plans ✅ → **premium reports** → sponsor-funded access)
**Builds on:** the existing `deep-analysis` "Deep Dive" (migration `0045`, `claim_ai_usage_epoch`, `ai-telemetry`), the consumer premium subscription (RevenueCat IAP + Stripe web), and the native bridge (`src/proto/bridge.ts`).

## 1. Summary

"Turn on + expand the tier." Two things:
1. **Gate the existing weekly Deep Dive** behind the premium subscription (flip its paywall on) and reconcile the unlock to the **consumer** entitlement so an individual athlete's subscription actually unlocks it.
2. **Add a new monthly progress report** — a comprehensive month-in-review for the athlete (score trend, macro + weight arcs, streak, best/worst days, logged-day count) with a short AI narrative, premium-gated, **shareable as an image** via a new native bridge capability.

No new payment rail — both artifacts are unlocked by the subscription already sold via IAP. This is content + entitlement gating + one native capability.

### Decisions locked in brainstorming
- What: gate + expand the premium tier (not a new purchase, not a per-report sale).
- New report: a monthly progress report that is ALSO shareable.
- Sharing: native share of a rendered **image** (no public URL) — safest for privacy (minors).
- Approach A: new `monthly-report` edge function reusing the Deep Dive's proven scaffolding.
- Gate reconciled to unlock on the **consumer** subscription (confirmed), not team-only.
- The AI narrative is a real, cost-capped monthly AI call (confirmed).
- A **new native bridge capability** ships the image share — needs a native-app rebuild, not just an OTA (confirmed).

## 2. Existing building blocks (verified)

- `deep-analysis/index.ts`: weekly AI Deep Dive. Paywall seam `DEEP_REQUIRES_PLAN=1` → checks `subscriptions` for `tier==='team' && status in (active,past_due)` → else 402. Cost-capped via `claim_ai_usage_epoch('deep:<uid>', isoWeek(), cap)`. Honesty contract: app computes the numbers, model narrates via forced tool output, never invents.
- `claim_ai_usage_epoch(p_key text, p_epoch text, p_limit int) → (allowed bool, used int)` (0045), service-role only. Reusable with a monthly key — **no migration needed for the cap**.
- `_shared/ai-telemetry.ts` (`recordAiCall`, `usageFrom`) — per-call cost logging, wired into every paid Anthropic fn.
- `subscriptions` table: `owner_id, status, tier` (tier includes `consumer` for IAP consumers, plus team/org). `revenuecat-webhook` writes the consumer entitlement.
- Native bridge `src/proto/bridge.ts`: typed `postMessage` bridge; existing `SHARE` handler does `Share.share({title,message,url})`. `BRIDGE_SHIM` exposes `window.OnStandardNative`.
- Proto entitlement/paywall: the OB2 adaptive paywall + entitlement checks (referenced in `ob2*.js`, `meal-intel.js`, `nutrition.js`). Exact function names pinned during planning.

## 3. Data model change

One new table to cache a generated monthly report (so an athlete can re-view without a second paid AI call, and the monthly cap returns the stored report):

```sql
create table if not exists public.monthly_reports (
  athlete_id  uuid not null references profiles(id) on delete cascade,
  period      text not null,               -- 'YYYY-MM' (athlete-local month the report covers)
  payload     jsonb not null,              -- the full rendered report (deterministic sections + AI narrative)
  created_at  timestamptz not null default now(),
  primary key (athlete_id, period)
);
alter table public.monthly_reports enable row level security;
create policy monthly_reports_read_own on public.monthly_reports
  for select using (athlete_id = auth.uid());
-- no insert/update policy: only the service-role monthly-report fn writes it (0035 default: no grants).
```

No other schema changes. `ai_usage_epoch` (0045) is reused for the monthly cap. Migration number = next free at build time (0128 is ours; the concurrent Command Center session holds 0120/0122–0127 — **verify the highest number just before creating the file**; likely `0129`).

## 4. Backend

### 4.1 Consumer gate reconciliation (deep-analysis + monthly-report)
Change the unlock check so an active **consumer** subscription unlocks premium reports, not only `tier==='team'`. Concretely: `unlocked = (status==='active' || status==='past_due') && tier ∈ {consumer, team, org…}` — i.e. any paid tier, gated on status. Apply the SAME helper in both `deep-analysis` and the new `monthly-report`. Keep the env flag seam (`DEEP_REQUIRES_PLAN`, and a parallel `MONTHLY_REQUIRES_PLAN`) so the paywall stays a secret flip, not a deploy.

### 4.2 `monthly-report` edge function (new)
Mirrors `deep-analysis`'s scaffolding. Request: `{ period?: 'YYYY-MM', data: <deterministic month payload the app computed> }` + bearer token. **`period` defaults to the last COMPLETED month** (athlete-local); a completed month's numbers never change, so its report is final and safe to cache forever. (The current, in-progress month is NOT generated here — the UI shows a live deterministic preview instead, §6 — which sidesteps a report getting "stuck" as an early sparse version before the month fills.) Flow:
1. Resolve user; reject a non-completed `period` (400); **entitlement gate** (§4.1) → 402 if locked.
2. If a `monthly_reports` row for `(athlete, period)` already exists → return it (no AI spend, no cap claim). Re-view is free and idempotent.
3. Else `claim_ai_usage_epoch('monthly:<uid>', period, cap=1)` → if not allowed, 402/429 "already used this month" (cap protects against abuse when no stored row exists).
4. If the month has enough logged data: call Anthropic (honesty contract: forced tool output; the model narrates the app-supplied numbers, never invents one) + `recordAiCall` telemetry. If sparse: skip the model entirely (no spend), narrative = honest "not enough logged this month."
5. Store the assembled report (deterministic sections + narrative) in `monthly_reports`, return it.

Graceful fallback: if the AI call fails, store+return the deterministic sections with a "summary unavailable" narrative (like Deep Dive) — the report still renders, no retry-spend.

### 4.3 Pure month-aggregation (app side, testable)
A pure function that turns the athlete's raw month (days/scores, meals/macros, weight, streak) into the report's deterministic sections + the payload the AI narrates from. Unit-tested; no network. Never fabricates — a sparse month yields honest "not enough logged" sections.

## 5. Native capability — `SHARE_IMAGE`

New bridge message `{ type:'SHARE_IMAGE', dataUrl:string, caption?:string }`:
- Native handler decodes the base64 PNG, writes it to a temp cache file (`expo-file-system`), and calls `Share.share`/the share sheet with the file URI; best-effort, never throws.
- `BRIDGE_SHIM` gains `window.OnStandardNative.shareImage(dataUrl, caption)`.
- Security: accept only `data:image/png;base64,` (or jpeg) URLs; ignore anything else. **This is a native change — it ships in a native-app build, not an OTA.**

## 6. Proto UI

- **Monthly report** surface (in Progress or Profile): generates **last completed month's** report → view the sectioned report → **Share** (renders the summary to an on-the-fly `<canvas>` in the blue→teal signature, exports PNG, calls `shareImage`). The **current month** shows a live deterministic preview (no AI, no cache) with a quiet "final report available when {month} closes." Non-subscribers see the existing adaptive paywall / upgrade prompt instead of generating.
- **Deep Dive** surface: same paywall treatment for non-subscribers once `DEEP_REQUIRES_PLAN` is on.
- The share card falls back to `window.OnStandardNative.share` (text) or a no-op in a plain browser where `shareImage` doesn't exist.

## 7. Edge cases

- Brand-new / sparse month: honest "not enough logged this month yet" sections, **no AI spend** (skip the model, still store a light report so re-view is consistent). 
- Cap already used this month with no stored report: 402/429, paywall-style message.
- Report already generated: re-view returns the cached payload, free.
- Non-subscriber: paywall, never generates.
- AI unavailable: deterministic sections render, narrative omitted, no retry-spend.
- Privacy: the shared image is athlete-initiated and self-contained; no public URL; minor data never leaves except by the athlete's own share action.

## 8. Testing

- Unit: the pure month-aggregation (sparse/rich/edge months) and the share-card data shaping.
- Live: the entitlement gate (locked → 402; unlocked consumer → allowed), the monthly cap (2nd generation same month blocked / returns cached), the `monthly_reports` RLS (an athlete can't read another's report). The AI call is a **real paid call** — verify once, record the cost from `ai_calls`, then rely on the cache. Clean up any test rows; test consumers removed.
- Native: `deno`/type-check the bridge; the `SHARE_IMAGE` path is verified in a native build (documented as a native-build item, not an OTA smoke).

## 9. Out of scope (v1)

Public shareable report links (privacy/consent model deferred — chose native image share); coach/trainer/parent-purchased reports; PDF export; auto-generated month-end reports (v1 is on-demand); quarter/season reports. Each is a clean follow-up.
