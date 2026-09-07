// Meal-pipeline eval runner. Live (paid): POST each photo to analyze-meal, save the raw response,
// score it. Replay (free): re-score saved responses through the deterministic scoring core.
// Writes a baseline and diffs the previous one.
// Run: `npm run eval -- [--url=..] [--replay] [--no-baseline] [--repeat=N]`
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreMeal, openerVariety, type ManifestEntry, type MealResponse } from '../src/core/evalScore';

const DIR = dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d?: string) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : (process.argv.includes(`--${k}`) ? '' : d); };
const URL = arg('url', 'https://ftwrvylzoyznhbzhgism.supabase.co/functions/v1/analyze-meal')!;
const REPLAY = process.argv.includes('--replay');
const NO_BASELINE = process.argv.includes('--no-baseline');
const ANON = process.env.EVAL_ANON_KEY || '';
/* Samples per photo. The metrics on this suite are noise-dominated at N=1 — two identical runs
   moved protein error by 0.08 (2026-09-07) — so a question like "did that prompt change hurt
   accuracy?" cannot be answered by one run, only argued about. N>1 scores every sample, so the
   aggregate is a mean over N x 6 rather than 6, and the answer costs money instead of opinions.
   Meaningless on --replay, which re-reads one cached response per meal. */
const REPEAT = REPLAY ? 1 : Math.max(1, Math.min(10, Math.round(Number(arg('repeat', '1'))) || 1));

const manifest: ManifestEntry[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const respDir = join(DIR, 'responses'); if (!existsSync(respDir)) mkdirSync(respDir, { recursive: true });

async function getResponse(e: ManifestEntry): Promise<{ resp: MealResponse | null; ms: number }> {
  const cache = join(respDir, `${e.id}.json`);
  if (REPLAY) return { resp: existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : null, ms: 0 };
  const b64 = readFileSync(join(DIR, 'meals', e.photo)).toString('base64');
  const t0 = Date.now();
  // Per-meal request context (manifest `request`), so a plate can be posted as the athlete's
  // FIRST meal of the day the way the real client posts it. Every plate used to go out as a
  // context-free Dinner, which meant the prompt's Day context line — and every failure mode
  // living in it — was never once exercised by this suite. Entries without `request` produce a
  // byte-identical body to the old one, so their baselines stay comparable.
  const ctx = e.request || {};
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({
      mode: 'meal', mealType: ctx.mealType || 'Dinner', photoBase64: b64, phase: 'analyze',
      ...(ctx.dayContext ? { dayContext: ctx.dayContext } : {}),
      ...(ctx.athlete ? { athlete: ctx.athlete } : {}),
      ...(ctx.avoid && ctx.avoid.length ? { avoid: ctx.avoid } : {}),
      ...(ctx.goal ? { goal: ctx.goal } : {}),
      ...(ctx.earlierMeals && ctx.earlierMeals.length ? { earlierMeals: ctx.earlierMeals } : {}),
    }),
  });
  const ms = Date.now() - t0;
  const data = await res.json().catch(() => null) as any;
  const resp = data && data.kind === 'result' ? data as MealResponse : null;
  if (resp) writeFileSync(cache, JSON.stringify(resp, null, 2));
  return { resp, ms };
}

function aggregate(scored: ReturnType<typeof scoreMeal>[]) {
  const n = scored.length || 1;
  const mean = (f: (s: any) => number) => scored.reduce((a, s) => a + f(s), 0) / n;
  return {
    meals: scored.length,
    detection_recall: +mean((s) => s.detection.recall).toFixed(3),
    detection_precision: +mean((s) => s.detection.precision).toFixed(3),
    kcal_err_pct: +mean((s) => s.macroError.kcal.pct).toFixed(3),
    protein_err_pct: +mean((s) => s.macroError.protein.pct).toFixed(3),
    contradiction_rate: +mean((s) => (s.contradiction ? 1 : 0)).toFixed(3),
    // The read narrating the athlete's day instead of judging the plate. Higher is worse; see
    // scoreDayLeak. empty_day_rate is broken out because it is the one that reaches an athlete
    // as an insult to their morning ("Zero on the board", over their breakfast).
    day_leak_rate: +mean((s) => (s.dayLeak.leaked ? 1 : 0)).toFixed(3),
    empty_day_rate: +mean((s) => (s.dayLeak.emptyDay ? 1 : 0)).toFixed(3),
    // Is the writing any good? All four were measured at damning levels on 2026-09-07 and none
    // of them were visible to this harness before: 11 of 13 reads opened with the same template,
    // 8 of 13 hedged the verdict, 4 of 13 parroted the goal back, 12 of 13 deferred every action
    // to a future meal. Higher is worse on all four; opener_variety is the exception (1.0 = every
    // read opens differently), which is why it is named for the good direction.
    opener_template_rate: +mean((s) => (s.prose.openerTemplate ? 1 : 0)).toFixed(3),
    hedged_verdict_rate: +mean((s) => (s.prose.hedgedVerdict ? 1 : 0)).toFixed(3),
    goal_parrot_rate: +mean((s) => (s.prose.goalParrot ? 1 : 0)).toFixed(3),
    future_only_rate: +mean((s) => (s.prose.futureOnly ? 1 : 0)).toFixed(3),
    opener_variety: +openerVariety(scored.map((s) => s.analysis)).toFixed(3),
    verify_trigger_accuracy: +mean((s) => (s.verify.correct ? 1 : 0)).toFixed(3),
  };
}

