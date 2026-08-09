import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_WEIGHTS, WEIGHT_CAPS, weightsFor } from './plan-style.js';
import { PROFILE_WEIGHTS as DAY_WEIGHTS } from './day.js';
import { FALLBACK_WEIGHTS } from './requirements.js';

/* There is ONE owner of the weights: plan-style.js. Every other copy in the proto must be
   the same object or provably equal to it. requirements.js is import-free by design, so its
   literal is pinned here instead of imported away. */

test('day.js re-exports plan-style.js weights, it does not redeclare them', () => {
  assert.equal(DAY_WEIGHTS, PROFILE_WEIGHTS, 'day.js must re-export the same object identity');
});

test('requirements.js FALLBACK_WEIGHTS equals the athlete row', () => {
  assert.deepEqual(FALLBACK_WEIGHTS, PROFILE_WEIGHTS.athlete);
});

test('every profile sums to 1 and sits within the caps', () => {
  for (const [name, w] of Object.entries(PROFILE_WEIGHTS)) {
    const sum = w.nutrition + w.recovery + w.commitment + w.checkin;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${name} sums to ${sum}, not 1`);
    for (const k of ['nutrition', 'recovery', 'commitment', 'checkin']) {
      assert.ok(w[k] <= WEIGHT_CAPS[k] + 1e-9, `${name}.${k} = ${w[k]} exceeds cap ${WEIGHT_CAPS[k]}`);
    }
  }
});

test('weightsFor ignores style and resolves unknown profiles to athlete', () => {
  assert.deepEqual(weightsFor('structured', 'athlete'), PROFILE_WEIGHTS.athlete);
  assert.deepEqual(weightsFor('guided', 'athlete'), PROFILE_WEIGHTS.athlete);
  assert.deepEqual(weightsFor('intuitive', 'gain'), PROFILE_WEIGHTS.gain);
  assert.deepEqual(weightsFor('nonsense', 'nonsense'), PROFILE_WEIGHTS.athlete);
});
