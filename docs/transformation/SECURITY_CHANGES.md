# Security & Data Integrity — findings and changes

Read-only audit of 38 edge functions, 151 migrations, storage policies and the RLS suite, plus
verification against a local database with every migration applied. **Production was never
touched.**

## Verified clean (stated plainly, because a verified negative is a result)

| Area | Result |
|---|---|
| Cross-tenant identity | **No service-role function derives the acting user from the request body.** 23 functions create a service-role client; every one resolves identity from a verified JWT or a signed credential. `send-push` looks like the classic bug at `index.ts:211` but authorizes against the caller's own JWT via `can_view()` at `:217` *before* the service-role client is created at `:221`. |
| RLS coverage | **85 of 85 tables have RLS enabled.** 23 have RLS with zero policies — deny-by-default, service-role only, and documented as intentional. |
| Unauthenticated endpoints | Every `verify_jwt = false` function has a real credential: Stripe/RevenueCat signatures, HMAC-signed roll-call codes, 128-bit guardian tokens, or a deliberately-anonymous analytics sink with a 47-name allowlist and a PII regex firewall. |
| Storage | Both buckets private. `meal-photos` and `progress-photos` are path-scoped to `auth.uid()`; `meal-photos` additionally caps size and MIME type and excludes SVG. |
| Input validation | Consistently bounded across the AI surface — photo 8 MB, description 2000 chars, clarifications 5×, foods ≤8 with numeric clamping. Prompt injection is handled by framing model input as data plus forced tool-use with server-side re-assembly. |

## Changed

### Migration 0150 — table grants for direct client writes

Third recurrence of the class `0036` and `0098` each fixed. `0013` revoked the default DML grant
for future tables, so any post-0013 table written directly through PostgREST needs an explicit
grant. Without it the caller gets **42501 before RLS is evaluated** — policies read as correct,
the RLS suite passes (it asserts row visibility, not table privilege), and the feature is simply
broken. Every affected call site swallows its error, so all four failures are silent.

| Table | Status | Impact |
|---|---|---|
| `team_rooms` (0087) | **Live on prod** | Every create / rename / delete / re-own of a position room fails. |
| `team_week_pattern` (0100) | **Live on prod** | Every coach week-pattern save fails. |
| `device_tokens` (0028) | **Live on prod** | Sign-out cannot delete this device's push token, so nudges for the signed-out account keep arriving — the exact leak the code comment says it prevents. Two people sharing a phone is the realistic case. |
| `commitment_locations` (0138) | Not yet on prod | Had a SELECT-only grant *and no insert policy at all*, so `saveLocation()` could never succeed. Verified Commitments would have shipped with its location-creation path dead. Adds `cl_staff_insert`, mirroring `cl_read`'s authorization exactly. |

Least privilege throughout: `device_tokens` gets DELETE only (inserts still go through the
`register_device_token` SECURITY DEFINER RPC); `team_week_pattern` gets no DELETE.

Two further findings from the audit were **checked and rejected**: `athlete_exceptions` and
`coach_interventions` have policies wider than the client's actual writes, which is untidy but
breaks nothing. They are not in this migration.

**Guard against a fourth recurrence:** `src/core/directWriteGrants.test.ts` reads what the shipped
client actually writes and requires a matching grant, encoding the real rule — only post-0013
tables need one. It found `commitment_locations` and `device_tokens`, which the human audit
had missed.

### Migration 0151 — revoke TRUNCATE / TRIGGER / REFERENCES

62 of 85 tables granted these to **both `anon` and `authenticated`**, including `days`, `meals`,
`profiles` and `teams`. They come from the Supabase platform bootstrap, not from any migration
in this repo.

Severity stated honestly: **this is defense-in-depth, not an open door.** PostgREST exposes no
TRUNCATE verb and no DDL, so no request today reaches these privileges. What makes them worth
removing is the blast radius if anything ever does — `TRUNCATE` **bypasses RLS entirely**, and
`TRIGGER` is a standard privilege-escalation primitive. Safe by construction: all three are used
only by migrations, which run as the table owner.

Verified after applying: DML grants unchanged (`authenticated` retains 62 SELECT / 38 INSERT /
37 UPDATE / 30 DELETE; `anon` retains its 11 intentional SELECTs).

### RLS suite — 417/419 → 419/419

Two `vc2` checks depended on wall-clock time: the fixture schedules a commitment at a fixed
06:00–08:00 and the assertions only hold inside `my_armable_geofences()`'s window of 04:00–08:30.
Outside it the function correctly returns `[]`, and `bool_and()` over zero rows is NULL rather
than true.

Diagnosed rather than assumed: the function returns exactly the nine keys the assertion allows,
and at 20:33 the window predicate evaluates false. Removing the two migrations reproduced 417/419
identically, proving the failures pre-existed this work.

**This is the most dangerous thing found in the pass.** A security suite that is red 81% of the
day trains its readers to expect "417/419" — which is precisely how a real hole reaches
production unnoticed.

### Role authorization (client chrome)

Two leaks, both because a screen with no declared `nav` fell back to the athlete shell and
neither router guard covers parents:

- A parent opening *Fund a plan* / *Funded plans* was handed the **athlete tab bar**.
- A coach or trainer **could not delete their account at all** — `delete-account` is linked from
  privacy and terms, but the mirror guard bounced any operator back to their root. The regression
  test then surfaced that parents were blocked too. That is a data-rights problem.

Fixed at the root (`navFor`, `roleNav`, `tabbar`), with negative-case regression tests for all
four roles. `tabbar()` now renders **no** tab bar for a role it has no tabs for — failing to
nothing is correct; failing to another role's chrome is not.

## Not fixed — carried to KNOWN_RISKS

- **P1 · Unbounded anonymous AI spend.** ~5,000 paid Anthropic photo analyses/day reachable with
  the shipped anon key across rotating IPs, with no dollar cap anywhere in the repo. The tier
  budget helper is explicitly "a SIGNAL, not a gate".
- **P2 · Non-constant-time secret comparison** in `admin-alert:24`, `admin-auth-monitor:46`,
  `admin-brief:16`. Three sibling cron functions already use `safeEqual`.
- **P2 · `commitment_audience(uuid)`** has no internal authz and is not revoked from PUBLIC.
- **P2 · `progress-photos`** lacks the size/MIME limits `meal-photos` has.
- **P2 · `plan-generate`** applies its global cap to signed-in users, so anon abuse can 429 paying
  coaches until UTC midnight.
