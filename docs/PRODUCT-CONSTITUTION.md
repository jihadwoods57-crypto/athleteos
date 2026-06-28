# AthleteOS — Product Constitution

**This is the canonical reference for what AthleteOS is and how we decide what to build.**
It is a 10-year north star, not a build schedule. Authored 2026-06-28.

> A constitution's real job is to be the thing you say **no** with. The pillars do not
> unlock building everything at once — they are the filter that keeps the product from
> becoming a pile of features. The near-term build order still governs the next 90 days
> (see `docs/LAUNCH-CHECKLIST.md` and the roadmap notes). The wedge ships first; the
> constitution decides everything after.

---

## 1. Product Philosophy
**The plan is not the product. Executing the plan is.** Everyone an athlete trusts — coach,
parent, nutritionist, trainer — creates plans. Almost nobody ensures they get *done*.
AthleteOS is the layer between intention and execution: it makes the right next action
obvious, makes doing it rewarding, and makes execution visible to the people invested in
that athlete. It is an **AI-powered execution platform**. Nutrition is domain one because it
is daily, measurable, and emotional — the perfect proving ground for a system that will
eventually govern training, recovery, and beyond.

## 2. The Five Pillars (with hierarchy)
When two pillars conflict, the higher one wins.

1. **ACCOUNTABILITY — the spine.** The mission *is* execution. This wins ties.
2. **DECISION ENGINE & INTELLIGENCE — the engine.** One system seen twice: intelligence is
   the capability; the decision engine is its applied output ("what do I do now?"). They
   exist to *serve* accountability — a smart recommendation only matters if it gets executed.
3. **HUMAN CONNECTION — the moat and the distribution.** How we retain and how we spread (a
   coach brings a whole roster). The AI amplifies the human; it never replaces them.
4. **PROOF — the endgame.** Weakest today (near-zero outcome data), deepest defensibility
   long-term. **Proof is earned by running the loop with real people, not built in a sprint.**

Per-pillar mission:
- **Intelligence:** build the smartest nutrition intelligence ever created; get smarter every day.
- **Accountability:** become the world's best execution platform; reward executing the plan.
- **Decision Engine:** eliminate decision fatigue; answer "what should I do next?".
- **Human Connection:** strengthen the athlete-coach-parent relationship; amplify coaching.
- **Proof:** become the evidence engine behind athlete development.

## 3. Signature Experience
**AthleteOS owns the Development Score** — made categorically new in two ways nobody else has:
- **Forward-looking:** not "how you recovered" but "how to win today" (the Finish-Today
  projection turns a grade into a target you can still hit).
- **Watched:** your number is seen by the person invested in you. That visibility is the
  accountability that changes behavior.

The signature ritual is **the Daily Game Plan, built around your Development Score.** The
unforgettable moment: every morning the app tells you exactly how to win the day, and you
know your coach is watching you do it. We plant one word in the market — **the Development
Score** — the way Whoop planted "Recovery."

## 4. Core Product Loop
**Plan → Execute → Reflect → Connect → Prove**, every day:
1. **Morning (Game Plan):** one number, one focus, the checklist to move it. *(Decision + Accountability)*
2. **Execute:** log a meal, the AI sees it, the number moves. *(Intelligence + Accountability)*
3. **Reflect:** the coach voice says what's next. *(Intelligence)*
4. **Connect:** the coach sees it; falling behind escalates app → coach. *(Human Connection)*
5. **Evening:** the projection resolves — did you finish? *(Accountability)*
6. **Weekly:** the report adjusts tomorrow's plan and proves the trend. *(Proof + Human Connection)*

Every loop should make the AI smarter, the habit stronger, and the relationship tighter.

## 5. Feature-to-Pillar Matrix
Score = long-term vision value (1-10), rated against the REAL build (stub/gated noted).

