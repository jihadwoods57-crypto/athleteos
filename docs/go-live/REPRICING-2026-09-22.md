# Consumer repricing — App Store Connect + RevenueCat — 2026-09-22

Applies the founder's 2026-09-21 subscription re-map (see
`memory/pricing-remap-and-entitlement-2026-09-21.md`) to the two places a price actually lives:
Apple's catalog and RevenueCat's offering.

Console/API work only. No repo source changed. Nothing committed by this pass except this file,
which is left uncommitted.

- App: `6787705639` / `com.onstandard.app`
- Subscription group: **OnStandard Membership** `22394757`
- RevenueCat project `projb14991df`, App Store app `appb67dffb647`, entitlement `premium`
  (`entla9e1cbb801`), offering `default` (`ofrngacc2c4196d`, is_current)
- Zero subscribers, so no price-preservation question: every price was written with
  `preserveCurrentPrice: false` and no `startDate` (effective immediately).

## What changed

Four products repriced in all 175 territories. Two Plus products deleted outright — from Apple,
from the RevenueCat offering, from the entitlement, and from RevenueCat's product catalog.

| Product | Was (USD) | Now (USD) | Territories | ASC state after | Review screenshot |
|---|---|---|---|---|---|
| `onstandard_individual_monthly` (6813437416) | 9.99 | **19.99** | 175 | `READY_TO_SUBMIT` | `COMPLETE` |
| `onstandard_individual_annual` (6813437592) | 84.00 | **199.99** | 175 | `READY_TO_SUBMIT` | `COMPLETE` |
| `onstandard_family_monthly` (6813437473) | 18.99 | **24.99** | 175 | `READY_TO_SUBMIT` | `COMPLETE` |
| `onstandard_family_annual` (6813437474) | 155.99 | **249.99** | 175 | `READY_TO_SUBMIT` | `COMPLETE` |
| `onstandard_individual_plus_monthly` (6813437807) | 14.99 | **DELETED** | — | gone | — |
| `onstandard_individual_plus_annual` (6813437820) | 125.99 | **DELETED** | — | gone | — |

Every USA price point was matched on an **exact** `customerPrice` string — `"19.99"`, `"199.99"`,
`"24.99"`, `"249.99"` — each of which resolved to exactly one point out of the 800 USA points the
API returns per subscription. No rounding, no "nearest tier" guessing.

USA price-point ids used:

- individual monthly → `…InQiOiJVU0EiLCJwIjoiMTAxNzcifQ` (tier 10177, proceeds 16.99)
- individual annual → `…InQiOiJVU0EiLCJwIjoiMTA1OTAifQ` (tier 10590, proceeds 169.99)
- family monthly → `…InQiOiJVU0EiLCJwIjoiMTAyMDIifQ` (tier 10202, proceeds 21.24)
- family annual → `…InQiOiJVU0EiLCJwIjoiMTA2MDYifQ` (tier 10606, proceeds 212.49)

### Spot-check of the equalized ladder (read back from Apple after the writes)

| Territory | ind/mo | ind/yr | fam/mo | fam/yr |
|---|---|---|---|---|
| USA | 19.99 USD | 199.99 USD | 24.99 USD | 249.99 USD |
| CAN | 24.99 CAD | 249.99 CAD | 34.99 CAD | 349.99 CAD |
| GBR | 19.99 GBP | 199.99 GBP | 24.99 GBP | 249.99 GBP |
| DEU / FRA | 22.99 EUR | 229.99 EUR | 29.99 EUR | 299.99 EUR |
| JPN | 3000 JPY | 30000 JPY | 4000 JPY | 40000 JPY |
| AUS | 29.99 AUD | 299.99 AUD | 39.99 AUD | 399.99 AUD |
| IND | 1999 INR | 19900 INR | 2499 INR | 24900 INR |
| BRA | 129.90 BRL | 1299.90 BRL | 149.90 BRL | 1499.90 BRL |
| MEX | 399 MXN | 3999 MXN | 499 MXN | 4999 MXN |

Each product carries 175 price rows and, separately, **175 introductory offers, all still
`FREE_TRIAL` / `TWO_WEEKS` / 1 period, startDate 2026-09-18, no end date**. Repricing did not
disturb the 14-day trial — checked explicitly after the writes, because that was the obvious thing
for a price rewrite to clobber.

### The Plus products

Both were `READY_TO_SUBMIT`, never submitted, never sold. `DELETE /v1/subscriptions/{id}` was
**accepted** for both — 204, no error. The subscription group now contains exactly four
subscriptions. So: **deleted, not merely detached.**

### RevenueCat read-back

```
products: 4
  prod15829d2bd5 onstandard_individual_annual   active
  prod2a601bc32d onstandard_family_monthly      active
  prod4e7aa7b253 onstandard_family_annual       active
  proddb01899f44 onstandard_individual_monthly  active

entitlement premium (entla9e1cbb801): 4 products — the same four

offering default (ofrngacc2c4196d) current=true: 4 packages
  pos=1 individual_monthly -> onstandard_individual_monthly
  pos=2 individual_annual  -> onstandard_individual_annual
  pos=3 family_monthly     -> onstandard_family_monthly
  pos=4 family_annual      -> onstandard_family_annual
```

