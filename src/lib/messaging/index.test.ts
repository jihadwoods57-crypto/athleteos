import { isMessagingLive, deliverMessage } from './index';
import type { ChatMsg } from '@/core';

// Locks the messaging delivery seam INERT: a regression that ships live delivery
// (sending to a real person) without the founder's backend go-live fails CI here.
describe('messaging seam (inert)', () => {
  it('is not live by default (backend flag off)', () => {
    expect(isMessagingLive).toBe(false);
  });
  it('deliverMessage reports not-delivered without firing anything', async () => {
    const msg: ChatMsg = { who: 'me', text: 'hello' };
    await expect(deliverMessage(msg)).resolves.toBe(false);
  });
});
