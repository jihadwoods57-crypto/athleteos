# AthleteOS — Navigation & Endpoint Map

Every screen, its entry points, and every interactive element's destination.
Built by tracing `src/Root.tsx` (the top-level `flow` switch) and each screen's
store actions. Use this to verify no endpoint dead-ends or contradicts another.

`flow` (in `useStore`) selects the root surface:
`onboarding | app (athlete) | coach | parent | trainer` (see `src/Root.tsx`).

Legend: ✅ wired · 🔧 fixed this COHERENCE series · ⬜ intentional display-only
(read-only by design, not a dead end).

---

## ONBOARDING (`flow = 'onboarding'`)

`Onboarding.tsx` renders by `obStep`: 0 = Welcome, 1 = RolePicker, 2+ = role flow.

| From | Element | → Destination |
| --- | --- | --- |
| Welcome | "Get started" (needs name) | RolePicker (`obNext`) |
| Welcome | "Sign in" | SignIn (`startSignin`) → `signinDone` → app |
| RolePicker | 7 role cards | sets `role`; "Continue" → role flow (`obNext`) |
| Athlete flow | goal → sport → position → profile → frequency → support → 6 baseline → score reveal → challenge | each "Continue" `obNext`; "Start now" → `startFirstMealChallenge` (app + opens first-meal capture) |
| Generic flow (6 roles) | select / multiselect / text / invite steps | "Continue" `obNext`; final invite "Send invite"/"Skip" → `finishOb` (role dashboard) |
| Any step | back chevron | `obBack` (clamped at 0) |

`flowForRole`: athlete → `app`; parent → `parent`; personal_trainer + nutritionist
→ `trainer`; sports_perf/hs/college coach → `coach`. Verified consistent with the
onboarding-redesign spec.

---

## ATHLETE APP (`flow = 'app'`) — `AthleteApp.tsx`

Bottom tab bar + center camera FAB; full-screen overlays mount above.

| Tab bar | → |
| --- | --- |
| Home / Plan / Squad / Check-In | `setTab(...)` ✅ |
| Center camera FAB | `openMeal` → MealCapture overlay ✅ |
| (Nutrition, Profile are tabs reached from Home, not the bar) | |

### Home (`Home.tsx`)
| Element | → |
| --- | --- |
| Bell | `openNotif` → Notifications ✅ |
| Streak flame badge | display-only (role="text") ⬜ |
| Profile monogram | `goProfile` → Profile tab ✅ |
| Score hero / Season goal / Score trend / AI insight | display-only ⬜ |
| Coach guidance card | display-only ⬜ — 🔧 now gated: a real solo athlete (no coach) sees no card; a real athlete with a coach/nutritionist sees a pending empty state; the seeded demo keeps the Coach Davis note |
| Today's Progress → Hydration "+ " | `addWater` ✅ |
| "Nutrition" entry card | `goNutrition` → Nutrition tab ✅ |
| "Log dinner" card (if dinner unlogged) | `openMeal` → MealCapture ✅ |
| "Dinner logged" card | display-only completion state ⬜ |
| Check-in banner (if not submitted) | `goCheckin` → Check-In ✅ |

### Plan (`Plan.tsx`)
| Element | → |
| --- | --- |
| Each task row / checkbox | `toggleTask(id)` (moves score) ✅ |

### Squad (`Squad.tsx`)
| Element | → |
| --- | --- |
| Team / Position segmented control | `setSquadMode` ✅ |
| Leaderboard rows | display-only (no athlete-detail for peers) ⬜ |

### Check-In (`CheckIn.tsx`)
| Element | → |
| --- | --- |
| Weight ± steppers | `wStep` ✅ |
| Each 1–10 slider | `setCi(key, v)` ✅ |
| "Submit Check-In" | `submitCi` → done state ✅ |
| "Back to Home" (done state) | `goHome` ✅ |

### Nutrition (`Nutrition.tsx`)
| Element | → |
| --- | --- |
| Quick-add food chips | `toggleQuick(i)` ✅ |
| Logged meal row | `openMealDetail(id)` → MealDetail ✅ |
| Unlogged meal row | `setMealType` + `openMeal` → MealCapture ✅ |

### Profile (`Profile.tsx`)
| Element | → |
| --- | --- |
| Targets "Edit" / "Done" | toggles steppers ✅ |
| Protein / Calories / Weight ± | `adjustProteinTarget` / `adjustCalTarget` / `adjustWeightTarget` ✅ |
| Notifications toggle | `toggleNotif` ✅ |
| Units row | `toggleUnits` ✅ |
| "Help & support" row | 🔧 now opens Account help disclosure (`openAccount`) — was a dead chevron |
| "Sign out" | `signOut` → onboarding ✅ |
| Identity / visibility rows | display-only ⬜ (now derive from real onboarding data) |

