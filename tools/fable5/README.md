# Fable 5 Orchestrator

Source of truth for the Fable 5 engine. Edit here, test here, then deploy.

- `fable5.js` — the Workflow (five phases: Audit → Design → Plan → Build → QA).
- `fable5.helpers.test.mjs` — `node --test` suite for the pure decision logic (extracted from `fable5.js`).
- `SKILL.md` — the `/fable5` front door.
- `deploy.sh` — copies `fable5.js` + `SKILL.md` to `~/.claude/workflows/` and `~/.claude/skills/fable5/`.

## Develop
    cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js

## Deploy
    bash tools/fable5/deploy.sh

## Invoke
Say "Fable 5, build <X>" or `/fable5 <X>`. Per-repo memory + config live in `.fable5/`.
Review the branch + `.fable5/reports/<date>-<slug>.md`, then merge (or `git reset --hard <tag>` to discard).
