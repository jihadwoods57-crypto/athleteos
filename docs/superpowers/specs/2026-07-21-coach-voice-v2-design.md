# Coach Voice v2 — Real AI-Path Wiring (Design)

**Date:** 2026-07-21
**Status:** Approved (design) — building
**Scope:** Handoff Section 7 (Coach Voice). Today `coach_voice_config` (0094) is read by exactly ONE function (`coach-voice-nudge`); the main athlete-facing feedback path (`analyze-meal`) uses a hardcoded generic "coach voice." This slice makes the coach's *configured* voice actually shape the per-meal feedback, adds version-stamping, and gates the change behind the `coach_voice_v2` feature flag (the first real consumer of the flag system shipped earlier today).
**Builds on:** `_shared/coach-voice.ts` (pure directive + banned-word guard), `coach-voice-nudge`'s private team→config loader, and the feature-flag evaluator `_shared/feature-flags.ts`.

---

## 1. Goal & posture

When a coach configures their Voice (tone / accountability level / approved phrases / banned words), that voice should shape the AI text the athlete actually reads on every meal — not just the optional nudge. It must do so **without** touching deterministic authority: it changes wording and emphasis, never macros, scores, requirements, deadlines, or safety. Every generated output records which voice version produced it, and a config edit never rewrites history.

