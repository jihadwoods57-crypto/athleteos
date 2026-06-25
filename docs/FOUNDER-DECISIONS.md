# Founder Decisions — queued judgment calls (4-day sprint)

The crew logs here instead of guessing on anything that needs a product call or that
changes a documented assumption. Each entry: what, why it's ambiguous / needs you, and
the options. Newest first.

---

## D1 — Two new go-live migrations (0004, 0005) must be applied to the live project

**What.** Stage A recorded migrations `0001`-`0003` as the applied set on the live
project (`ftwrvylzoyznhbzhgism`). The P0 backend wiring needs **two more**, both
authored this sprint and applied only to a throwaway LOCAL stack to verify the
round-trip — never to the live project (guardrail):

- **`0004_create_team.sql`** — a `create_team(name, sport)` RPC. Stage B says "the coach
  creates a team + a real invite code," but there was no such RPC and `team_staff` RLS
  blocks a coach from self-inserting the first staff row (chicken-and-egg). The RPC does
  it atomically (SECURITY DEFINER) and returns a real, unique 6-char join code that
  replaces the static `EAGLES24`.
- **`0005_grants.sql`** — explicit table/sequence/function GRANTs to
  `anon`/`authenticated`/`service_role`. The local round-trip failed with
  `permission denied for table days` (42501) until these were added: RLS decides which
  *rows* a role may touch, but a role must also hold table-level privileges first. A
  hosted Supabase project is usually saved by the platform's default-privileges, so the
  live project *may* already work without 0005 — but applying it is harmless and idempotent
  and makes the schema portable to any fresh/self-hosted apply.

**Why it needs you.** Applying migrations to the live project is a guardrailed action the
crew will not take. Also a judgment call: do you want `create_team` exactly as written
(no org row, head_coach only, server-generated code), or tied into an `orgs` row and the
college/HS staff model?

**Options.**
1. Apply both `0004` + `0005` as-is at go-live (`supabase db push`), then verify a coach
   can create a team and an athlete can join by the returned code. (Recommended — the
   round-trip is proven locally.)
2. Apply `0004` only if you confirm the live project already has the anon/authenticated
   grants from the platform; still safe to apply `0005` too.
3. Revise `create_team` first (org linkage, staff roles, code format/length) — tell the
   crew the shape and it will re-author.

**Status:** built + runtime-verified locally; NOT applied to the live project. Awaiting you.

---

## D2 — Email-confirmation policy for the live auth flow

**What.** The local round-trip ran with `enable_confirmations = false` (sign-up returns a
session immediately). The auth wrappers already handle confirmations-on gracefully
("check your email"), but the beta UX differs a lot between the two.

**Why it needs you.** It's a product + deliverability decision (and minors: a confirmation
email may go to a guardian).

**Options.** (1) Confirmations OFF for the closed beta (fastest onboarding).
(2) Confirmations ON (standard, needs a working email sender configured in Supabase).

**Status:** seam handles both; default not chosen. Awaiting you.