Order of operations that worked: `POST /entitlements/{id}/actions/detach_products` with both Plus
product ids → `DELETE /projects/{p}/packages/{pkg}` for `pkgea07cf4a00e` and `pkgecc5dacc16f` →
`DELETE /projects/{p}/products/{prod}` for `prod731984ec42` and `prodd45d095061`. All four deletes
returned success. RevenueCat renumbered the surviving packages 1–4 on its own; nothing had to be
re-ordered by hand.

Webhook and API keys untouched.

## Gotchas this pass paid for

**1. `/equalizations` returns NO territory relationship. The territory is inside the id.**

This is the one that nearly shipped a silent no-op. The first equalization run reported
`wrote=0 skipped=174 failed=0` and looked like a clean idempotent re-run. It wasn't: the code read
`point.relationships.territory.data.id`, that path does not exist on this endpoint, so every
territory came back `undefined` and every one was skipped. A read-back caught it — USA said 19.99
while CAN still said 12.99 CAD and GBR still said 9.99 GBP, i.e. the old $9.99 ladder.

`GET /v1/subscriptionPricePoints/{id}/equalizations` returns objects with only
`attributes.customerPrice`, `attributes.proceeds`, and `relationships.equalizations` /
`adjustedEqualizations` link stubs. Adding `include=territory` does not help. The territory is
encoded in the price-point id, which is base64url JSON:

```
eyJzIjoiNjgxMzQzNzQxNiIsInQiOiJBRkciLCJwIjoiMTAxNzcifQ
  -> {"s":"6813437416","t":"AFG","p":"10177"}   // subscription, territory, tier
```

Decode `t` from the id. And: **a skip count that exactly equals the total is a bug, not a
no-op** — always confirm a repricing by reading back a non-USA territory, never just USA.

**2. `POST /v1/subscriptionPrices` is an upsert. No delete step is needed.**

The brief expected to have to `DELETE /v1/subscriptionPrices/{id}` per territory first. Not so —
posting a new price for a territory that already has one returns 201 with the **same price-row
id** as the existing row (the row id is base64url of `{"a":appOrSubId,"c":"US","d":0,"p":"0"}` —
it encodes the territory but not the price point, so it is stable across reprices). Probing on USA
first, as instructed, is what revealed this and saved 700 delete calls.

Body that works, with no `startDate`:

```json
{"data":{"type":"subscriptionPrices",
  "attributes":{"preserveCurrentPrice":false},
  "relationships":{
    "subscription":{"data":{"type":"subscriptions","id":"<subId>"}},
    "subscriptionPricePoint":{"data":{"type":"subscriptionPricePoints","id":"<pointId>"}}}}}
```

The territory is implied by the price point; there is no territory relationship to send.

**3. Price points are per-subscription, not global.**

`/v1/subscriptions/{id}/pricePoints?filter[territory]=USA` returns 800 points and the ids are
scoped to that subscription (`"s"` in the decoded id). A point id harvested from one product
cannot be posted to another. Each of the four products needed its own lookup.

**4. `customerPrice` is a loosely formatted number string.**

Apple returned the old individual-annual price as `"84.0"`, not `"84.00"`, and Indian prices as
`"1999.0"`. Exact string comparison against a target like `"19.99"` happens to work for the four
targets here, but the matcher normalises through `Number()` before comparing so a `"19.990"` or
`"19.9"` would still be caught. Do not assume two decimal places.

**5. RevenueCat: there is no `/offerings/{o}/packages/{pkg}/products` route.**

`GET` on it returns `404 resource_missing` (`{"type":"resource_missing"}`). Two things that do
work: `GET /projects/{p}/offerings/{o}/packages?expand=items.product`, which inlines each
package's products, or the flat `GET /projects/{p}/packages/{pkg}/products`. Packages are
project-level objects; deleting one is `DELETE /projects/{p}/packages/{pkg}`, with no offering id
in the path.

**6. Rate limiting never actually bit — but only because of the throttle.**

~700 writes to ASC across the four products at 200 ms between calls, with exponential backoff
(2 s → 60 s, honouring `Retry-After`) armed on 429 and 5xx. Zero 429s were observed, zero retries
fired, zero failures. At a faster cadence this would likely be a different story; the throttle is
cheap and the whole pass still ran in a few minutes per product.

**7. Everything was re-read after writing.**

`GET /v1/subscriptions/{id}` after each product confirmed the state stayed `READY_TO_SUBMIT` —
nothing dropped back to `MISSING_METADATA`, and `GET /v1/subscriptions/{id}/appStoreReviewScreenshot`
confirmed `assetDeliveryState.state = COMPLETE` on all four. No regressions to fix.

## What this does NOT do

- Does not submit anything to App Review. All four remain `READY_TO_SUBMIT`; they ride along with
  the next app version submission.
- Does not touch the in-app price copy. Any hard-coded "$9.99" / "$84" strings in
  `proto/redesign-2026-07/` or in the marketing site are a separate pass and must be checked
  before the next OTA — a paywall showing the old number over a $19.99 product is a rejection risk
  and a trust problem.
- Does not touch the Room ($99) or School ($1,499) tiers, which are not App Store products.
- Does not resolve the standing blocker: the **Paid Applications agreement is still pending**
  (founder awaiting EIN), so Apple serves no products to the app regardless of how they are
  priced. Sandbox purchase testing is still owed once that clears.
