import { longEdgeResize, MAX_EDGE } from './index';

describe('longEdgeResize', () => {
  it('caps the long edge on a landscape image (resizes width)', () => {
    expect(longEdgeResize(4000, 3000, MAX_EDGE)).toEqual({ width: MAX_EDGE });
  });

  it('caps the long edge on a portrait image (resizes height)', () => {
    expect(longEdgeResize(3000, 4000, MAX_EDGE)).toEqual({ height: MAX_EDGE });
  });

  it('never upscales a photo already under the cap', () => {
    expect(longEdgeResize(800, 600, MAX_EDGE)).toEqual({ width: 800 });
  });

  it('falls back to the max width when dimensions are unknown', () => {
    expect(longEdgeResize(undefined, undefined, MAX_EDGE)).toEqual({ width: MAX_EDGE });
  });
});
