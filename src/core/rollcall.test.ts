import {
  rollCallCategoryId, enqueueAck, dropAck, mergeLabels,
  COACH_DIGEST_CATEGORY, COACH_ACTION_SEEN, COACH_ACTION_NUDGE,
  coachActionFor, enqueueCoachAction, dropCoachAction,
  CHECK_IN_LABEL, ROLLCALL_CHANNEL, ackOutcome,
} from './rollcall';
import {
  rollCallCategoryId as serverCategoryId,
  COACH_DIGEST_CATEGORY as SERVER_COACH_CATEGORY,
  CHECK_IN_LABEL as SERVER_CHECK_IN_LABEL,
  ROLLCALL_CHANNEL as SERVER_ROLLCALL_CHANNEL,
} from '../../supabase/functions/_shared/rollcall-category';

describe('wake-up roll call contracts (0211)', () => {
  it('the late push label and the Android channel match the server byte for byte', () => {
    expect(CHECK_IN_LABEL).toBe(SERVER_CHECK_IN_LABEL);
    expect(ROLLCALL_CHANNEL).toBe(SERVER_ROLLCALL_CHANNEL);
    expect(rollCallCategoryId(CHECK_IN_LABEL)).toBe(serverCategoryId(SERVER_CHECK_IN_LABEL));
    expect(rollCallCategoryId(CHECK_IN_LABEL)).toBe('RC::check-in-now');
  });
  it('an ack is retried only when a retry could change the answer', () => {
    expect(ackOutcome(null, false)).toBe('retry');   // no network
    expect(ackOutcome(503, false)).toBe('retry');    // server hiccup
    expect(ackOutcome(200, true)).toBe('ok');
    expect(ackOutcome(200, false)).toBe('dead');     // 200 with ok:false is a refusal, not a success
    expect(ackOutcome(410, false)).toBe('dead');     // expired code
    expect(ackOutcome(404, false)).toBe('dead');     // closed / no row
    expect(ackOutcome(403, false)).toBe('dead');     // flag off
  });
});

describe('rollCallCategoryId', () => {
  it('slugs the coach label, stable + bounded', () => {
    expect(rollCallCategoryId("I'm Up")).toBe('RC::i-m-up');
    expect(rollCallCategoryId('Here')).toBe('RC::here');
    expect(rollCallCategoryId(null)).toBe('RC::im-up');
  });
});

describe('ack queue', () => {
  it('enqueues and dedupes by code', () => {
    let q = enqueueAck([], 'c1', 1);
    q = enqueueAck(q, 'c1', 2); // duplicate
    q = enqueueAck(q, 'c2', 3);
    expect(q.map((x) => x.code)).toEqual(['c1', 'c2']);
  });
  it('drops by code', () => {
    const q = enqueueAck(enqueueAck([], 'c1', 1), 'c2', 2);
    expect(dropAck(q, 'c1').map((x) => x.code)).toEqual(['c2']);
  });
});

describe('mergeLabels', () => {
  it('appends a new label and dedupes', () => {
    expect(mergeLabels([], "I'm Up")).toEqual(["I'm Up"]);
    expect(mergeLabels(["I'm Up"], "I'm Up")).toEqual(["I'm Up"]);
    expect(mergeLabels(["I'm Up"], 'Here')).toEqual(["I'm Up", 'Here']);
  });
  it('ignores empty labels', () => {
    expect(mergeLabels(['Here'], '')).toEqual(['Here']);
  });
  it('caps to the most recent N', () => {
    const many = Array.from({ length: 20 }, (_, i) => 'L' + i);
    const out = mergeLabels(many, 'NEW', 20);
    expect(out).toHaveLength(20);
    expect(out[out.length - 1]).toBe('NEW');
    expect(out.includes('L0')).toBe(false);
  });
});

/* The device and the edge functions live in separate module graphs and cannot import each other,
   so these ids are hand-mirrored. This suite is the ONLY thing standing between that mirror and a
   silent drift: if the two ever disagree the push still arrives, it just has no buttons — a
   failure that looks identical to the feature never having shipped. Assert the real modules
   against each other rather than against a copied literal, which would drift with them. */
describe('server/device category mirror', () => {
  it('agrees on the athlete category for every shape a label can take', () => {
    for (const label of [null, "I'm Up", 'Here', 'ON THE FIELD', 'a'.repeat(40), '¡Ya!', '']) {
      expect(rollCallCategoryId(label)).toBe(serverCategoryId(label));
    }
  });
  it('agrees on the coach digest category', () => {
    expect(COACH_DIGEST_CATEGORY).toBe(SERVER_COACH_CATEGORY);
  });
});

describe('coachActionFor', () => {
  it('maps the two registered action ids to their verbs', () => {
    expect(coachActionFor(COACH_ACTION_SEEN)).toBe('seen');
    expect(coachActionFor(COACH_ACTION_NUDGE)).toBe('nudge');
  });
  it('is null for a plain tap and for anything unrecognised', () => {
    // expo-notifications sends this identifier for a tap on the notification body itself. It must
    // read as "no action" so the handler falls through to routing into the app.
    expect(coachActionFor('expo.modules.notifications.actions.DEFAULT')).toBeNull();
    expect(coachActionFor('ACK')).toBeNull(); // the ATHLETE action must never run the coach path
    expect(coachActionFor(undefined)).toBeNull();
    expect(coachActionFor(null)).toBeNull();
  });
});

describe('coach action queue', () => {
  it('keeps both verbs for one code', () => {
    // A coach who presses "Got it" and then "Nudge them" on the same digest means both. Deduping
    // on the code alone would silently drop the nudge.
    let q = enqueueCoachAction([], 'c1', 'seen', 1);
    q = enqueueCoachAction(q, 'c1', 'nudge', 2);
    expect(q).toHaveLength(2);
  });
  it('dedupes the same verb on the same code', () => {
    let q = enqueueCoachAction([], 'c1', 'nudge', 1);
    q = enqueueCoachAction(q, 'c1', 'nudge', 2);
    expect(q).toHaveLength(1);
  });
  it('drops only the matching code+verb pair', () => {
    let q = enqueueCoachAction([], 'c1', 'seen', 1);
    q = enqueueCoachAction(q, 'c1', 'nudge', 2);
    q = dropCoachAction(q, 'c1', 'seen');
    expect(q.map((x) => x.action)).toEqual(['nudge']);
  });
  it('ignores an empty code', () => {
    expect(enqueueCoachAction([], '', 'seen', 1)).toHaveLength(0);
  });
});
