import { rollCallCategoryId, enqueueAck, dropAck } from './rollcall';

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