Hard rules (already encoded in `buildVoiceSystem`'s hard-rails block, preserved verbatim): the AI is always AI (never signs as the coach), never introduces a number/fact not in the data, never creates a requirement / changes a deadline / alters a score / gives medical or weight-loss advice.

## 2. Foundation — reuse, don't duplicate

**2a. Split the directive from the tool line** (`_shared/coach-voice.ts`, pure):
- New `buildVoiceDirective(cfg: VoiceConfig): string` — everything `buildVoiceSystem` builds today EXCEPT the trailing `"Always answer by calling report_nudge."`.
- `buildVoiceSystem(cfg)` becomes `buildVoiceDirective(cfg) + "\n" + "Always answer by calling report_nudge."`. The nudge system prompt is byte-identical to today (regression-guarded by test).
- Rationale: analyze-meal's call uses a different tool (`MEAL_TOOL`), so it needs the voice directive without the nudge-specific closing line.

**2b. Extract the loader** (`_shared/coach-voice-load.ts`, has Deno I/O):
- `loadVoiceForAthlete(sb: SupabaseClient, uid: string): Promise<{ cfg: VoiceConfig; version: number; teamId: string } | null>` — the exact logic currently private in `coach-voice-nudge` (`team_members` active → `coach_voice_config` where `enabled`), now also returning `version`. Returns null when no active team / no config / Voice disabled.
- `coach-voice-nudge` is refactored to import this (behavior unchanged; it ignores `version`).

## 3. Version stamping — migration 0110

`0110_coach_voice_version.sql`:
- `alter table coach_voice_config add column version int not null default 1;`
- A `before update` trigger bumps `version = old.version + 1` whenever `config` or `enabled` changes (not on a no-op touch). This gives every generated output a monotonic version to record, and guarantees an edit never silently rewrites what a past output used.
- No grant changes (staff RLS from 0094 unchanged).

## 4. Wiring analyze-meal

In `analyze-meal`, the athlete-facing `note` (one coach-voiced sentence) and `analysis` (paragraph) are fields of the main forced-tool call (`MEAL_TOOL`). Integration:

1. After resolving `userId`, evaluate the `coach_voice_v2` flag for the caller using the flag evaluator (load the one flag row via service client + `evaluateFlag`). If off → today's path exactly (no load, no prompt change).
2. If on, `loadVoiceForAthlete(sb, userId)`. If null → today's path. If present → prepend `buildVoiceDirective(cfg)` to the main analysis `system` text (as its own cached system block, before the existing analysis instructions).
3. Record the applied `voice_version` on the meal's main `recordAiCall(...)` (add an optional `voiceVersion` field to the telemetry meta; null when voice not applied).
4. **Banned-word safety:** after the model returns, run `violatesProhibited(note + " " + analysis, cfg.prohibited)`. On a hit (rare), re-issue the SAME analysis call once WITHOUT the voice directive and use that result (a required field can't be nulled the way a nudge can). Log the fallback via telemetry (`outcome: 'voice_banned_fallback'`).

This keeps voice strictly additive: flag-off or config-absent or violation → the exact deterministic-safe output shipped today.

## 5. Flag

Seed `coach_voice_v2` in the flag system (default OFF). The founder flips it on for a pilot team via the flags panel (`enabled_org_ids`/`enabled_user_ids`). Because the flag is evaluated per-athlete server-side in analyze-meal, kill-switch is immediate.

## 6. Permissions / safety invariants

- Voice only ever changes free-text `note`/`analysis`. Macros, score, `detected`, `substitution` numbers, timing verdicts are untouched (they come from the same structured call but the directive's hard rails + the deterministic scoring downstream own them).
- No coach impersonation, no fabricated facts, no medical advice (hard-rails block, unchanged).
- Version recorded per output; config edits bump version and never alter stored outputs.

## 7. Tests

- **Pure (jest):** `buildVoiceDirective` contains tone/level/approved/banned + hard rails and does NOT contain the nudge tool line; `buildVoiceSystem` output equals `buildVoiceDirective + nudge line` (regression: nudge prompt unchanged). `violatesProhibited` reused as-is (already tested).
- **Loader (jest):** `loadVoiceForAthlete` returns null when disabled / no team; returns `{cfg,version,teamId}` when enabled (with a mocked supabase client).
- **RLS (docker):** 0110 — a staff member can still read/update their team's config; version bumps on a config change and not on a no-op. Non-staff still denied (0094 policies unchanged).
- **Guardrail:** analyze-meal path is behind the flag; a flag-off run produces byte-identical output to today (assert the system prompt is unchanged when flag off).

## 8. Acceptance criteria (Section 7)

1. With `coach_voice_v2` on and a team Voice config, an athlete's meal `note`/`analysis` reflect the configured tone/level and may echo approved phrases; banned words never appear.
2. Voice changes wording/emphasis only — macros, score, requirements, deadlines are identical to a flag-off run on the same input.
3. Every voiced output records the `voice_version` used; editing the config bumps the version and does not alter past outputs.
4. An athlete whose team has no config (or Voice disabled, or flag off) gets the safe default output.
5. A prohibited-word slip triggers a no-voice fallback, not a shipped violation.
6. The nudge path is unchanged (byte-identical system prompt).

## 9. Files

- Modify: `supabase/functions/_shared/coach-voice.ts` (add `buildVoiceDirective`, refactor `buildVoiceSystem`).
- Create: `supabase/functions/_shared/coach-voice-load.ts` (loader + version).
- Modify: `supabase/functions/coach-voice-nudge/index.ts` (use the shared loader).
- Create: `supabase/migrations/0110_coach_voice_version.sql` (version column + bump trigger).
- Modify: `supabase/functions/analyze-meal/index.ts` (flag check → load → prepend directive → stamp version → banned-word fallback).
- Modify: `supabase/functions/_shared/ai-telemetry.ts` (optional `voiceVersion` field) — only if the meta doesn't already accept arbitrary fields.
- Test: `src/core/coachVoiceDirective.test.ts` (pure), `src/core/coachVoiceLoad.test.ts` (loader), RLS additions in `supabase/tests/rls_authz_test.sql`.
- Migration seed: add `coach_voice_v2` to `0109` seed set OR a tiny follow-up insert in 0110 (default OFF).

## 10. Explicitly NOT this slice

**Per-output voice-version stamping** (recording the applied `voice_version` on each meal's `ai_calls` row). `ai_calls` has a fixed column set (no jsonb meta), so this needs a schema + telemetry-contract change across all six AI functions — disproportionate to its observability value right now. The core AC3 guarantee (a config edit bumps `version` and never retro-alters past state) IS delivered by the 0110 version column + bump trigger; the per-row stamp is a fast-follow (add `ai_calls.voice_version`, pass it from analyze-meal). Also deferred: wiring weekly-digest and meal-chat (same shared loader + directive — a trivial follow-up once this lands); a coach-facing Voice preview/test-console; org/group-level voice inheritance; per-athlete voice overrides. This slice proves the pattern on the highest-value surface (every meal) and leaves the rest as fast-follows.
