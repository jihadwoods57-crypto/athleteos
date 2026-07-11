---
name: fable5
description: Drive a vision through the five-phase Fable 5 build pipeline — Audit → Design → Plan → Build → QA — with real model-specialized sub-agents (Opus on Audit/Design/Plan/QA, Sonnet on Build, Fable 5 orchestrating), a persistent .fable5/ Project Memory, a clickable design prototype, adversarial QA, and a branch-only safety model. It NEVER merges to master. Use when the user says "Fable 5", "/fable5", "run the orchestrator", "build me X end-to-end", or "audit and build X". Scoped to one vision per run; for autonomous overnight app-wide improvement use crew-forge instead.
---

# Fable 5 Orchestrator — front door

You (the agent) preflight the repo, then launch the Fable 5 Workflow. The Workflow is the orchestrator; you are the launcher.

## When to use
- "Fable 5, build/audit/ship <X>" · "/fable5 <X>" · "run the orchestrator on <X>".
- One vision per run. Sibling: `crew-forge` (autonomous, app-wide, overnight). Fable 5 is you-launched and scoped.

## Preflight (do these IN ORDER, stop on the first failure)
1. **Get the vision + scope.** The vision is the user's words. Scope is `feature` (default) or `app` (whole-app audit fan-out). If the vision is unclear, ask ONE clarifying question, then proceed.
2. **Clean tree.** Run `git status --porcelain`. If dirty, stop and tell the user to commit/stash first.
3. **Scaffold `.fable5/` if missing.** If `.fable5/config.json` does not exist, create `.fable5/` from the templates in `tools/fable5/` (config.json, memory.md seeded from the repo's vision docs, reports/), and commit it.
4. **Cut the run branch.** Compute `slug` from the vision (lowercase, non-alphanumerics → `-`, capped 40). Create + checkout `fable5/$(date +%Y-%m-%d)-<slug>` from the current branch. (Build happens here; master is never touched.)
5. **Launch.** `Workflow({ name: 'fable5', args: { vision: "<vision>", scope: "<feature|app>" } })`. It runs in the background and notifies on completion.

## After the run
- Read `.fable5/reports/<date>-<slug>.md` — the run report (audit decision, design + prototype link, plan, what built, refute-verified bugs, founder-gated proposals, tokens/phase).
- Review the branch diff (`git diff master...HEAD`) and the prototype Artifact.
- **You** merge the branch to master, or `git reset --hard <tag>` to discard. Fable 5 never merges.

## Safety (binding)
Branch-only, tagged per run, never merged. No live migrations, deploys, secret access, or test/RLS weakening — those come back as founder-gated proposals in the report.
