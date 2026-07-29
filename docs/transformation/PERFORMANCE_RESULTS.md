# Performance Results

## Stated plainly: performance was not measured in this pass.

The brief's rule is "measure before optimizing". No representative measurement was taken, so
nothing here is optimized and no performance claim is made. Recording a guess would be worse than
recording nothing.

What is known from the architecture, without measurement:

- The UI is local files in a WebView — no bundler, no framework runtime, no hydration. First paint
  does not wait on JavaScript download.
- CSS is 8 files, ~2.7k lines total, loaded synchronously in `<head>`.
- JS is 112 native ES modules loaded over `file://`. Module count, not bundle size, is the likely
  cost on a cold start.
- `js/state.js` is 3,229 lines and is imported by nearly every screen.
- The native shell extracts the proto from a zip on first launch (`protoBundle.ts`), so first-run
  and subsequent-run startup differ and must be measured separately.

## What to measure first, and how

1. **Cold start to first meaningful paint**, first-run vs warm. Instrument in `ProtoApp.tsx`
   around `ensureProtoExtracted()` and the WebView `onLoadEnd`.
2. **Module graph cost.** 112 `file://` module fetches on iOS is the most likely startup cost.
   Compare against a single concatenated bundle before assuming it matters.
3. **Route transition time**, using the existing `js/analytics.js` events.
4. **Meal photo upload** on a throttled connection — the product's core action, and the one most
   exposed to a bad network.
5. **AI analysis latency**, which is already instrumented: migration 0105 (`ai_calls`) records
   per-call cost and duration for all six paid functions.
6. **Query efficiency** on `coach-roster` and `coach-home`, the widest reads in the product.

The QC harness (`scripts/qc-capture.mjs`) already drives every screen through CDP, so timing
collection can be added there rather than built from scratch.

## Related work already in the repo

`docs/scale/` and migration `0148_scale_before_10k.sql` cover a capacity audit toward 10k users.
That work was not re-verified here.