/* WHICH PLATES THIS RUN MEASURED. An aggregate is a mean over a specific set of photos, so it is
   only comparable to a baseline taken over the SAME set. Adding the poor-image and allergen cases
   on 2026-09-07 dropped detection_recall 0.833 -> 0.681 and the gate called it a regression: the
   model had not got worse, the suite had got harder. A gate that cannot tell those apart teaches
   people to ignore it, which is the failure this whole file has been fighting.
   So the baseline records the plate ids it was taken over, and the comparison is skipped with a
   loud notice when the composition has changed. */
const FINGERPRINT = manifest.map((e) => e.id).sort().join(',');

/* WHAT COUNTS AS A REGRESSION, measured rather than assumed.
   This gate fired at a flat 0.02 on every metric. On 2026-09-07 the SAME prompt and the SAME six
   photos were run twice, twenty minutes apart, and protein error moved 0.278 -> 0.198 while kcal
   error moved the other way, 0.135 -> 0.169. A 0.02 gate on a metric with an 0.08 noise band does
   not detect regressions; it cries wolf on every run, which is how a green eval stopped meaning
   anything and let a breakfast read tell an athlete they had "zero on the board".
   Floors below are the measured run-to-run swing plus headroom. Detection was identical across
   both runs, so it keeps a tight floor. The leak rates are binary voice failures rather than noisy
   means: ANY leak against a clean baseline is a regression, so their floor is effectively zero.
   Re-measure with `npm run eval -- --repeat=3` after a model change and update these. */
const NOISE: Record<string, number> = {
  protein_err_pct: 0.10,        // measured swing 0.080 between two identical runs
  kcal_err_pct: 0.06,           // measured swing 0.034
  detection_recall: 0.03,       // measured swing 0.000
  detection_precision: 0.03,    // measured swing 0.000
  verify_trigger_accuracy: 0.03,
  contradiction_rate: 0.02,
  day_leak_rate: 0.001,
  empty_day_rate: 0.001,
  // Prose gauges. Looser than the leak rates: these are style pressure, not correctness, and one
  // plate out of eight flipping is 0.125, so a floor below that would fire on a single read.
  opener_template_rate: 0.20,
  hedged_verdict_rate: 0.20,
  goal_parrot_rate: 0.15,
  future_only_rate: 0.25,
  opener_variety: 0.20,
};
const DEFAULT_NOISE = 0.02;

/* The README calls this a regression GATE, so it has to be able to fail. Every one of these was
   previously a warning printed to a run that still exited 0 — which in CI is indistinguishable from
   a pass. Collected rather than thrown so one run reports every problem at once. */
const failures: string[] = [];

/* Case types the README's "Add a meal" checklist says the set must cover, and what each is for.
   Absent coverage is reported loudly: a suite of one clean plate cannot detect a regression in the
   paths that actually break, and until now nothing said so. */
const REQUIRED_CASES: Record<string, string> = {
  clear: 'a well-lit single plate — the happy path; verify must stay quiet',
  'poor-image': 'dark / blurred / partial — low confidence must trigger the accuracy verifier',
  'known-failure': 'a plate the model has been wrong about; guards the fix',
  allergen: 'a severe allergen present — must trigger the allergen verifier',
};

