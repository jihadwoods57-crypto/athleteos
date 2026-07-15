# Honest Vision — The Clarifying Moment (design)

**Status:** approved (founder gave standing authority to decide + finish, 2026-07-15)
**Scope:** surface the meal-analysis clarifying-questions flow the backend already returns.
**Pillar:** Intelligence (the headline) + Accountability (a trustworthy number).

## The one line
When the AI genuinely can't tell what's on the plate from the photo alone, it **asks the
athlete** ("anything under the pancakes — sausage, eggs?") instead of fabricating a number —
then commits macros you can trust. Every other app guesses silently; OnStandard asks.

## Why this is the 10/10 (and why it's small)
The `analyze-meal` edge function is already a complete, production-grade Claude-vision
system: forced structured output, macro grounding, reconcile-on-contradiction, spend caps,
and a **two-phase clarify flow** — phase `analyze` may return `{kind:'questions', questions:
[...]}`; phase `finalize` accepts `clarifications:[{question,answer}]` and folds the answers
in as truth for what the camera can't see.

The client throws that away. `state.js runAnalysis()` today:

```js
if (data.kind === 'questions') {
  const fin = await invoke('analyze-meal', { ...body, phase:'finalize', clarifications: [] });
  // ^ questions discarded, model forced to guess, a second paid call spent for nothing
}
```

So the single most honest, most differentiating moment of the whole vision system is built,
paid for on every unsure meal, and hidden. This spec surfaces it. No backend change.

## What ships
1. **`meal-intel.js` — `buildClarifications(questions, answers)`** (pure, tested): zip the
   asked questions with the athlete's answers, drop blank answers, cap lengths — the exact
   shape `finalize` wants.
2. **`state.js`**
   - `runAnalysis()` no longer auto-finalizes. On `{kind:'questions'}` it stores
     `MEAL.questions` and returns `{ ok:true, kind:'questions' }`; on `{kind:'result'}` it
     grounds + stores and returns `{ ok:true, kind:'result' }`. Errors unchanged.
   - New `finalizeAnalysis(answers)`: rebuilds the body, calls `finalize` with
     `buildClarifications(MEAL.questions, answers)`, grounds + stores the result, returns
     `{ ok } | { ok:false, error }`. `answers = []` (Skip) still finalizes — the model
     estimates without them, exactly as today, so nothing regresses.
   - `clearMeal()` clears `MEAL.questions`.
3. **`meal.js`**
   - `analyzing.mount` branches on `runAnalysis()`'s `kind`: `questions` →
     `#meal-questions`; `result` → `#meal-analysis`; error path unchanged.
   - New exported `mealQuestions` screen: the photo thumbnail for context, a short coach-voice
     header ("A couple things the photo can't show"), one text input per question, a primary
     "Get my result" (→ `finalizeAnalysis(answers)` → `#meal-analysis`), and a quiet
     "Skip, just estimate" (→ `finalizeAnalysis([])`). An inline busy state on submit; on
     error, the same retake recovery as the analyzing screen. Empty `MEAL.questions` (deep
     link) routes back to `#camera`.
4. **`index.js`** registers `'meal-questions': mealQuestions`.
5. **`flows.css`/`screens.css`** — `.mq-*` styling on system tokens only.

## Honesty guardrails (Constitution)
- Never fake AI (Rule 8): the questions are the model's real `ask_clarifying` output; answers
  are sent verbatim to `finalize`. Nothing is invented client-side.
- The number stays trustworthy: answers feed the SAME grounded result path
  (`groundResult`), so macros are still DB-bounded before they touch the score.
- Reduce decisions / one next action (Rules 5, 7): at most 3 questions (the function caps
  it), short answers, and a one-tap Skip so logging never blocks. Fail honest — Skip finalizes
  exactly as today.
- Minor-safe: this only refines what the athlete ate; no calorie *targets* are generated here
  (those stay deterministic elsewhere).

## Explicitly NOT in scope
- No edge-function change. No new analysis modes. No re-grounding logic.
- No quick-chip answer UI (free text v1; the model asks open questions).
- No deterministic-fallback rework (when AI is unconfigured the existing error/retake path is
  untouched — a separate concern).

## Boundaries
| Unit | Responsibility | Depends on |
|---|---|---|
| `buildClarifications` (meal-intel) | pure zip/clean of Q+A → finalize shape | — |
| `runAnalysis` / `finalizeAnalysis` (state) | two-phase orchestration + grounding | supabase fn, groundResult |
| `mealQuestions` screen (meal) | collect answers, drive finalize | state, components |
| route + CSS | register + style | — |

## Test plan
- Unit (`buildClarifications`): pairs Q+A in order; drops blank/whitespace answers; trims and
  caps length; tolerates fewer answers than questions; returns `[]` for no answers.
- Browser smoke (mock `sb.functions.invoke`): analyze → `kind:questions` routes to the
  questions screen; typing answers + "Get my result" sends the right `clarifications` to
  finalize and lands on `#meal-analysis` with the result; "Skip" finalizes with `[]`; a
  finalize error shows the retake recovery.

## Build order
1. `buildClarifications` + unit test (red→green).
2. `state.js` two-phase rewire.
3. `mealQuestions` screen + analyzing branch + route.
4. CSS.
5. Verify (jest + browser smoke), commit on branch.
