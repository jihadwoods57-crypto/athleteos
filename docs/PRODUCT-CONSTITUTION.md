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

---

**The one line that governs the decade:** AthleteOS is the system that turns a coach's plan
into an athlete's daily execution — and proves it worked.

### Product Decision Filter (apply to every feature request)
Does it make AthleteOS smarter, improve accountability, reduce decision fatigue, strengthen
relationships, or produce measurable results? If the answer is "no" to all five, do not build it.
