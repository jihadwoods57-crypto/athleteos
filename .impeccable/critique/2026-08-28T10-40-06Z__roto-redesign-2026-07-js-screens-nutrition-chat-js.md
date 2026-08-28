---
target: AI nutritionist output in messaging
total_score: 23
p0_count: 2
p1_count: 2
timestamp: 2026-08-28T10-40-06Z
slug: roto-redesign-2026-07-js-screens-nutrition-chat-js
---
# Critique: the AI Nutritionist's output in messaging

Target: `proto/redesign-2026-07/js/screens/nutrition-chat.js` plus the text it renders
(`supabase/functions/_shared/meal-opener.ts`, `supabase/functions/meal-chat/index.ts`) and the
shared bubble layer (`js/chat-view.js`, `css/screens.css` lines 524-660).

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 1 | Nutrition chat has no typing state, no send receipt, no poll, no realtime |
| 2 | Match system / real world | 2 | A reply silently attaches to the newest plate, whatever you were reading |
| 3 | User control and freedom | 2 | No way to pick which meal you are answering |
| 4 | Consistency and standards | 1 | Four renderers of `.msg.ai`; only one clamps, only one calls the AI |
| 5 | Error prevention | 3 | Null-vs-empty fetch discipline and the correction tool are genuinely strong |
| 6 | Recognition rather than recall | 3 | Meal dividers carry photo, name, time and score |
| 7 | Flexibility and efficiency | 2 | Read more exists in one place only; no way to jump to a plate |
| 8 | Aesthetic and minimalist | 3 | Bubbles read as a conversation; the opener can run to 1000 chars unclamped |
| 9 | Error recovery | 3 | Retry affordances are real and honestly worded |
| 10 | Help and documentation | 3 | Members sheet states who reads the thread and what the AI does |
| **Total** | | **23/40** | Needs work |

## Anti-patterns verdict

Not AI slop. The writing rules are unusually disciplined. The failures are consistency
failures across renderers, not taste failures.

Detector: `npx impeccable detect` can only read `index.html`, and the thread is built from JS
template strings at runtime, so its findings describe the app shell, not this surface. One
overlaps: `.msg.athlete .bubble` carries `box-shadow: 0 2px 10px rgba(var(--blue-rgb),0.22)`,
a colored glow on a dark page.

## Priority issues

### [P0] The Nutrition chat composer does not reach the AI
`nutrition-chat.js` submit() calls `postMealComment` and reloads. Zero `functions.invoke`.
`meal.js`, `trust.js` and `coach.js` all invoke `meal-chat`. The screen's own empty state says
"Log a meal and the AI Nutritionist starts the conversation", the facepile lists it, the members
sheet says it "Reads every meal and answers questions". Nothing answers.

### [P0] No typing state, no poll, no realtime in Nutrition chat
Even if the invoke is added, the reply is written server-side. `meal.js` has an `#ai-typing`
bubble, a 15s idle poll and a realtime doorbell. Nutrition chat has none.

### [P1] Every reply silently lands on the newest meal
`const latest = STATE.meals[0]`. Scroll to Tuesday's dinner, ask a question, it attaches to
today's breakfast, and the AI answers about the wrong plate.

### [P1] Hardcoded em dashes in the AI's most-read message
`meal-opener.ts` lines 134, 141, 143, 161. Every model path strips them
(`.replace(/—/g, ',')`); this composed path does not.

### [P2] Read more clamps in one renderer out of four
`meal.js` only. Nutrition chat, trust and coach render the full paragraph.

### [P2] `#fff` on `--blue-bright` in dark theme
`.msg.ai .av` and `.facepile .fpav`. `.fpav.other` already uses `--ink-on-accent`; the blue ones
were missed. Roughly 2.6:1.

### [P3] Amber carries identity as well as warning
`.msg.coach .av` and `.facepile .fpav.other` use the amber gradient. DESIGN.md: amber is
warning only.
