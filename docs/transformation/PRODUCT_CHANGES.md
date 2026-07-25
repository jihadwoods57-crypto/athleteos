# Product Changes

No new features were added. That is a deliberate choice, and the reasoning belongs on the record.

## Why nothing was added

The brief authorises new capability "when there is strong evidence it is needed", and warns that a
smaller product with clear value beats a larger one with weak focus. The evidence found points the
other way:

- **107 routes** across roles that collapse from six advertised identities to four real ones.
- **Three shipped coach features silently broken** by missing table grants.
- **Three of four roles unable to delete their account.**
- **~19,400 LOC of dead code** still compiled into the binary.
- **The streak number has two contradictory implementations**, both green-tested.

Adding surface to a product in that state makes it worse. Everything in this pass either fixes
something broken or removes a class of future breakage.

## Product-level findings that need a decision

### 1. The streak has no single definition — P0

Two live implementations disagree about whether an incomplete today zeroes the run, how grace
works, and whether activation day counts. The shipped answer is the proto's. **Someone must
choose**, because the product's core promise is that the score never lies. This is a product
judgement about how retention is measured, not a refactor, which is why it was not decided here.

### 2. Two of six advertised roles are narrative only

"Fitness Client" maps to `athlete`; "Nutrition Professional" maps to `trainer`. They get distinct
onboarding stories and then land in a shell built for someone else — a Nutrition Professional in
particular gets a personal-trainer command centre.

Either build the differentiation or stop advertising it. The current state sets an expectation in
onboarding that the product does not keep.

### 3. Pricing exists in four places, synchronised by comments

`src/core/pricing.ts`, `proto/js/pricing.js`, `_shared/plans.ts`, `_shared/revenuecat.ts`. Three
carry comments saying "keep in sync". Money drifting silently across four copies is the
highest-cost failure mode in the repository, and it is guarded by nothing.

### 4. Parent value is thin

The parent shell has no tab bar and three actions: link an athlete, fund a plan, view funded
plans. It is a billing surface with a dashboard attached. The brief's own test — *a parent should
understand progress without becoming an intrusive supervisor* — is a real product question this
shell does not currently answer.

### 5. Uncapped anonymous AI spend is a product problem too

Not only a security issue. Roughly 5,000 paid analyses/day are reachable with the shipped anon
key, and exhausting them returns 429 to every genuine not-yet-signed-in user for the rest of the
day. The failure lands squarely on the first-run experience of real prospects.

## What was preserved deliberately

Several things here are genuinely strong and were left alone:

- **Honest empty states.** The code refuses to fabricate — "never demo steak-and-potatoes",
  "never a fabricated persona", "no data means no sentence". This is rarer than it should be and
  is a real trust asset.
- **The privacy posture** — an in-app screen showing who sees what, guardian consent for minors,
  and a Connect flow that confirms what a coach will see *before* anything is shared.
- **Tracked-not-scored** as a category (training log, multi-domain requirements). Resisting the
  urge to score everything is good product judgement.
- **The AI uncertainty handling.** The clarifying-questions step asks what the camera cannot see
  instead of silently guessing. That is the actual differentiator, and it survives intact.
