# Spec — Subscriptions & Entitlements

**Date:** 2026-06-29
**Status:** Inert seam BUILT · real billing DEFERRED to post-beta
**Decision:** the **coach / org pays per athlete** (B2B per-seat). Athletes use it free
under their coach. A direct-to-consumer plan is an optional later rail.

## Why a seam now, billing later
OnStandard is in free preview, and the Constitution + launch checklist say "prove the
loop first." Wiring real payments pre-beta adds App Store review surface and
complexity before there's product-market signal. So this change builds the
**entitlement plumbing** — the model, the gate, the backend read, the billing row —
with **no payment SDK**. Everything defaults to free preview, so the app reads exactly
as today until a real plan exists.

## The model (built)
- **`src/core/subscription.ts`** (pure): `Entitlement { tier, status, seats?, seatsUsed?,
  renewsAt? }`, `previewEntitlement()`, `isPro()` (the single gate — team plan, active
  or past_due grace), `planLabel()`, `billingRowCopy()`, and `entitlementFromRow()`
  (fail-safe: any non-team/garbage row → free preview, never an accidental grant).
- **State:** `AppState.entitlement` (persisted, defaults to preview).
- **Account "Billing & plan" row** now reads the real entitlement (was a static "Free
  preview" string). Preview copy is byte-identical; a coach on a paid plan would see
  seat usage; an athlete sees "covered by your coach."
- **Backend read:** `db.fetchEntitlement(userId)` → the owner's `subscriptions` row;
  `store.refreshEntitlement()` (gated on isBackendLive, fired after sign-in) maps it in.
- **Migration `0010_subscriptions.sql`** (apply-ready): one row per owner (coach/org),
  `tier/status/seats/seats_used/current_period_end/stripe_*`. RLS: the owner reads
  their own row; **all writes are service_role** (the webhook) — a user can't grant
  themselves a plan. Verified on throwaway local pg; the founder applies it at go-live.

## Why per-seat / Stripe (not App Store IAP)
Apple's IAP requirement is for **consumer** digital goods bought in-app. A B2B SaaS
plan sold to a coach/organization (per athlete seat) is billed off-platform via
**Stripe** — cleaner per-seat management, invoicing, and no 30% cut. The athlete never
sees a paywall; they're a seat on the coach's plan.

## Go-live wiring (when monetization turns on)
1. Apply migration `0010`.
2. Stripe: products/prices (per-seat), a Checkout or Billing Portal link for coaches,
   and a webhook (service_role Edge Function) that upserts the `subscriptions` row on
   `customer.subscription.*` events.
3. Add a "Manage / upgrade plan" CTA in Account that opens the coach's Stripe Billing
   Portal (a hosted URL — no in-app payment UI needed for B2B).
4. Resolve an **athlete's** entitlement from their coach's plan (an RPC/ view over team
   membership) so seats are enforced; until then athletes read preview.
5. Gate any paid-only features behind `isPro(entitlement)`.

## Optional later rail — direct consumer
If a solo athlete/parent plan is ever added, that one **does** need Apple/Google IAP
(via RevenueCat), with a RevenueCat→Supabase webhook writing the same `subscriptions`
shape. The `Entitlement` model already covers it; only the writer differs.

## Guardrails honored
- `src/core` pure; the gate is deterministic and fail-safe (never over-grants).
- Everything behind `isBackendLive`; flag-OFF + no-row = free preview, byte-identical.
- No payment SDK added; nothing charges anyone.
