# Crew Memory

Cross-cycle learnings. The orchestrator reads this **before** each cycle and appends to it **after**.
Newest entry at the top.

**Purpose:** so a later cycle doesn't re-propose what an earlier cycle's verifier or oracle already
killed. Discovery dedups against what's been **seen** here, not just what shipped — that's what makes
the loop converge instead of thrashing.

## Format
```
### <date> · cycle iN · <area>
- Tried: <what>
- Result: shipped (<tag>) | rejected by <oracle|verifier|constitution> because <why>
- Lesson: <what a future cycle should know>
```

## Entries
_(none yet — the first run populates this)_