| Feature | Pillars | Score | Note |
|---|---|---|---|
| Development Score | Accountability, Proof | 10 | The signature. Real + honest. |
| Daily Game Plan / Finish-Today projection | Accountability, Decision, Intelligence | 9 | Shell exists; this is the home. |
| Meal photo -> analysis | Intelligence | 9 / 4 built | The headline; currently a stub. Biggest gap. |
| Restaurant Coach | Decision, Intelligence | 8 | Real, ownable; gated for the loop beta. |
| Accountability Engine (windows/escalation) | Accountability | 8 | Real; needs notifications + coach delivery. |
| Coach dashboard / needs-attention | Human Connection, Accountability | 8 potential / 3 built | Inert until backend on. |
| Notifications | Accountability (Habit) | 8 | Wired in-app; off on device. |
| Nudge / Intervention | Accountability, Human Connection | 8 potential / 2 built | Local-only today. |
| Coach Plan | Accountability, Human Connection | 7 | Real. |
| Weekly report (athlete + team) | Proof, Human Connection | 7 | Real; demo data for coaches. |
| Starting Score / onboarding | Intelligence, activation | 7 | Strong hook. |
| Check-in (recovery) | Accountability, Proof | 6 | Real. |
| Food DB / quick-add | Intelligence, Decision | 6 | 55 items; honest floor. |
| Parent dashboard | Human Connection | 6 | Inert. |
| Performance / PR | Proof | 5 | Different domain; keep minimal. |
| Squad / leaderboard | Human Connection | 4 | Can distract from execution. |
| Trainer / Nutritionist surfaces | Human Connection | 4 | V1.5+. |
| Messaging | Human Connection | 4 | Risk-laden; defer. |
| Wearables | Proof, Intelligence | 5 | Future. |

## 6. Navigation Architecture
Collapse the fragmented tabs into three pillar-aligned destinations + one action:
- **TODAY** — the Daily Game Plan (score, focus, checklist; the Decision Engine surfaced in
  context, not a separate tab). *(Accountability + Decision + Intelligence)*
- **+ LOG** (center) — the capture moment. *(Intelligence)*
- **PROGRESS** — score trend, weight, results over time. *(Proof)*
- **COACH** — your coach, their plan, their messages, your standing. *(Human Connection)*

Nutrition and Plan dissolve into Today (always parts of the same day). Squad folds into Coach
or is cut. Every tab names a pillar; the product stops feeling like four tools.

## 7. Missing Flagship Features (by pillar)
- **Intelligence:** a real vision model (the defining gap); behavioral learning; coach/
  nutritionist philosophy as a real recommendation input.
- **Accountability:** notification-driven escalation; a commitment/streak mechanic tied to
  EXECUTION, not logins.
- **Decision:** "what do I eat anywhere" — gas station, travel, home pantry — not just chains.
- **Human Connection:** real coach<->athlete delivery; a recognition/celebration engine (the
  dopamine the accountability spine currently lacks).
- **Proof:** an outcomes engine — does a rising Development Score predict real improvement?
  The asset you sell to programs and colleges; no competitor has it.

## 8. Features to Remove (don't earn their place in the wedge)
Messaging (until legal + not core), wearables, trainer/nutritionist/college surfaces, the
leaderboard if it doesn't drive execution, all demo/"Sample" data, and prominent PR tracking.

## 9. Features to Simplify
The score taxonomy -> one hero number (Development Score; fold projection in; demote weight/
performance to Progress). The navigation (4 tabs -> 3 pillars). Onboarding (keep only what
feeds the Starting Score or the first meal).

