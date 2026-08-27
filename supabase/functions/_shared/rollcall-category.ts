// OnStandard — notification category ids for the lock-screen roll call.
// ZERO framework imports: loaded by both Deno (edge) and jest (babel).
//
// A category id is the contract between the SERVER (which stamps `categoryId` on a push) and the
// DEVICE (which registered that id with iOS at launch). If the two ever compute it differently the
// push still arrives — it just silently has no buttons, which is indistinguishable from the feature
// not existing. That is the entire failure mode this file exists to prevent.
//
// It was previously a local const inside commitment-reminders/index.ts, duplicated by hand from
// src/core/rollcall.ts. Adding the coach digest would have made three hand-copies of one string
// function, so the two server-side copies are now this one module. The React Native half CANNOT
// import it (Deno's supabase/functions and RN's src/ are separate module graphs), so
// src/core/rollcall.ts remains a deliberate hand-kept mirror — its test asserts the same cases.

/** Stable category id for an athlete roll-call push, derived from the coach's action label.
 *  MUST match rollCallCategoryId in src/core/rollcall.ts. */
export function rollCallCategoryId(label: string | null): string {
  const slug = (label ?? 'Im Up').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return 'RC::' + slug;
}

/** The COACH digest category. Fixed, not derived: its two buttons ("Got it" / "Nudge them") are
 *  product copy rather than the coach's own words, so unlike the athlete's category there is
 *  nothing per-commitment to slug. One id means the device can register it once at launch and every
 *  digest that ever arrives carries working buttons.
 *  MUST match coachDigestCategoryId in src/core/rollcall.ts. */
export const COACH_DIGEST_CATEGORY = 'RCC::digest';