(async () => {
  if (!REPLAY && !ANON) { console.error('Set EVAL_ANON_KEY for a live run (or use --replay).'); process.exit(1); }
  const scored: ReturnType<typeof scoreMeal>[] = [];
  // The prose itself, kept so a run can be READ and not just tallied. Voice regressions are the
  // ones a metric notices last and an athlete notices first.
  const reads: { id: string; text: string }[] = [];
  let totalMs = 0, calls = 0;
  for (const e of manifest) {
    for (let i = 0; i < REPEAT; i++) {
      const { resp, ms } = await getResponse(e);
      totalMs += ms; if (!REPLAY && resp) calls++;
      if (!resp) {
        // A missing response is not a neutral event: that sample contributed nothing to the
        // metrics, so the aggregate silently describes a smaller set than the manifest claims.
        failures.push(`${e.id}: no response (${REPLAY ? 'nothing cached — run live first' : 'the live call failed'})`);
        console.warn(`  ${e.id}: no response`);
        continue;
      }
      scored.push(scoreMeal(resp, e));
      // Every sample is scored; only the last is kept for reading. Six paragraphs is a review,
      // eighteen is a data dump nobody reads.
      const seen = reads.find((r) => r.id === e.id);
      const textOut = String(resp.analysis || '').trim();
      if (seen) seen.text = textOut; else reads.push({ id: e.id, text: textOut });
    }
  }
  if (REPEAT > 1) console.log(`
sampled each photo ${REPEAT}x — aggregate is a mean over ${scored.length} reads, not ${manifest.length}`);

  if (!scored.length) failures.push('measured 0 meals — this run proves nothing');
  const agg = aggregate(scored);
  console.log('\n=== AGGREGATE ==='); console.table(agg);
  console.log(`latency: avg ${scored.length ? Math.round(totalMs / Math.max(calls, 1)) : 0}ms/call over ${calls} live calls`);
  if (!REPLAY) console.log('cost: read ai_cost_daily for this run window (8a records every eval call as mode=meal).');

  // per-case breakdown
  const byCase: Record<string, ReturnType<typeof scoreMeal>[]> = {};
  for (const s of scored) (byCase[s.caseType] ||= []).push(s);
  console.log('\n=== BY CASE ==='); console.table(Object.fromEntries(Object.entries(byCase).map(([k, v]) => [k, aggregate(v)])));

  // The reads, in full. The point of a paid run is to SEE what the athlete would have read; a
  // table of means cannot tell you the model opened by narrating an empty board.
  console.log('\n=== READS ===');
  const leakById = new Map(scored.map((s) => [s.id, s.dayLeak]));
  for (const r of reads) {
    const leak = leakById.get(r.id);
    const flags = [leak?.emptyDay ? 'EMPTY-DAY' : '', leak?.dayTotal ? 'DAY-TOTAL' : ''].filter(Boolean).join(' + ');
    console.log(`\n  ${r.id}${flags ? `  ⚠ ${flags}` : ''}\n  ${r.text || '(no analysis returned)'}`);
    if (flags) failures.push(`${r.id}: the read narrated the athlete's day (${flags})`);
  }

  // baseline diff (upgrade #1)
  const baseDir = join(DIR, 'baselines'); if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  const latest = join(baseDir, 'latest.json');
  const prevRec = existsSync(latest) ? JSON.parse(readFileSync(latest, 'utf8')) : null;
  // Three states, not two. A baseline written before fingerprinting existed cannot prove it
  // covered the same plates, so its diff is shown as information and is NOT allowed to fail the
  // run — asserting a regression from a comparison you cannot validate is the same sin as
  // ignoring one you can.
  const unknownSet = !!prevRec && !prevRec.fingerprint;
  const sameSet = !!prevRec && prevRec.fingerprint === FINGERPRINT;
  if (prevRec && !sameSet && !unknownSet) {
    console.log('\n=== VS BASELINE ===');
    console.log('  SKIPPED: the plate set changed since this baseline was taken.');
    console.log(`    baseline: ${String(prevRec.fingerprint).split(',').length} plates`);
    console.log(`    this run: ${manifest.length} plates`);
    console.log('  A mean over a different set of photos is not a comparison. Re-baseline with a');
    console.log('  passing run on the new set, then diffs mean something again.');
  }
  if (prevRec && (sameSet || unknownSet)) {
    const prev = prevRec.aggregate;
    console.log('\n=== VS BASELINE ===');
    if (unknownSet) console.log('  (baseline predates plate-set fingerprinting: shown for information, cannot fail the run)');
    for (const k of Object.keys(agg)) {
      if (k === 'meals') continue; // a count, not a metric — growing the suite is not a regression
      const d = (agg as any)[k] - (prev[k] ?? 0);
      // Metrics where UP is worse. `leak` must be listed here or a run that started narrating the
      // athlete's day back at them would score as an improvement.
      const upIsWorse = /err_pct|contradiction|leak|empty_day|_template_rate|hedged_|parrot_|future_only/.test(k);
      const t = NOISE[k] ?? DEFAULT_NOISE;
      const worse = upIsWorse ? d > t : d < -t;
      if (Math.abs(d) >= 0.001) console.log(`  ${worse ? '⚠ ' : '  '}${k}: ${prev[k]} → ${(agg as any)[k]} (${d > 0 ? '+' : ''}${d.toFixed(3)}, noise floor ${t})`);
      // A regression past the threshold is the whole reason this file exists. It used to print a
      // warning glyph into a run that exited 0, so CI called it a pass.
      if (worse && sameSet) failures.push(`${k} regressed past its noise floor of ${t}: ${prev[k]} → ${(agg as any)[k]} (${d > 0 ? '+' : ''}${d.toFixed(3)})`);
    }
  }

  // Ground-truth provenance. Printed next to coverage because it is the same class of caveat: a
  // metric is only as good as the thing it is measured against, and this suite has never been
  // measured against anything but somebody's estimate.
  const weighed = manifest.filter((e) => e.truthSource === 'weighed').length;
  console.log('\n=== GROUND TRUTH ===');
  console.log(`  ${weighed} of ${manifest.length} plates have WEIGHED portions; ${manifest.length - weighed} are estimated.`);
  if (weighed < manifest.length) {
    console.log('  Macro error against an estimated answer key measures the gap between two guesses,');
    console.log('  not the model\'s accuracy. Capture protocol: eval/README.md > "Weighing a plate".');
  }

  // Coverage: which of the README's required case types the set actually exercises.
  console.log('\n=== COVERAGE ===');
  const present = new Set(manifest.map((e) => e.caseType));
  const missing: string[] = [];
  for (const [type, why] of Object.entries(REQUIRED_CASES)) {
    const n = manifest.filter((e) => e.caseType === type).length;
    console.log(`  ${n ? '✓' : '·'} ${type.padEnd(14)} ${n} case${n === 1 ? '' : 's'}${n ? '' : `  — missing: ${why}`}`);
    if (!n) missing.push(type);
  }
  for (const t of present) if (!(t in REQUIRED_CASES)) console.log(`  ? ${t.padEnd(14)} (not in the required set)`);
  if (missing.length) {
    // Reported, not fatal: the gap needs real photographed plates, which is a team task and not
    // something a run can conjure. Loud so it stops being invisible — but it must not block the
    // deterministic replay that today's contributors do rely on.
    console.log(`\n  ${missing.length} required case type(s) uncovered: ${missing.join(', ')}`);
    console.log('  Until these exist, a green run means "the one clean plate still works", not "the pipeline is safe".');
  }
  if (!NO_BASELINE && !REPLAY) {
    const stamp = process.env.EVAL_STAMP || 'run';
    const rec = { aggregate: agg, meals: scored.length, fingerprint: FINGERPRINT };
    // The stamped record is always kept: it is this run's history, pass or fail, and the row you
    // want when you come back asking "how noisy is this metric actually?".
    writeFileSync(join(baseDir, `${stamp}.json`), JSON.stringify(rec, null, 2));
    // BUT latest.json — the thing the NEXT run is judged against — is only moved by a run that
    // passed. A failing run used to overwrite the very baseline it had just failed against, so the
    // regression it caught could never be caught again: the next run diffed against the worse
    // number and went green. That is the same "warning printed to a run that exits 0" failure this
    // file was rewritten to kill, one level up (caught 2026-09-07 by a run that regressed).
    if (!failures.length) {
      writeFileSync(latest, JSON.stringify(rec, null, 2));
      console.log(`\nbaseline written → eval/baselines/latest.json`);
    } else {
      console.log(`\nrun recorded → eval/baselines/${stamp}.json (latest.json UNCHANGED: this run failed)`);
    }
  }

  if (failures.length) {
    console.error(`\n=== FAILED (${failures.length}) ===`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`\nOK — ${scored.length} meal(s) measured, no regression against the baseline.`);
})();