### Athlete overlays
| Overlay | Close | Other endpoints |
| --- | --- | --- |
| MealCapture | `closeMeal` (X) | meal-type chips `setMealType`; camera `capture` (→ analyzing → result); "Add to Log" `addMeal` ✅ |
| MealDetail | `closeMealDetail` (back) | "Save Changes" `closeMealDetail`; chat input + send `sendChat` ✅. Re-analyze / food ± are display-only ⬜ |
| Notifications | `closeNotif` ("Clear") | NEW cards → `goCheckin` / `openMeal` / `goSquad` ✅. EARLIER cards display-only ⬜ |
| Account | `closeAccount` (back) | Notifications toggle; disclosure rows (accordion); "Sign out" ✅ |
| Messages | `closeMsg` (back) | input + send `sendMsg` ✅ |

---

## OVERSEER DASHBOARDS

The product spec's overseer loop is: open → **Needs Attention** → tap at-risk
athlete → see why → **Nudge** → done. The Nudge is the only overseer action this
phase. It is now real across all three surfaces (🔧 this series).

### Coach (`flow = 'coach'` — `CoachView.tsx`)
| Element | → |
| --- | --- |
| Menu (☰) | `openAccount` → Account ✅ |
| KPI cards (Team Avg / Compliance / Alerts) | display-only (derive from live roster) ⬜ |
| NEEDS ATTENTION rows | `openPerson` → PersonDetail ✅; each row has a **Nudge** action (`sendNudge`); 🔧 the whole list now DERIVES from the live roster (`needsAttention`): everyone below the alert line, most-at-risk first, with a derived reason, list length == ALERTS KPI, and the live athlete appears here once their own score drops below 80. Empty → an all-clear state ⬜ |
| Check-in question toggles | `toggleCiQ` ✅ |
| Roster rows | `openPerson` → PersonDetail ✅ |
| AI team summary | display-only ⬜ |

### Trainer (`flow = 'trainer'` — `TrainerView.tsx`)
| Element | → |
| --- | --- |
| Menu (☰) | `openAccount` → Account ✅ |
| KPI cards / Book Compliance trend | display-only ⬜ |
| NEEDS FOLLOW-UP → "Send nudge" | `sendNudge(name)`; 🔧 the list now DERIVES from the real client book (`needsAttention(TRAINER_CLIENTS)`) — badge count == list length, only real clients appear (a phantom client who was not in the book was removed), most-at-risk first. Empty → an all-clear state ⬜ |
| NEEDS FOLLOW-UP → "View" | `openPerson` → PersonDetail (threads the client's real `last` recency) ✅ |
| All Clients rows | `openPerson` → PersonDetail ✅ |
| AI practice summary | display-only ⬜ |

### Parent (`flow = 'parent'` — `ParentView.tsx`)
| Element | → |
| --- | --- |
| Menu (☰) | `openAccount` → Account ✅ |
| Score / compliance / weight / nutrition / coach-note cards | display-only by design (single-athlete read view) ⬜ |

### PersonDetail (overlay, from Coach/Trainer rows)
| Element | → |
| --- | --- |
| Title | 🔧 "{noun} Profile" — "Client Profile" from the Trainer book, "Athlete Profile" from the Coach roster (`rosterNoun(flow)`) |
| Back | `closePerson` ✅ |
| "Message" | `openMsg` → Messages ✅ |
| Second action | "Send nudge" `sendNudge` ✅ |
| Status word + "Last active" | 🔧 display-only ⬜ — a band-colored `scoreLanguage` word (On standard / On the bubble / Needs intervention) so the word matches the ring, and an honest "Last active · {last}" from the trainer book (Today when no recency) |

---

## Dead ends fixed this COHERENCE series

1. **Overseer Nudge** — the spec's only overseer action was entirely dead: the
   Trainer "Send nudge"/"View" buttons and the PersonDetail second button were
   static `<View>`s with no handler, and the Coach Needs-Attention rows had no
   nudge at all. Now a real `sendNudge` action backs all of them, with a
   "Nudged" confirmation state. (The AI practice summary literally recommends a
   nudge — now the button it recommends works.)
2. **Profile "Help & support"** — a chevron row with no `onPress`; now opens the
   Account help disclosure.

## Intentional display-only (NOT dead ends)

Trend charts, KPI cards, AI insight/summary cards, the Home score hero, Squad
peer rows, and the Parent read-only cards are presentation surfaces by design —
they reflect live derived state and are not meant to navigate. The seeded-demo
"Earlier" notifications and MealDetail re-analyze/food-steppers are deliberate
display placeholders for the deterministic (no-LLM, no-camera) build.
