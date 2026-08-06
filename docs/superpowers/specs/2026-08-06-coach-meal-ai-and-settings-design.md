# Coach meal review + AI Nutritionist control + operator settings — design

Date: 2026-08-06 · Requested by founder (trainer/coach perspective pass)

Eight founder asks, one campaign. No DB migrations needed anywhere — every server-side
change rides existing tables (`coach_voice_config.config` jsonb takes new keys free).

## 1. Coach meal detail shows the meal's NAME and a macro breakdown

Today `coachMeal` titles the screen with the SLOT (`cap(meal.type)` → "Lunch") and shows
only `Xg protein` in the hero. The dish name the athlete's own screen is built around
("Steak and Eggs") is already persisted — `meals.name` is written at log time from the
AI's `report_meal_analysis.name` — and the coach screen simply never reads it.

- Header + hero title become the dish name when one exists (falling back to the slot);
  slot + logged time become the subtitle. Never show a name that's just the capitalized
  slot twice.
- Add an "Estimated Nutrition" tile row (protein / carbs / fat / calories — the same
  `.macro-row.four` visual the athlete side uses) under the hero, plus the fiber note.
  Data is all on the fetched meal row (`protein, carbs, fat, kcal, fiber`). No new fetch.
- Manual/label meals keep exact numbers (no `~`); photo reads get the `~` prefix, same
  honesty rule as the athlete side.

## 2. The whole photo, visible without tapping, never distorted

`.photo-hero` is a fixed 210px crop (`object-fit:cover`), so a tall plate photo loses its
edges until the coach taps into the zoom viewer. On `coach-meal` only:

- The hero becomes aspect-honest: the full image renders `object-fit:contain` at natural
  aspect (capped ~65vh equivalent, min 180px), letterboxed over a blurred, scaled copy of
  itself so the card always looks composed instead of showing bars. Tap-to-zoom stays.
- List thumbnails (Today's proof cards, Conversation rows) stay as crops — they're
  navigation, and the detail screen now shows the whole plate.

## 3. No more surprise AI message after a coach comments

`coachMeal.submit()` fires `meal-chat {coachSupport:true}` after EVERY coach send; the
server then decides (regex + once-per-meal) whether to add an unrequested "supporting"
AI message. Founder: don't. The invoke is removed client-side; the coach's message posts
and pushes exactly as before. The server branch stays (harmless, no caller after OTA).

## 4. The coach can ask the AI Nutritionist — and it always answers

"Should she add more veggies to her plate?" got silence, because the only coach-triggered
AI path was the selective auto-support above (which the founder is removing anyway).
Explicit beats implicit:

- Client: the coach-meal composer gains a sparkle "Ask AI" button (opt-in param on the
  shared `composer()`, mirroring `attachId`). Tap = the typed question posts to the thread
  as the coach's own message, then `meal-chat {coachAsk:true, question, context}` runs and
  the AI's answer lands in the thread. Status line shows "Asking the AI Nutritionist…".
  Context is built from the loaded meal row (name/macros/fiber/quality/detected/timing) +
  coach targets when loaded + the last few thread messages, clamped under the 8KB rail.
- Server (`meal-chat`): new `coachAsk` mode. Authorization identical to coachSupport
  (RLS select proves can_view; caller must NOT own the meal). No topic regex, no
  once-per-meal cap — a direct question always gets an answer. Its own daily key
  (`meal_chat_ask:<uid>`, DAILY_CAP) + the standard spend gate. Forced `reply` tool;
  prompt addresses THE COACH (practical recommendation, ≤100 words, only context
  figures). Persisted as the unforgeable `role:'ai'` row, `author_id` = the coach.
  Plan-style rail still applies (the athlete reads the thread too).

## 5. AI Nutritionist customization — a dedicated page

The existing Coach Voice page (`#coach-voice`) IS this page, but it's thin and only
shapes nudges + analyze-meal. It becomes the "AI Nutritionist" page:

- Page rename ("AI Nutritionist — make it coach the way you coach") + two new controls:
  **Response length** (brief / standard / detailed) and **Custom instructions** (free
  text, 500 chars — "Always push vegetables", "Reference our 4-meal structure", etc.).
  Both persist into `coach_voice_config.config` (jsonb — no migration).
- `_shared/coach-voice.ts`: `VoiceConfig` gains `length` + `instructions`;
  `buildVoiceDirective` renders them inside the existing hard rails (instructions are
  style guidance and can never override the rails — stated in the prompt).
- `meal-chat` now loads the athlete's team voice config (same `loadVoiceForAthlete`)
  and composes the directive into the system prompt for every persisted reply mode
  (athlete Q, coachAsk, correction update) and the draft mode. Gated only by the page's
  own On/Off toggle (`enabled`), not the `coach_voice_v2` flag — the page is the control.
- Entry rows (coach-profile "Coach Voice", coach-plan "AI in your voice") relabel to
  "AI Nutritionist"; a matching row is added to trainer-profile (trainers had NO entry
  point at all — `coach_voice_config` upsert keys on `RT.team.id`, so `setCoachVoice`
  learns to fall back to `RT.practice.id` for a practice book).

## 6. Saving the standard is a dead end + the setup card lingers on Home

- After a successful standard save, if this save is what completed the "Review your
  standard" setup step, the screen announces "Saved" and returns to Home (where the
  checklist now shows it done). A mid-season edit (step already done) keeps the current
  stay-and-confirm behavior with the saved-state line.
- Home (empty dashboard): once BOTH required steps are done, the always-open checklist
  collapses to the same `collapseSection` treatment the populated dashboard already uses
  — one line, expandable, not a wall.

## 7. The standards editor is "way too boxy" — visual pass

Restrained de-boxing, zero behavior change (same knobs, same handlers, same save):
- `.std-mod` cards lose the heavy card-in-card look: flatter surfaces, hairline
  separators instead of full borders, section heads tightened, generous rhythm between
  groups instead of boxes stacked edge to edge.
- Per-meal cards become clean rows on soft separators; chip rows get breathing room;
  the preview card keeps its identity (it's the one true "what they see" artifact).

## 8. Real account settings for operators

Coach + trainer profiles gain an **Account** section (reusing screens that already
exist — the gap was entry points):
- Email (shown from `RT.email`) + "Change password" (sends the existing reset email,
  confirmation inline).
- Plan & billing → existing `billing` screen.
- Delete account → existing `delete-account` screen (nav-guard checked for operators).
- Sign out stays where it is.

## Test / ship plan

- Unit: `node --test` on touched test files (operator-book snapshot may need refresh);
  eslint no-undef sweep over proto js (dead-button catcher).
- Browser QC: headless proto render of coach-meal (name + macros + full photo), the
  AI Nutritionist page, trainer profile Account section, standards editor restyle.
- Ship: commit (explicit paths — concurrent committer), deploy `meal-chat` +
  `analyze-meal` + `coach-voice-nudge` (shared coach-voice.ts change), rebuild
  `assets/proto.zip` from the index, EAS OTA with `--environment production`.
