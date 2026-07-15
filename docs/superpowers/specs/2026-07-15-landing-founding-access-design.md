# Landing page: one conversion truth — Founding Access

**Date:** 2026-07-15 · **Scope:** `web/landing/index.html`, `web/landing/js/site.js` (copy-level only)

## Problem

The live page promises "Start your 14-day trial" on every CTA, but clicking any button opens
an "Early access" waitlist dialog ("we'll reach out as spots open" / "Request early access"),
and the product is not ready to onboard outside professionals yet (founder-confirmed 2026-07-15).
A visitor experiences a bait-and-switch at the moment of highest intent. Flagged in an external
(ChatGPT) critique as the page's #1 conversion defect; founder chose the "controlled access"
resolution.

## Principle

Every path on the page leads to one action — requesting **founding access** via the existing
dialog — and no copy promises anything that starts today. The 14-day trial moves from
*promise* ("start now") to *terms* ("what you get when we onboard you"). The Founding 50
offer (already on the page) becomes the payoff of every CTA, not a footnote.

## Changes

1. **Nav CTA** — label → "Request founding access" (short: "Founding access"); mailto subject
   → "OnStandard founding access". Stays a mailto `<a>` so the no-JS fallback path survives.
2. **Hero primary CTA** — same label/subject swap. "Join through my coach or trainer"
   secondary and the free-for-athletes fine print stay.
3. **Story CTA** — same swap; the Founding 50 paragraph above it is now the setup the button
   pays off.
4. **Pricing** — Professional price-kicker "/month · 14-day free trial" → "/month · Founding 50
   lock 50% off"; Professional button → "Request founding access". Programs price-kicker
   "30-day trial" → "30-day trial at onboarding"; "Book a program demo" button stays (a demo
   is deliverable today). Athlete card unchanged.
5. **Pricing assurance list** — future-framed: "Free 14-day trial when we onboard you · No
   card until you start · Personal onboarding, usually within a day · Your record is portable
   forever."
6. **Finale** — button → "Request founding access"; ticks → "Founding 50: 50% off for 12
   months · Free 14-day trial when onboarded · We onboard founding professionals personally."
7. **Role cards (deviation from the presented design, same principle)** — Coach/Trainer
   buttons "Start free →" are also a today-promise; → "Request access →". Athlete/Parent/
   Program card buttons unchanged.
8. **Dialog** — static HTML already honest; only `INTENTS.trial` in `site.js` is rewritten
   (kicker "Founding access", heading "Claim a founding spot.", sub explaining Founding 50 +
   trial-at-onboarding, submit "Request founding access"). `join`/`demo`/`access` intents
   unchanged. Intent key stays `trial` so `data-intent` wiring and the `/api/waitlist`
   payload field are untouched.
9. **Cache-busting** — bump `js/site.js?v=8` → `?v=9` (Cloudflare edge caches versioned
   assets; HTML is not cached). CSS untouched, stays `?v=8`.

## Not changing

Hero visuals/layout, score section, FAQ, why-grid, roles imagery, meta/OG tags (verified: no
trial mentions), waitlist API, CSS.

## Verification

Local preview (`python -m http.server 8130` in `web/landing`) + Playwright: every `.js-wl`
CTA opens the dialog with the matching intent copy at desktop and mobile widths; `grep -i
trial` over `index.html` shows only future-framed mentions; no-JS check that CTAs remain
reachable links/buttons.