## 10. Features to Expand
The Daily Game Plan into the OS (the home). The Development Score into the signature
(projectable, watched). The Restaurant Coach into a full Decision Engine (anywhere/any
budget/any context). Coach visibility + intervention (once backend's on). Real AI.

## 11. Long-Term Moats
1. **Behavioral data flywheel** — every logged meal + outcome makes recommendations smarter.
   Real only at scale, but compounding and uncopyable.
2. **The coach<->athlete graph** — a coach with their whole roster inside has enormous
   switching cost. Network moat AND distribution.
3. **The Proof/outcomes dataset** — evidence of athlete improvement, sellable to colleges/
   programs. Nobody in nutrition has this.
4. **The Development Score as a category standard** — own the language sports uses for
   nutrition execution (the Whoop-Recovery moat).

## 11a. The Scoring Contract (who controls what)
The single most important architectural rule for the Development Score, because it resolves a
real conflict between Human Connection (give the coach control) and Proof + the category moat
(the score must be consistent to be trustworthy). The resolution: **separate the PLAN from the
FORMULA.**

- **The coach/trainer/nutritionist OWNS THE PLAN.** Targets (protein, calories, meals, windows,
  restrictions), the scoring **profile** (a curated set: Athlete / General / Performance), and
  which components are **relevant** (on/off — never penalize a client for a check-in their
  trainer doesn't run; this extends the existing check-in-question toggles). The professional
  personalizes *what the client is trying to hit*.
- **The PLATFORM owns the FORMULA.** The weights within a profile, the 0-100 scale, the band
  language. The coach may NOT re-weight or invent metrics. An "84" always means "84% execution
  of YOUR plan," whoever set the plan — so the number stays comparable across a roster, a team,
  and the platform, and stays un-gameable.
- **The AI RECOMMENDS, never dictates.** It proposes evidence-based targets and the right
  profile; the coach accepts or overrides. Target *recommendation* stays evidence-based
  deterministic math (you never want a model hallucinating a minor's calorie target); the AI
  layer *explains and refines* the number, it does not invent it.

Why free re-weighting is rejected: per-coach formulas make an "84" mean something different for
every athlete (kills comparability), let a coach flatter their roster (gameable), and end the
Proof pillar (you can't prove a rising score predicts improvement if the score isn't constant).
Targets + profile + on/off already give a coach all the real personalization they need.

## 11b. Goal-Aware Intelligence (shared interface, personalized intelligence)
AthleteOS is NOT an athlete-only app. It is one premium app whose INTERFACE stays consistent
for everyone (Home / Nutrition / Camera / Plan / Team) while its INTELLIGENCE — coaching
language, recommendations, accountability emphasis, education, and which cards show — adapts to
WHO the user is and WHAT they're trying to do. Athlete, weight-loss client, busy professional,
teen, bodybuilder, general-wellness user: same screens, different brain. The user should never
think "this is an athlete app." They should think "this app understands me." Do NOT build
separate apps or separate experiences.

**The Context model (the abstraction that makes this real).** Every adaptive surface reads from
ONE context object — who the user is, their primary goal, who guides them (coach/trainer/
nutritionist/none), the plan they're on, and today's state (what they ate, what's left, their
schedule, recent struggles). Scoring, copy, recommendations, and card selection all read the
same context, so they can never disagree about who the user is. Adding a new user type = adding
a profile entry, never a new code path. This is the successor to `ScoringProfile`.

**The five questions every analysis answers, in order** (the meal-result screen already does
this; the work is making 2–5 adapt by context):
1. What did I eat? (objective: foods, macros, quality, confidence)
2. How does this affect MY goal? (adapts hard by user type)
3. Did I execute today's plan? (the defining feature — execution, not perfection)
4. What should I do next? (exactly ONE clear, easy action)
5. Why does this matter? (relevant-to-today education, rotated, never generic)

**The deterministic / LLM split (same as Rule #8).** The Context model and the per-profile
adaptation are DETERMINISTIC and buildable today — trustworthy, no hallucination, the floor.
The truly per-user *generated* coaching language is the LLM layer, added when a real model is
configured. The LLM PHRASES the coaching over the context; it never INVENTS the scoring or the
safety-bounded numbers (especially for minors and weight-loss clients). Adaptive coaching always
REINFORCES a human professional's plan when one exists; it never overrides it (Rule #3).

**Design for many, ship two.** The architecture must flex to N user types, but we POPULATE only
the profiles the current wedge needs (today: athlete + general). "Never hardcode / expansion is
simple" is an architecture instruction, not a "build twelve personalities now" instruction.
More profiles ship only after the loop retains. Breadth still follows proof.

## 12. Product Principles (how the product behaves)
One number, not four. Always explain why. Reward execution, not perfection. Reduce decisions,
never add choices. Every screen answers "what do I do next?". Fail honest (never fake data or
fake AI). The coach is amplified, never replaced. Make the right action the easy action.

## 13. Founder Rules (permanent)
1. Never build a feature that doesn't strengthen a pillar. "No" to all five = no.
2. The plan is not the product. Execution is. Every feature must move execution.
3. Never replace the coach. Amplify them.
4. Reward executing the plan, not being perfect.
5. Reduce decisions. Never add choices.
6. Always explain why. Trust > complexity.
7. Every screen answers "what should I do next?".
8. Never call it AI until a model is actually doing the work. Honesty is positioning.
9. One number. Protect the Development Score from dilution.
10. Demo data never touches a real user.
11. Validate the loop before you widen it. Proof is earned with real athletes, not built.
12. When in doubt, do the smaller thing exceptionally well.
13. The coach owns the plan; the platform owns the formula; the AI recommends, never dictates.
    A score must mean the same thing for everyone or it means nothing.
14. The interface is shared; the intelligence is personalized. One app, one Context model,
    many user types. Design for many, ship two — breadth follows proof.

---

**The one line that governs the decade:** AthleteOS is the system that turns a coach's plan
into an athlete's daily execution — and proves it worked.

### Product Decision Filter (apply to every feature request)
Does it make AthleteOS smarter, improve accountability, reduce decision fatigue, strengthen
relationships, or produce measurable results? If the answer is "no" to all five, do not build it.
