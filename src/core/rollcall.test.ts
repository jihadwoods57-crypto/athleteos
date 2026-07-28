import { rollCallCategoryId, enqueueAck, dropAck, mergeLabels } from './rollcall';

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
