# Role & Permission Matrix

## Roles

The role picker offers **six** identities; they collapse onto **four** values of `RT.authRole`.

| Picker role | Onboarding route | `signUp` role | Distinct app shell? |
|---|---|---|---|
| Athlete | `oba` | `athlete` | yes |
| Fitness Client | `obf` | **`athlete`** | no — narrative only |
| Coach | `obk` | `coach` | yes |
| Trainer | `obt` | `trainer` | yes |
| Parent | `obp` | `parent` | yes (no tab bar) |
| Nutrition Professional | `obn` | **`trainer`** | no — narrative only |

There is no `client` or `nutritionist` value anywhere. Worth a product decision: two of six
advertised identities are presentation, and a Nutrition Professional lands in a shell built for
personal trainers.

Role is set at `signUp`, read from `profiles.primary_role` on sign-in, and re-read on boot.

## Shells

| Shell | Root | Tabs |
|---|---|---|
| athlete | `home` | Home · Plan · **Camera (FAB)** · Progress · Profile |
| coach | `coach-home` | Home · Roster · **Create (FAB)** · Inbox · Insights |
| trainer | `trainer` | Home · Clients · **Create (FAB)** · Inbox · Grow |
| operator | — | virtual: admits coach **and** trainer |
| parent | `parent` | **none** |

Coach has no Profile tab by design — the header avatar is its only entry point.

## Enforcement model

**The server is the wall. The client is presentation.** This is deliberate and documented in the
source:

- `js/roles.js:1-7` — the WebView runs plain selects with no coach-id filter; RLS `can_view()`
  scopes rows. The anon key ships in the page precisely because RLS is the real authorization.
- `js/staff-access.js:4-6` — the staff capability map "only decides what the CLIENT offers", and
  deliberately **fails open** on a slow role fetch because the server re-checks.

Client-side guards exist only to avoid offering a button the server will refuse. Both router
guards `return` after setting `location.hash`, so a wrong answer is a *silent* redirect — which
is why `router-roles.test.mjs` asserts the matrix rather than trusting review.

## Staff sub-roles (within `coach`)

`head_coach`, `coordinator`, `position_coach`, `nutritionist`, `s_and_c`, `athletic_trainer`,
`team_admin`, `readonly`. These gate the Create menu contents, not routes. Server-side they are
enforced by scoped `can_view` and readonly write-guards (migrations 0077/0078), with `0147`
splitting `team_staff` write from read so only a head coach can rewrite the staff table.

## Route admission

| Screen `nav` | athlete | coach | trainer | parent |
|---|:--:|:--:|:--:|:--:|
| `athlete` / undeclared | ✅ | ❌ | ❌ | — |
| `coach` | ❌ | ✅ | ❌ | ❌ |
| `trainer` | ❌ | ❌ | ✅ | ❌ |
| `operator` | ❌ | ✅ | ✅ | ❌ |
| `parent` | ❌ | ❌ | ❌ | ✅ |
| `roleNav()` getter | ✅ | ✅ | ✅ | ✅ |

Coach-only, denied to trainers: `coach-rooms`, `coach-announce`.

## Fixed in this pass

Two leaks, both from a nav-less screen defaulting to the athlete shell while neither guard
covered parents:

1. **Parent inherited the athlete tab bar** on `fund-plan`, `funded-plans`, `my-trainer-offers` —
   five tabs to places a parent has no account for.
2. **Coaches, trainers and parents could not delete their account.** `delete-account` is linked
   from privacy and terms (reachable by every role) but resolved to the athlete shell, so the
   mirror guard bounced operators back to their root and `navAdmits` refused parents.

Fixed at `navFor()` / `roleNav()` / `tabbar()`. `tabbar()` now renders **no** tab bar for a role
it has no tabs for. Negative-case regression tests cover all four roles.

## Verified server-side (unchanged, re-confirmed)

- 85 of 85 tables have RLS enabled.
- No service-role edge function derives the acting user from a request body.
- Both storage buckets are private and path-scoped to `auth.uid()`.
- 419/419 adversarial authorization checks pass, including negative cases — a coach cannot reach
  an athlete outside their team, a non-guardian cannot grant consent, a minor cannot self-approve.
